/**
 * @fileoverview AI Agent Processing Endpoint
 *
 * Processa mensagens recebidas com o AI Agent.
 * Chamado pelos webhooks após inserir mensagem inbound.
 *
 * POST /api/messaging/ai/process
 * Body: { conversationId, organizationId, messageId, messageText }
 *
 * Esta rota é interna - chamada apenas pelos webhooks.
 *
 * @module app/api/messaging/ai/process
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { processIncomingMessage } from '@/lib/ai/agent';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { transcribeAudio } from '@/lib/ai/agent/transcribe-audio';
import crypto from 'crypto';

// Internal API secret for webhook -> AI communication
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

import { waitUntil } from '@vercel/functions';

// Maximum function execution duration (seconds)
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Verify internal API secret
  // Accepts both X-Internal-Secret header and Authorization: Bearer
  const internalSecret = request.headers.get('X-Internal-Secret');
  const authHeader = request.headers.get('Authorization');
  const providedKey = internalSecret || authHeader?.replace('Bearer ', '');

  if (!INTERNAL_API_SECRET) {
    console.error('[AI Process] INTERNAL_API_SECRET not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (!providedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Timing-safe comparison to prevent timing attacks
  const expectedBuf = Buffer.from(INTERNAL_API_SECRET, 'utf8');
  const providedBuf = Buffer.from(providedKey, 'utf8');
  const isValid =
    expectedBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, providedBuf);

  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse and validate request body
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { conversationId, organizationId, messageId, messageText, audio } = body;
  const hasAudio =
    audio && typeof audio.base64 === 'string' && typeof audio.mimeType === 'string';

  // Validate required fields and UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!conversationId || !organizationId || !messageText) {
    return NextResponse.json(
      { error: 'Missing required fields: conversationId, organizationId, messageText' },
      { status: 400 }
    );
  }

  if (!uuidRegex.test(conversationId) || !uuidRegex.test(organizationId)) {
    return NextResponse.json(
      { error: 'Invalid UUID format for conversationId or organizationId' },
      { status: 400 }
    );
  }

  if (messageId && !uuidRegex.test(messageId)) {
    return NextResponse.json(
      { error: 'Invalid UUID format for messageId' },
      { status: 400 }
    );
  }

  // Create Supabase client with service role
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Support both old and new Supabase key formats
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // In dev, waitUntil drops the callback — await directly for testability.
  // In production, Vercel executes waitUntil after the response is sent.
  const isDev = process.env.NODE_ENV === 'development';
  const task = (async () => {
    let incomingMessage: string = messageText;

    if (hasAudio) {
      incomingMessage = await resolveAudioMessage({
        supabase,
        organizationId,
        messageId,
        audio,
      });
    }

    await processIncomingMessage({
      supabase,
      conversationId,
      organizationId,
      incomingMessage,
      messageId,
    });
  })().catch((error) => {
    console.error('[AI Process] Background processing error:', error);
  });

  if (isDev) {
    await task;
  } else {
    waitUntil(task);
  }

  return Response.json({ received: true }, { status: 200 });
}

/**
 * Transcreve o áudio do cliente, guarda a transcrição na mensagem e devolve o
 * texto que o agente deve tratar como a mensagem recebida.
 */
async function resolveAudioMessage(params: {
  supabase: SupabaseClient;
  organizationId: string;
  messageId?: string;
  audio: { base64: string; mimeType: string };
}): Promise<string> {
  const { supabase, organizationId, messageId, audio } = params;

  const aiConfig = await getOrgAIConfig(supabase, organizationId);
  const transcript = aiConfig
    ? await transcribeAudio({ aiConfig, base64: audio.base64, mimeType: audio.mimeType })
    : null;

  if (!transcript) {
    return '[O cliente enviou um áudio que não foi possível ouvir. Peça com gentileza que ele escreva a mensagem.]';
  }

  if (messageId) {
    const { data: msg } = await supabase
      .from('messaging_messages')
      .select('content')
      .eq('id', messageId)
      .maybeSingle();

    const { error } = await supabase
      .from('messaging_messages')
      .update({
        content: { ...((msg?.content as Record<string, unknown>) ?? { type: 'audio' }), transcription: transcript },
      })
      .eq('id', messageId);
    if (error) console.error('[AI Process] Failed to save audio transcription:', error);
  }

  return `[Áudio transcrito] ${transcript}`;
}

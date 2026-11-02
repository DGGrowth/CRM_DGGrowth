/**
 * @fileoverview Transcrição de áudios recebidos pelo WhatsApp.
 *
 * Usa o mesmo modelo Gemini da organização (aceita áudio como entrada).
 *
 * @module lib/ai/agent/transcribe-audio
 */

import { generateText } from 'ai';
import { getModel } from '@/lib/ai/config';
import type { OrgAIConfig } from './agent.service';

const TRANSCRIBE_PROMPT =
  'Transcreva fielmente o áudio abaixo, no idioma falado (provavelmente português do Brasil). ' +
  'Responda somente com a transcrição, sem comentários. ' +
  'Se não houver fala compreensível, responda exatamente: [inaudível]';

/**
 * Retorna o texto falado no áudio, ou null se a transcrição falhar ou o áudio for inaudível.
 */
export async function transcribeAudio(params: {
  aiConfig: Pick<OrgAIConfig, 'provider' | 'apiKey' | 'model'>;
  base64: string;
  mimeType: string;
}): Promise<string | null> {
  const { aiConfig, base64, mimeType } = params;

  try {
    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
    const { text } = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: TRANSCRIBE_PROMPT },
            { type: 'file', data: base64, mediaType: mimeType },
          ],
        },
      ],
    });

    const transcript = text.trim();
    if (!transcript || transcript === '[inaudível]') return null;
    return transcript;
  } catch (error) {
    console.error('[AIAgent] Audio transcription failed:', error);
    return null;
  }
}

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export const maxDuration = 60;

const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_ATTEMPTS = 3;

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) return req.headers.get('Authorization') === `Bearer ${cronSecret}`;
  // Sem CRON_SECRET configurado: aceita apenas o agendador da Vercel.
  return (req.headers.get('user-agent') ?? '').startsWith('vercel-cron/');
}

async function graph(path: string, params: Record<string, string>, method: 'GET' | 'POST') {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${path}${method === 'GET' ? `?${qs}` : ''}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'POST' ? qs : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `Graph ${path} HTTP ${res.status}`);
  }
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/cron/instagram-autopost
 *
 * Publica no Instagram o próximo post vencido da fila `instagram_posts`
 * (um por execução). Configuração em `instagram_autopost_config`.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);

  const supabase = createStaticAdminClient();

  const { data: config } = await supabase
    .from('instagram_autopost_config')
    .select('ig_user_id, access_token, enabled')
    .eq('id', 1)
    .maybeSingle();

  if (!config?.enabled) return json({ skipped: 'autopost desativado ou sem configuração' });

  const { data: post, error: postErr } = await supabase
    .from('instagram_posts')
    .select('id, image_url, caption, attempts')
    .in('status', ['pending', 'error'])
    .lt('attempts', MAX_ATTEMPTS)
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (postErr) return json({ error: postErr.message }, 500);
  if (!post) return json({ published: 0, message: 'nenhum post vencido' });

  await supabase
    .from('instagram_posts')
    .update({ status: 'publishing', attempts: post.attempts + 1 })
    .eq('id', post.id);

  const token = config.access_token;
  try {
    const container = await graph(
      `${config.ig_user_id}/media`,
      { image_url: post.image_url, caption: post.caption, access_token: token },
      'POST',
    );

    // Aguarda o contêiner ficar pronto (normalmente segundos para imagem).
    for (let i = 0; i < 10; i++) {
      const st = await graph(container.id, { fields: 'status_code', access_token: token }, 'GET');
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') {
        throw new Error(`Contêiner com status ${st.status_code}`);
      }
      await sleep(3000);
    }

    const published = await graph(
      `${config.ig_user_id}/media_publish`,
      { creation_id: container.id, access_token: token },
      'POST',
    );

    let permalink: string | null = null;
    try {
      const info = await graph(published.id, { fields: 'permalink', access_token: token }, 'GET');
      permalink = info.permalink ?? null;
    } catch {
      /* permalink é opcional */
    }

    await supabase
      .from('instagram_posts')
      .update({
        status: 'published',
        ig_media_id: published.id,
        permalink,
        error: null,
        published_at: new Date().toISOString(),
      })
      .eq('id', post.id);

    return json({ published: 1, id: post.id, ig_media_id: published.id, permalink });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron:instagram-autopost]', post.id, message);
    await supabase.from('instagram_posts').update({ status: 'error', error: message }).eq('id', post.id);
    return json({ published: 0, id: post.id, error: message }, 502);
  }
}

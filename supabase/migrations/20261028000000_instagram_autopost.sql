-- Postagem automática no Instagram: configuração + fila de posts.
-- Acesso apenas via service role (RLS ligado, sem policies).

CREATE TABLE IF NOT EXISTS public.instagram_autopost_config (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ig_user_id    TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_key   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.instagram_autopost_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.instagram_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url     TEXT NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','publishing','published','error','canceled')),
  ig_media_id   TEXT,
  permalink     TEXT,
  error         TEXT,
  attempts      INT NOT NULL DEFAULT 0,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instagram_posts_due_idx
  ON public.instagram_posts (status, scheduled_at);
ALTER TABLE public.instagram_posts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.instagram_autopost_config ADD COLUMN IF NOT EXISTS trigger_key TEXT;

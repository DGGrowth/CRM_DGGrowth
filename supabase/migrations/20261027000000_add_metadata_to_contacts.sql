-- Os webhooks de mensagens (Meta, Z-API, Evolution) gravam contacts.metadata
-- ao criar o contato automaticamente, mas a coluna nunca foi criada.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

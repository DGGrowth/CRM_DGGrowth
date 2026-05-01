-- ============================================================================
-- Add prospecting fields to contacts
-- ============================================================================
-- Campos vindos do app de prospecção de clínicas:
-- whatsapp, instagram, cnpj, address, score
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS instagram TEXT,
  ADD COLUMN IF NOT EXISTS cnpj TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0;

-- Índice para busca por score (útil para ordenação de leads)
CREATE INDEX IF NOT EXISTS idx_contacts_score
  ON contacts(organization_id, score DESC)
  WHERE score IS NOT NULL AND score > 0;

COMMENT ON COLUMN contacts.whatsapp IS 'Número ou URL do WhatsApp (ex: https://wa.me/5515999999999)';
COMMENT ON COLUMN contacts.instagram IS 'URL do perfil do Instagram';
COMMENT ON COLUMN contacts.cnpj IS 'CNPJ da empresa do contato';
COMMENT ON COLUMN contacts.address IS 'Endereço completo';
COMMENT ON COLUMN contacts.score IS 'Score de prospecção (0-100)';

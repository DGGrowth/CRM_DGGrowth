-- ============================================================================
-- Add website and socios fields to contacts
-- ============================================================================
-- Novos campos vindos do XLSX do LeadScanner:
-- website (site da empresa), socios (lista de sócios do CNPJ)
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS socios TEXT;

COMMENT ON COLUMN contacts.website IS 'Site da empresa do contato';
COMMENT ON COLUMN contacts.socios IS 'Lista de sócios (separados por vírgula)';

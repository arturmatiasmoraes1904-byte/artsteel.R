ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
GRANT SELECT, INSERT, UPDATE, DELETE ON transacoes_financeiras TO nexo_app;

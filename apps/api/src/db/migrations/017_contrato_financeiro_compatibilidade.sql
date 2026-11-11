-- Reconcile columns used by contract creation for databases created before
-- these fields were included in the canonical schema.
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS periodicidade text DEFAULT 'MENSAL';
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS dia_vencimento integer DEFAULT 5;
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS indice_reajuste text DEFAULT 'IGP-M';
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS observacoes text;
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS documento_url text;
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS data_competencia date;
ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS conta_bancaria text DEFAULT 'Conta Principal';
ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS anexos jsonb;
ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE transacoes_financeiras
SET data_competencia = data_vencimento
WHERE data_competencia IS NULL;

ALTER TABLE transacoes_financeiras ALTER COLUMN data_competencia SET NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON contratos_locacao, transacoes_financeiras TO nexo_app;

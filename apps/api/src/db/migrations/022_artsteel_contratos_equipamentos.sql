-- Make rental contract end date optional (indefinite duration) and support automatic monthly renewals.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'contratos_locacao'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%data_fim_prevista%'
  LOOP
    EXECUTE format('ALTER TABLE contratos_locacao DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE contratos_locacao ALTER COLUMN data_fim_prevista DROP NOT NULL;
ALTER TABLE contratos_locacao DROP CONSTRAINT IF EXISTS contratos_locacao_datas_check;
ALTER TABLE contratos_locacao
  ADD CONSTRAINT contratos_locacao_datas_check
  CHECK (data_fim_prevista IS NULL OR data_fim_prevista >= data_inicio);

ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS renovacao_automatica boolean NOT NULL DEFAULT true;
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS ciclos_cobrados integer NOT NULL DEFAULT 1;
ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS proximo_vencimento date;

UPDATE contratos_locacao
SET proximo_vencimento = (data_inicio + (GREATEST(COALESCE(ciclos_cobrados, 1), 1) * INTERVAL '1 month'))::date
WHERE proximo_vencimento IS NULL;

CREATE INDEX IF NOT EXISTS idx_contratos_renovacao_ativa
  ON contratos_locacao (tenant_id, proximo_vencimento)
  WHERE deleted_at IS NULL AND status = 'ATIVO' AND renovacao_automatica = true;

-- Reconcile equipment columns historically applied only via alter-equipamentos.ts.
ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS modelo text;
ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS criticidade text NOT NULL DEFAULT 'Média';
ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS data_aquisicao date;
ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS localizacao text;
ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Accelerate overdue / upcoming payables & receivables queries and idempotent contract billing lookups.
CREATE INDEX IF NOT EXISTS idx_transacoes_financeiras_tipo_vencimento
  ON transacoes_financeiras (tenant_id, tipo, status, data_vencimento ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transacoes_financeiras_contrato_ciclo
  ON transacoes_financeiras (tenant_id, (anexos->>'contrato_id'), (anexos->>'ciclo'))
  WHERE deleted_at IS NULL AND anexos IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON contratos_locacao, equipamentos, transacoes_financeiras TO nexo_app;
  END IF;
END $$;

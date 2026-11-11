-- Mantém compatibilidade com a tabela legada de ordens de manutenção.
ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS tipo_manutencao text;
ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS descricao_problema text;
ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS tecnico_responsavel text;
ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS data_abertura timestamptz NOT NULL DEFAULT now();
ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS data_conclusao timestamptz;
ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE ordens_manutencao
SET tipo_manutencao = COALESCE(tipo_manutencao, tipo),
    descricao_problema = COALESCE(descricao_problema, descricao)
WHERE tipo_manutencao IS NULL OR descricao_problema IS NULL;

DO $$ BEGIN
  ALTER TABLE ordens_manutencao DROP CONSTRAINT IF EXISTS ordens_manutencao_tipo_check;
  ALTER TABLE ordens_manutencao ADD CONSTRAINT ordens_manutencao_tipo_check CHECK (tipo IN ('PREVENTIVA','CORRETIVA','CALIBRACAO'));
  ALTER TABLE ordens_manutencao DROP CONSTRAINT IF EXISTS ordens_manutencao_status_check;
  ALTER TABLE ordens_manutencao ADD CONSTRAINT ordens_manutencao_status_check CHECK (status IN ('ABERTA','EM_ANDAMENTO','CONCLUIDA','CANCELADA'));
END $$;

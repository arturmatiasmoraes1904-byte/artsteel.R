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

CREATE INDEX IF NOT EXISTS ordens_manutencao_tenant_status_idx ON ordens_manutencao(tenant_id, status, data_abertura DESC);

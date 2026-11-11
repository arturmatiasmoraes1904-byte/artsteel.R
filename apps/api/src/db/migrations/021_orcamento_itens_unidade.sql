ALTER TABLE orcamento_itens
  ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'UN',
  ADD COLUMN IF NOT EXISTS medidas jsonb;

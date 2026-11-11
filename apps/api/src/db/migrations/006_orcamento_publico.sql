CREATE TABLE IF NOT EXISTS orcamento_publico_tokens (token uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), orcamento_id uuid NOT NULL REFERENCES orcamentos(id), expira_em timestamptz NOT NULL DEFAULT now()+interval '7 days', UNIQUE(orcamento_id));
INSERT INTO orcamento_publico_tokens(token,tenant_id,orcamento_id) SELECT token_publico,tenant_id,id FROM orcamentos WHERE token_publico IS NOT NULL ON CONFLICT (orcamento_id) DO NOTHING;
GRANT SELECT ON orcamento_publico_tokens TO nexo_app;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS aceite_nome text;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS aceite_documento text;

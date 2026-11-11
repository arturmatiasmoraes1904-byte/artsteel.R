CREATE INDEX IF NOT EXISTS clientes_tenant_nome_idx ON clientes(tenant_id,nome);
CREATE INDEX IF NOT EXISTS transacoes_tenant_vencimento_idx ON transacoes_financeiras(tenant_id,data_vencimento DESC);
CREATE INDEX IF NOT EXISTS orcamentos_tenant_created_idx ON orcamentos(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS producao_cards_workflow_ordem_idx ON producao_cards(tenant_id,workflow_id,ordem,created_at DESC);

CREATE INDEX IF NOT EXISTS produtos_tenant_nome_not_deleted_idx
  ON produtos (tenant_id, nome)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS movimentacoes_estoque_tenant_created_idx
  ON movimentacoes_estoque (tenant_id, created_at DESC);

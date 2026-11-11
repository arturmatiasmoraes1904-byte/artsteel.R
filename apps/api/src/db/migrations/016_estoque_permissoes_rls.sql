ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos FORCE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes_estoque FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'produtos' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON produtos
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'movimentacoes_estoque' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON movimentacoes_estoque
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON produtos, movimentacoes_estoque TO nexo_app;

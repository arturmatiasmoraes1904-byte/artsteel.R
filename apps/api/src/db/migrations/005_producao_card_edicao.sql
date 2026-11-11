ALTER TABLE producao_cards ADD COLUMN IF NOT EXISTS prazo_etapa timestamptz;
CREATE TABLE IF NOT EXISTS producao_card_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), card_id uuid NOT NULL REFERENCES producao_cards(id) ON DELETE CASCADE,
  descricao text NOT NULL, concluido boolean NOT NULL DEFAULT false, concluido_em timestamptz, ordem integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS producao_card_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), card_id uuid NOT NULL REFERENCES producao_cards(id) ON DELETE CASCADE,
  campo text NOT NULL, valor_anterior jsonb, valor_novo jsonb, actor_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS producao_checklist_card_idx ON producao_card_checklist(tenant_id,card_id,ordem);
DO $$ BEGIN
  ALTER TABLE producao_card_checklist ENABLE ROW LEVEL SECURITY; ALTER TABLE producao_card_checklist FORCE ROW LEVEL SECURITY;
  ALTER TABLE producao_card_historico ENABLE ROW LEVEL SECURITY; ALTER TABLE producao_card_historico FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON producao_card_checklist USING (tenant_id=current_tenant_id()) WITH CHECK (tenant_id=current_tenant_id());
  CREATE POLICY tenant_isolation ON producao_card_historico USING (tenant_id=current_tenant_id()) WITH CHECK (tenant_id=current_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON producao_card_checklist,producao_card_historico TO nexo_app;

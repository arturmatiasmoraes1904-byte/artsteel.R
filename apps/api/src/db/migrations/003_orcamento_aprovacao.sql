CREATE TABLE IF NOT EXISTS orcamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cliente_id uuid NOT NULL REFERENCES clientes(id),
  numero serial,
  tipo text NOT NULL DEFAULT 'SERVICO' CHECK (tipo IN ('SERVICO','LOCACAO')),
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','ENVIADO','VISUALIZADO','APROVADO','REPROVADO','VENCIDO')),
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  desconto_geral numeric(14,2) NOT NULL DEFAULT 0,
  validade date,
  condicoes_pagamento text,
  observacoes text,
  token_publico uuid DEFAULT gen_random_uuid(),
  motivo_reprovacao text,
  aprovado_em timestamptz,
  assinatura_ip text,
  assinatura_data timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(tenant_id,id)
);
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'SERVICO';
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS aprovado_em timestamptz;

CREATE TABLE IF NOT EXISTS orcamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  orcamento_id uuid NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  produto_nome text NOT NULL,
  unidade text NOT NULL DEFAULT 'UN',
  medidas jsonb,
  quantidade numeric(10,2) NOT NULL DEFAULT 1,
  valor_unitario numeric(14,2) NOT NULL,
  desconto numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL,
  UNIQUE(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL, descricao text, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id), nome text NOT NULL, cor text DEFAULT '#6b7280', ordem integer NOT NULL,
  sla_horas integer, exige_motivo_retorno boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS producao_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id), stage_id uuid NOT NULL REFERENCES workflow_stages(id), cliente_id uuid REFERENCES clientes(id),
  orcamento_id uuid UNIQUE REFERENCES orcamentos(id), titulo text NOT NULL, descricao text, prioridade text NOT NULL DEFAULT 'NORMAL',
  valor numeric(14,2) NOT NULL DEFAULT 0, data_entrega date, dados_customizados jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordem integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, UNIQUE(tenant_id,id)
);
ALTER TABLE producao_cards ADD COLUMN IF NOT EXISTS orcamento_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS producao_cards_orcamento_unique ON producao_cards(orcamento_id) WHERE orcamento_id IS NOT NULL;

ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS orcamento_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS transacoes_financeiras_orcamento_unique ON transacoes_financeiras(orcamento_id) WHERE orcamento_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS orcamento_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), orcamento_id uuid NOT NULL REFERENCES orcamentos(id),
  evento text NOT NULL, motivo text, actor_user_id uuid REFERENCES users(id), ip text, user_agent text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);

CREATE INDEX IF NOT EXISTS idx_orcamentos_status ON orcamentos(tenant_id,status);
CREATE INDEX IF NOT EXISTS idx_orcamento_historico_orcamento ON orcamento_historico(tenant_id,orcamento_id,created_at);

DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['orcamentos','orcamento_itens','workflows','workflow_stages','producao_cards','orcamento_historico'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    BEGIN EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_tenant_id()) WITH CHECK (tenant_id=current_tenant_id())',tab); EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON orcamentos,orcamento_itens,workflows,workflow_stages,producao_cards,orcamento_historico,transacoes_financeiras TO nexo_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO nexo_app;

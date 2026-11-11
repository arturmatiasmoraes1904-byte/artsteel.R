CREATE TABLE IF NOT EXISTS financeiro_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  transacao_id uuid NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  valor_dispensado numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_dispensado >= 0),
  metodo text NOT NULL CHECK (metodo IN ('DINHEIRO','PIX','CARTAO_CREDITO','CARTAO_DEBITO','BOLETO','TRANSFERENCIA','OUTRO','LEGADO')),
  metodo_outro text,
  data_pagamento date NOT NULL,
  observacao text,
  registrado_por uuid REFERENCES users(id),
  registrado_em timestamptz NOT NULL DEFAULT now(),
  revertido_em timestamptz,
  revertido_por uuid REFERENCES users(id),
  justificativa_reversao text,
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,transacao_id) REFERENCES transacoes_financeiras(tenant_id,id),
  CHECK (metodo <> 'OUTRO' OR nullif(trim(metodo_outro),'') IS NOT NULL),
  CHECK (revertido_em IS NULL OR (revertido_por IS NOT NULL AND length(trim(justificativa_reversao)) >= 10))
);

CREATE INDEX IF NOT EXISTS financeiro_pagamentos_tenant_transacao_idx
  ON financeiro_pagamentos(tenant_id,transacao_id,registrado_em);

-- Preserve existing paid titles even though their original payment details are unknown.
INSERT INTO financeiro_pagamentos(
  tenant_id,transacao_id,valor,metodo,data_pagamento,observacao
)
SELECT t.tenant_id,t.id,t.valor,'LEGADO',coalesce(t.data_pagamento,t.created_at::date),
       'Baixa anterior ao histórico detalhado de pagamentos.'
FROM transacoes_financeiras t
WHERE t.status='PAGO'
  AND NOT EXISTS (
    SELECT 1 FROM financeiro_pagamentos p
    WHERE p.tenant_id=t.tenant_id AND p.transacao_id=t.id
  );

ALTER TABLE financeiro_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro_pagamentos FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON financeiro_pagamentos
    USING (tenant_id=current_tenant_id()) WITH CHECK (tenant_id=current_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT,INSERT,UPDATE,DELETE ON financeiro_pagamentos TO nexo_app;

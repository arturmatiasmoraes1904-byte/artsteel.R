import postgres from 'postgres';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS orcamentos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      cliente_id uuid NOT NULL REFERENCES clientes(id),
      numero serial,
      status text DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','ENVIADO','VISUALIZADO','APROVADO','REPROVADO','VENCIDO')),
      valor_total numeric(14,2) DEFAULT 0,
      desconto_geral numeric(14,2) DEFAULT 0,
      validade date,
      condicoes_pagamento text,
      observacoes text,
      token_publico uuid DEFAULT gen_random_uuid(),
      motivo_reprovacao text,
      assinatura_ip text,
      assinatura_data timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE(tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS orcamento_itens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      orcamento_id uuid NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
      produto_nome text NOT NULL,
      unidade text NOT NULL DEFAULT 'UN',
      medidas jsonb,
      quantidade numeric(10,2) DEFAULT 1,
      valor_unitario numeric(14,2) NOT NULL,
      desconto numeric(14,2) DEFAULT 0,
      total numeric(14,2) NOT NULL,
      UNIQUE(tenant_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente ON orcamentos(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_orcamentos_status ON orcamentos(status);
  `);
  console.log("Orcamentos tables created successfully.");
} catch (error) {
  console.error("Error:", error);
} finally {
  await client.end();
}

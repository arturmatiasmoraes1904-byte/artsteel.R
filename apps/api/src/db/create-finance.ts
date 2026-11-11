import postgres from 'postgres';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe(`
  CREATE TABLE transacoes_financeiras (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
    tipo text NOT NULL CHECK (tipo IN ('RECEITA','DESPESA','TRANSFERENCIA')), 
    descricao text NOT NULL,
    valor numeric(14,2) NOT NULL CHECK (valor>=0), 
    data_competencia date NOT NULL,
    data_vencimento date NOT NULL, 
    data_pagamento date,
    status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PAGO','ATRASADO','CANCELADO')),
    categoria text NOT NULL, 
    conta_bancaria text DEFAULT 'Conta Principal',
    cliente_id uuid, 
    parent_id uuid REFERENCES transacoes_financeiras(id),
    anexos jsonb,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id,id), 
    FOREIGN KEY(tenant_id,cliente_id) REFERENCES clientes(tenant_id,id)
  );
  CREATE INDEX ON transacoes_financeiras(tenant_id,data_vencimento,status);
  `);
  console.log("transacoes_financeiras created successfully.");
} catch (error) {
  console.error("Error:", error);
} finally {
  await client.end();
}

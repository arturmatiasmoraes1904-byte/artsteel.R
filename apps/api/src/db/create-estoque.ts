import postgres from 'postgres';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe(`
  CREATE TABLE IF NOT EXISTS produtos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    nome text NOT NULL,
    sku text,
    ean text,
    ncm text,
    unidade text DEFAULT 'UN',
    custo_medio numeric(14,2) DEFAULT 0,
    preco_venda numeric(14,2) DEFAULT 0,
    estoque_atual numeric(14,3) DEFAULT 0,
    estoque_minimo numeric(14,3) DEFAULT 0,
    localizacao text,
    status text DEFAULT 'ATIVO',
    deleted_at timestamptz,
    created_at timestamptz DEFAULT now(),
    UNIQUE(tenant_id, sku)
  );

  CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    produto_id uuid NOT NULL REFERENCES produtos(id),
    tipo text NOT NULL CHECK (tipo IN ('ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA')),
    quantidade numeric(14,3) NOT NULL,
    custo_unitario numeric(14,2) DEFAULT 0,
    motivo text NOT NULL,
    documento text,
    responsavel_id uuid,
    created_at timestamptz DEFAULT now()
  );
  `);
  console.log("Estoque tables created successfully.");
} catch (error) {
  console.error("Error:", error);
} finally {
  await client.end();
}

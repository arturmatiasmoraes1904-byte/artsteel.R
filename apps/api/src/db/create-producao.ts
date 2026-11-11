import postgres from 'postgres';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS workflows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      nome text NOT NULL,
      descricao text,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE(tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS workflow_stages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      workflow_id uuid NOT NULL REFERENCES workflows(id),
      nome text NOT NULL,
      cor text DEFAULT '#6b7280',
      ordem integer NOT NULL,
      sla_horas integer,
      exige_motivo_retorno boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE(tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS producao_cards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      workflow_id uuid NOT NULL REFERENCES workflows(id),
      stage_id uuid NOT NULL REFERENCES workflow_stages(id),
      cliente_id uuid REFERENCES clientes(id),
      titulo text NOT NULL,
      descricao text,
      prioridade text DEFAULT 'NORMAL' CHECK (prioridade IN ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE')),
      valor numeric(14,2) DEFAULT 0,
      data_entrega date,
      dados_customizados jsonb DEFAULT '{}'::jsonb,
      ordem integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE(tenant_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_stages_workflow ON workflow_stages(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_producao_cards_stage ON producao_cards(stage_id);
  `);
  console.log("Producao tables created successfully.");
} catch (error) {
  console.error("Error:", error);
} finally {
  await client.end();
}

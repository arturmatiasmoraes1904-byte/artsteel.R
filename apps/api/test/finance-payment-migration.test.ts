import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 018 preserves old paid transactions and installs tenant-isolated payment history', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE ROLE nexo_app;
      CREATE TABLE tenants(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY, name text NOT NULL);
      CREATE TABLE transacoes_financeiras(
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        valor numeric(14,2) NOT NULL,
        status text NOT NULL,
        data_pagamento date,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id,id)
      );
      CREATE FUNCTION current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.current_tenant_id',true),'')::uuid
      $$;
      INSERT INTO tenants VALUES('10000000-0000-4000-8000-000000000001');
      INSERT INTO transacoes_financeiras(id,tenant_id,valor,status,data_pagamento)
      VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',125.50,'PAGO','2026-10-01');
    `);
    const migration = await readFile(new URL('../src/db/migrations/018_financeiro_baixas_auditoria.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    await pg.exec(migration);
    const result = await pg.query<{valor:string;metodo:string;data_pagamento:string;observacao:string}>(
      'SELECT valor::text,metodo,data_pagamento::text,observacao FROM financeiro_pagamentos'
    );
    assert.equal(result.rows.length,1);
    assert.deepEqual(result.rows[0],{
      valor:'125.50',metodo:'LEGADO',data_pagamento:'2026-10-01',
      observacao:'Baixa anterior ao histórico detalhado de pagamentos.'
    });
    const rls = await pg.query<{relrowsecurity:boolean;relforcerowsecurity:boolean}>(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='financeiro_pagamentos'"
    );
    assert.equal(rls.rows[0].relrowsecurity,true);
    assert.equal(rls.rows[0].relforcerowsecurity,true);
  } finally {
    await pg.close();
  }
});

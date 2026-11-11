import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration 017 reconciles a legacy contract and finance schema', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE ROLE nexo_app;
      CREATE TABLE contratos_locacao (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      CREATE TABLE transacoes_financeiras (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        data_vencimento date NOT NULL
      );
      INSERT INTO transacoes_financeiras (id, tenant_id, data_vencimento)
      VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-10-20');
    `);
    await pg.exec(await readFile(new URL('../src/db/migrations/017_contrato_financeiro_compatibilidade.sql', import.meta.url), 'utf8'));

    const contractColumns = await pg.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'contratos_locacao'
    `);
    const financeColumns = await pg.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'transacoes_financeiras'
    `);
    assert.ok(contractColumns.rows.some(column => column.column_name === 'deleted_at'));
    assert.ok(contractColumns.rows.some(column => column.column_name === 'periodicidade'));
    assert.ok(financeColumns.rows.some(column => column.column_name === 'anexos'));

    const [transaction] = (await pg.query<{ data_competencia: string; conta_bancaria: string }>(`
      SELECT data_competencia::text, conta_bancaria FROM transacoes_financeiras
    `)).rows;
    assert.deepEqual(transaction, { data_competencia: '2026-10-20', conta_bancaria: 'Conta Principal' });
  } finally {
    await pg.close();
  }
});

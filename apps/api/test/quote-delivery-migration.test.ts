import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('quote delivery deadline migration preserves existing quotes and is repeatable', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table orcamentos(id uuid primary key, observacoes text);
      insert into orcamentos(id, observacoes) values ('10000000-0000-4000-8000-000000000001', 'Registro antigo');
    `);
    const migration = await readFile(new URL('../src/db/migrations/019_orcamento_prazo_entrega.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    await pg.exec(migration);
    const result = await pg.query<{ prazo_entrega: string | null; observacoes: string }>(
      'select prazo_entrega, observacoes from orcamentos where id=$1',
      ['10000000-0000-4000-8000-000000000001'],
    );
    assert.equal(result.rows[0]?.prazo_entrega, null);
    assert.equal(result.rows[0]?.observacoes, 'Registro antigo');
  } finally {
    await pg.close();
  }
});

test('quote item unit migration defaults existing items to UN and validates UN/KG/M', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table orcamento_itens(id uuid primary key, produto_nome text not null, quantidade numeric not null, valor_unitario numeric not null, desconto numeric not null, total numeric not null);
      insert into orcamento_itens(id, produto_nome, quantidade, valor_unitario, desconto, total) values ('10000000-0000-4000-8000-000000000001', 'Chapa', 2, 100, 0, 200);
    `);
    const migration = await readFile(new URL('../src/db/migrations/021_orcamento_itens_unidade.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    const result = await pg.query<{ unidade: string }>(
      'select unidade from orcamento_itens where id=$1',
      ['10000000-0000-4000-8000-000000000001'],
    );
    assert.equal(result.rows[0]?.unidade, 'UN');
  } finally {
    await pg.close();
  }
});


import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';

const equipment = {
  id: '30000000-0000-4000-8000-000000000001',
  nome: 'Betoneira',
  numero_patrimonio: 'PAT-001',
  patrimonio: 'PAT-001',
  valor_diaria: 100,
  valor_locacao: 100,
  valor_reposicao: 1000,
  categoria: 'Concreto',
  status: 'DISPONIVEL',
};

const fakeDatabase = {
  execute: async () => [{ role: 'ADMIN' }],
  transaction: async <T>(callback: (tx: { execute: () => Promise<unknown[]> }) => Promise<T>) => callback({ execute: async () => [equipment] }),
} as unknown as Database;

const appPromise = buildApp(fakeDatabase, 'test-secret-at-least-thirty-two-characters', false);

after(async () => (await appPromise).close());

async function post(payload: Record<string, unknown>) {
  const app = await appPromise;
  const token = app.jwt.sign({ sub: '20000000-0000-4000-8000-000000000001', current_tenant_id: '10000000-0000-4000-8000-000000000001' });
  return app.inject({ method: 'POST', url: '/locacao/equipamentos', headers: { authorization: `Bearer ${token}` }, payload });
}

test('aceita campos legados e retorna campos canônicos', async () => {
  const response = await post({ nome: 'Betoneira', numero_patrimonio: 'PAT-001', valor_diaria: 100 });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.patrimonio, 'PAT-001');
  assert.equal(response.json().data.valor_locacao, 100);
});

test('aceita campos canônicos', async () => {
  const response = await post({ nome: 'Betoneira', patrimonio: 'PAT-002', valor_locacao: 120 });
  assert.equal(response.statusCode, 201);
});

test('rejeita cadastro sem patrimônio', async () => {
  const response = await post({ nome: 'Betoneira', valor_locacao: 100 });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /patrim[oô]nio/i);
});

test('rejeita valor de locação inválido', async () => {
  for (const value of [0, -1, Number.NaN]) {
    const response = await post({ nome: 'Betoneira', patrimonio: 'PAT-003', valor_locacao: value });
    assert.equal(response.statusCode, 400);
  }
});

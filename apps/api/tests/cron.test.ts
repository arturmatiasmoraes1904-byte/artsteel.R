import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';

const fakeDatabase = {
  execute: async () => [],
  transaction: async <T>(callback: (tx: { execute: () => Promise<unknown[]> }) => Promise<T>) => callback({ execute: async () => [] }),
} as unknown as Database;

const appPromise = buildApp(fakeDatabase, 'test-secret-at-least-thirty-two-characters', false);

after(async () => {
  delete process.env.CRON_SECRET;
  await (await appPromise).close();
});

test('valida CRON_SECRET antes de executar o cron', async () => {
  delete process.env.CRON_SECRET;
  let response = await (await appPromise).inject({ method: 'POST', url: '/cron/check-contracts' });
  assert.equal(response.statusCode, 401);
  process.env.CRON_SECRET = 'correct-secret';
  response = await (await appPromise).inject({ method: 'POST', url: '/cron/check-contracts', headers: { 'x-cron-secret': 'wrong-secret' } });
  assert.equal(response.statusCode, 401);
  response = await (await appPromise).inject({ method: 'POST', url: '/cron/check-contracts', headers: { 'x-cron-secret': 'correct-secret' } });
  assert.equal(response.statusCode, 200);
  response = await (await appPromise).inject({ method: 'GET', url: '/cron/check-contracts', headers: { authorization: 'Bearer wrong-secret' } });
  assert.equal(response.statusCode, 401);
  response = await (await appPromise).inject({ method: 'GET', url: '/cron/check-contracts', headers: { authorization: 'Bearer correct-secret' } });
  assert.equal(response.statusCode, 200);
});

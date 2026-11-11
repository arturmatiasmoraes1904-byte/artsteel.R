import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

export function createDatabase(url: string) {
  const client = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15 });
  const db = drizzle(client);
  return { db, close: () => client.end() };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// set_config(..., true) is the parameterized equivalent of SET LOCAL.
// Every tenant query must use the transaction connection passed to callback.
export async function withTenant<T>(db: Database, tenantId: string, callback: (tx: Transaction) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`);
    return callback(tx);
  });
}


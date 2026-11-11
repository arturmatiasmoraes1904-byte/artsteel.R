import postgres from 'postgres';

if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefone text;');
  await client.unsafe('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco jsonb;');
  await client.unsafe('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS status text DEFAULT \'ATIVO\';');
  await client.unsafe('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;');
  console.log("Columns added successfully.");
} catch (error) {
  console.error("Error altering table:", error);
} finally {
  await client.end();
}

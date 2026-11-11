import postgres from 'postgres';

if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe('ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS data_competencia date;');
  await client.unsafe('ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS conta_bancaria text DEFAULT \'Conta Principal\';');
  await client.unsafe('ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS anexos jsonb;');
  await client.unsafe('ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS parent_id uuid;');
  await client.unsafe('ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS deleted_at timestamptz;');
  // Set data_competencia = data_vencimento for existing records
  await client.unsafe('UPDATE transacoes_financeiras SET data_competencia = data_vencimento WHERE data_competencia IS NULL;');
  console.log("Financeiro columns added successfully.");
} catch (error) {
  console.error("Error altering financeiro table:", error);
} finally {
  await client.end();
}

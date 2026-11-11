import postgres from 'postgres';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe(`
    ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS periodicidade text DEFAULT 'MENSAL';
    ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS dia_vencimento integer DEFAULT 5;
    ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS indice_reajuste text DEFAULT 'IGP-M';
    ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS observacoes text;
    ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS documento_url text;
    ALTER TABLE contratos_locacao ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  `);
  console.log("Contratos tables altered successfully.");
} catch (error) {
  console.error("Error:", error);
} finally {
  await client.end();
}

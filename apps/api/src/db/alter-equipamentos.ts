import postgres from 'postgres';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  await client.unsafe(`
    ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS numero_patrimonio text;
    ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS qr_code text;
    ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS categoria text DEFAULT 'Geral';
    ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS criticidade text DEFAULT 'Média' CHECK (criticidade IN ('Alta', 'Média', 'Baixa'));
    ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS data_aquisicao date;
    ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS localizacao text;
    ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    
    ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS tipo_manutencao text DEFAULT 'CORRETIVA' CHECK (tipo_manutencao IN ('PREVENTIVA', 'CORRETIVA', 'CALIBRACAO'));
    ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS tecnico_responsavel text;
    ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS diagnostico text;
    ALTER TABLE ordens_manutencao ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  `);
  console.log("Equipamentos tables altered successfully.");
} catch (error) {
  console.error("Error:", error);
} finally {
  await client.end();
}

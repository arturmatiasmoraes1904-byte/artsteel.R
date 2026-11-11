import postgres from 'postgres';
import { readFile } from 'node:fs/promises';

if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1 });
try {
  const sqlContent = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await client.unsafe(sqlContent);
  console.log("Schema applied successfully.");
} catch (error) {
  console.error("Error applying schema:", error);
} finally {
  await client.end();
}

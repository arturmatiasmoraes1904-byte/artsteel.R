import { sql } from 'drizzle-orm';
import { createDatabase } from './db/client.js';
import { buildApp } from './app.js';
if(!process.env.DATABASE_URL || !process.env.JWT_SECRET) throw new Error('Configure DATABASE_URL e JWT_SECRET em apps/api/.env.');
const connection=createDatabase(process.env.DATABASE_URL);
try {
  const [role]=await connection.db.execute(sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`);
  if(role.rolsuper||role.rolbypassrls) throw new Error('A API não pode usar superuser ou BYPASSRLS. Use nexo_app.');
  const app=await buildApp(connection.db,process.env.JWT_SECRET);
  app.addHook('onClose',async()=>connection.close());
  for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{void app.close();});
  await app.listen({port:Number(process.env.PORT??3333),host:process.env.HOST??'0.0.0.0'});
} catch(error){await connection.close();throw error;}

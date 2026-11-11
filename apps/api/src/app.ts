import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Database } from './db/client.js';
import { authRoutes } from './controllers/auth.js';
import { operationsRoutes } from './controllers/operations.js';
import { dashboardRoutes } from './controllers/dashboards.js';
import { clientesRoutes } from './controllers/clientes.js';
import { financeiroRoutes } from './controllers/financeiro.js';
import { estoqueRoutes } from './controllers/estoque.js';
import { equipamentosRoutes } from './controllers/equipamentos.js';
import { contratosRoutes } from './controllers/contratos.js';
import { producaoRoutes } from './controllers/producao.js';
import { orcamentosRoutes } from './controllers/orcamentos.js';
import { cronRoutes } from './controllers/cron.js';
import { publicoRoutes } from './controllers/publico.js';
import { buscaRoutes } from './controllers/busca.js';

export async function buildApp(db:Database,secret:string,logger=true){
  if(secret.length<32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
  const app=Fastify({logger,bodyLimit:1048576});
  const configuredOrigins=(process.env.WEB_ORIGIN??'http://localhost:3000')
    .split(',')
    .map(origin=>origin.trim())
    .filter(Boolean);
  const allowedOrigins=new Set([
    ...configuredOrigins,
    'https://nexo-operacoes-web-4bug.vercel.app',
    'https://nexo-operacoes-web-4bug-git-main-clinica-360.vercel.app',
  ]);
  await app.register(cors,{
    origin:(origin,callback)=>callback(null,!origin||allowedOrigins.has(origin)),
    methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  });
  await app.register(jwt,{secret});
  await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
  app.setErrorHandler((error,req,reply)=>{
    const e=error as Error & {statusCode?:number;code?:string;cause?:{code?:string}};
    const pgCode=e.cause?.code??e.code;
    const validation=error instanceof ZodError;
    const conflict=pgCode==='23505';
    const reference=pgCode==='23503';
    const missingDatabaseObject=pgCode==='42703'||pgCode==='42P01';
    const databasePermission=pgCode==='42501';
    const status=validation?400:conflict?409:reference?400:e.statusCode??500;
    if(status>=500) req.log.error(error);
    const message=validation?error.issues.map(i=>i.message).join('; ')
      :conflict?'Registro já cadastrado.'
      :reference?'Referência inválida nesta empresa.'
      :missingDatabaseObject?'A estrutura do banco está desatualizada. Aplique as migrations da API e tente novamente.'
      :databasePermission?'A API está sem permissão para realizar esta operação. Revise as permissões do banco.'
      :status>=500?'Não foi possível concluir a operação. Consulte o suporte com o código de referência.'
      :e.message;
    reply.code(status).send({success:false,data:null,error:{code:validation?'VALIDATION_ERROR':conflict?'CONFLICT':reference?'INVALID_REFERENCE':missingDatabaseObject?'DATABASE_MIGRATION_REQUIRED':databasePermission?'DATABASE_PERMISSION_DENIED':status>=500?'INTERNAL_ERROR':e.code??'REQUEST_ERROR',message,...(status>=500?{reference:req.id}:{})}});
  });
  app.setNotFoundHandler((_req,reply)=>reply.code(404).send({success:false,data:null,error:{code:'NOT_FOUND',message:'Rota não encontrada.'}}));
  app.get('/health',async()=>({success:true,data:{status:'ok'},error:null}));
  await publicoRoutes(app,db);
  await authRoutes(app,db);
  await app.register(async scoped=>buscaRoutes(scoped,db));
  await app.register(async scoped=>operationsRoutes(scoped,db));
  await app.register(async scoped=>dashboardRoutes(scoped,db));
  await app.register(async scoped=>clientesRoutes(scoped,db));
  await app.register(async scoped=>financeiroRoutes(scoped,db));
  await app.register(async scoped=>estoqueRoutes(scoped,db));
  await app.register(async scoped=>equipamentosRoutes(scoped,db));
  await app.register(async scoped=>contratosRoutes(scoped,db));
  await app.register(async scoped=>producaoRoutes(scoped,db));
  await app.register(async scoped=>orcamentosRoutes(scoped,db));
  await app.register(async scoped=>cronRoutes(scoped,db));
  return app;
}

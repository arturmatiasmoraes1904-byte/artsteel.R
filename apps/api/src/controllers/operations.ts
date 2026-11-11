import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';
import { calculateQuote, quoteSchema } from '../services/quote.js';
import { pageQuery, pageResult, safeSort } from '../lib/pagination.js';
import { getTenantSettings } from '../services/tenant-settings.js';
const ok = (data: unknown) => ({ success: true, data, error: null });
export const stages = ['CORTE','SOLDA','MONTAGEM','ACABAMENTO','INSTALACAO_EXTERNA','CONCLUIDO'] as const;
export async function operationsRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    const [tenant] = await db.execute(sql`select segmento from tenants where id=${req.user.current_tenant_id}::uuid`);
    const segment = String(tenant?.segmento);
    if ((req.url.startsWith('/locacao/') && !['LOCADORA','MISTO'].includes(segment)) || (req.url.startsWith('/serralheria/') && !['SERRALHERIA','MISTO'].includes(segment))) throw new HttpError(403, 'SEGMENT_DENIED', 'Módulo indisponível para esta empresa.');
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN','OPERADOR']);
  });
  app.get('/empresa', async req => {
    const [row] = await db.execute(sql`
      select id, segmento, nome_fantasia, razao_social, cnpj, telefone, email, inscricao_estadual,
        cep, logradouro, numero, bairro, cidade, estado
      from tenants where id=${req.user.current_tenant_id}::uuid
    `);
    const s = getTenantSettings(String(req.user.current_tenant_id), String(row?.segmento));
    return ok({
      id: req.user.current_tenant_id,
      segmento: row?.segmento,
      nome_fantasia: s.nome_fantasia || row?.nome_fantasia,
      razao_social: s.razao_social || row?.razao_social,
      cnpj: s.cnpj || row?.cnpj,
      telefone: row?.telefone ?? s.telefone ?? '',
      email: row?.email ?? s.email ?? '',
      inscricao_estadual: row?.inscricao_estadual ?? s.inscricao_estadual ?? '',
      cep: row?.cep ?? s.cep ?? '',
      logradouro: row?.logradouro ?? s.logradouro ?? '',
      numero: row?.numero ?? s.numero ?? '',
      bairro: row?.bairro ?? s.bairro ?? '',
      cidade: row?.cidade ?? s.cidade ?? '',
      estado: row?.estado ?? s.estado ?? '',
      updated_at: row?.updated_at ?? s.updated_at
    });
  });

  app.put('/empresa', async req => {
    const schema = z.object({
      nome_fantasia: z.string().min(2, 'Nome fantasia deve ter pelo menos 2 caracteres').max(100),
      razao_social: z.string().min(2, 'Razão social deve ter pelo menos 2 caracteres').max(100),
      cnpj: z.string().min(11, 'CNPJ inválido').max(25),
      telefone: z.string().max(30).optional().nullable(),
      email: z.string().email('E-mail inválido').optional().nullable().or(z.literal('')),
      inscricao_estadual: z.string().max(30).optional().nullable(),
      cep: z.string().max(15).optional().nullable(),
      logradouro: z.string().max(150).optional().nullable(),
      numero: z.string().max(30).optional().nullable(),
      bairro: z.string().max(100).optional().nullable(),
      cidade: z.string().max(100).optional().nullable(),
      estado: z.string().max(50).optional().nullable(),
    });
    const body = schema.parse(req.body);

    const [row] = await db.execute(sql`
      select id, segmento, nome_fantasia, razao_social, cnpj
      from tenants where id=${req.user.current_tenant_id}::uuid
    `);

    const [updated] = await db.execute(sql`
      update tenants
      set nome_fantasia=${body.nome_fantasia},
          razao_social=${body.razao_social},
          cnpj=${body.cnpj},
          telefone=${body.telefone ?? null},
          email=${body.email ?? null},
          inscricao_estadual=${body.inscricao_estadual ?? null},
          cep=${body.cep ?? null},
          logradouro=${body.logradouro ?? null},
          numero=${body.numero ?? null},
          bairro=${body.bairro ?? null},
          cidade=${body.cidade ?? null},
          estado=${body.estado ?? null}
      where id=${req.user.current_tenant_id}::uuid
      returning id, segmento, nome_fantasia, razao_social, cnpj, telefone, email,
        inscricao_estadual, cep, logradouro, numero, bairro, cidade, estado,
        now() as updated_at
    `);
    return ok({
      id: req.user.current_tenant_id,
      segmento: updated?.segmento ?? row?.segmento,
      ...updated
    });
  });

  // Rotas de Locação antigas removidas (agora em controllers separados)

  app.post('/serralheria/orcamentos/calcular',async req=>ok(calculateQuote(quoteSchema.parse(req.body))));
  app.post('/serralheria/orcamentos',async req=>{
    const b=quoteSchema.parse(req.body), q=calculateQuote(b);
    return ok(await withTenant(db,req.user.current_tenant_id,async tx=>(await tx.execute(sql`insert into orcamentos_projetos(tenant_id,descricao_projeto,peso_total_calculado_kg,custo_materia_prima,custo_mao_obra,custo_acabamento,margem_lucro_pct,valor_final) values(${req.user.current_tenant_id}::uuid,${b.descricao_projeto},${q.peso_total_calculado_kg},${q.custo_materia_prima},${q.custo_mao_obra},${q.custo_acabamento},${q.margem_lucro_pct},${q.valor_final}) returning *`))[0]));
  });
  app.get('/serralheria/orcamentos',async req=>{
    const page=pageQuery(req.query); const sort=safeSort(page.sort,{created_at:'created_at',valor_final:'valor_final',descricao_projeto:'descricao_projeto'} ,'created_at');
    return ok(await withTenant(db,req.user.current_tenant_id,async tx=>{const term=page.search?`%${page.search}%`:null;const [count]=await tx.execute(sql`select count(*)::int total from orcamentos_projetos where (${term}::text is null or descricao_projeto ilike ${term})`);const rows=await tx.execute(sql`select * from orcamentos_projetos where (${term}::text is null or descricao_projeto ilike ${term}) order by ${sql.raw(sort.column)} ${sql.raw(sort.direction)} limit ${page.limit} offset ${page.offset}`);return pageResult(rows,page.page,page.limit,Number(count.total));}));
  });
  app.get('/serralheria/estoque-metais',async req=>{
    const page=pageQuery(req.query); const sort=safeSort(page.sort,{descricao:'descricao',created_at:'created_at'},'descricao');
    return ok(await withTenant(db,req.user.current_tenant_id,async tx=>{const term=page.search?`%${page.search}%`:null;const [count]=await tx.execute(sql`select count(*)::int total from materias_primas where (${term}::text is null or descricao ilike ${term})`);const rows=await tx.execute(sql`select * from materias_primas where (${term}::text is null or descricao ilike ${term}) order by ${sql.raw(sort.column)} ${sql.raw(sort.direction)} limit ${page.limit} offset ${page.offset}`);return pageResult(rows,page.page,page.limit,Number(count.total));}));
  });
  app.get('/serralheria/ordens-servico',async req=>{
    const page=pageQuery(req.query); const sort=safeSort(page.sort,{data_entrega_prometida:'data_entrega_prometida',created_at:'os.created_at'},'data_entrega_prometida');
    return ok(await withTenant(db,req.user.current_tenant_id,async tx=>{const term=page.search?`%${page.search}%`:null;const [count]=await tx.execute(sql`select count(*)::int total from ordens_servico_serralheria os join orcamentos_projetos o on o.tenant_id=os.tenant_id and o.id=os.orcamento_id where (${term}::text is null or o.descricao_projeto ilike ${term})`);const rows=await tx.execute(sql`select os.*,o.descricao_projeto,o.valor_final from ordens_servico_serralheria os join orcamentos_projetos o on o.tenant_id=os.tenant_id and o.id=os.orcamento_id where (${term}::text is null or o.descricao_projeto ilike ${term}) order by ${sql.raw(sort.column)} ${sql.raw(sort.direction)} limit ${page.limit} offset ${page.offset}`);return pageResult(rows,page.page,page.limit,Number(count.total));}));
  });
  app.post('/serralheria/ordens-servico',async req=>{
    const b=z.object({orcamento_id:z.uuid(),data_entrega_prometida:z.iso.date()}).strict().parse(req.body);
    return ok(await withTenant(db,req.user.current_tenant_id,async tx=>(await tx.execute(sql`insert into ordens_servico_serralheria(tenant_id,orcamento_id,data_entrega_prometida) values(${req.user.current_tenant_id}::uuid,${b.orcamento_id}::uuid,${b.data_entrega_prometida}) returning *`))[0]));
  });
  app.patch('/serralheria/ordens-servico/:id/etapa',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params);
    const {status_etapa}=z.object({status_etapa:z.enum(stages)}).strict().parse(req.body);
    return ok(await withTenant(db,req.user.current_tenant_id,async tx=>{
      const [current]=await tx.execute(sql`select status_etapa from ordens_servico_serralheria where id=${id}::uuid for update`);
      if(!current) throw new HttpError(404,'NOT_FOUND','Ordem não encontrada.');
      if(stages.indexOf(status_etapa)!==stages.indexOf(current.status_etapa as typeof stages[number])+1) throw new HttpError(409,'INVALID_STAGE','Avance uma etapa por vez.');
      return (await tx.execute(sql`update ordens_servico_serralheria set status_etapa=${status_etapa},concluido_em=${status_etapa==='CONCLUIDO'?sql`now()`:sql`null`} where id=${id}::uuid returning *`))[0];
    }));
  });
}

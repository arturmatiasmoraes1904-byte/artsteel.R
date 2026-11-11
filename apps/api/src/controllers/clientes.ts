import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';
import {pageQuery,pageResult,safeSort} from '../lib/pagination.js';
import { lookupCnpj } from '../services/cnpj.js';
import { isValidDocumento, normalizeDocumento } from '../lib/documento.js';

export async function clientesRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN', 'OPERADOR']);
  });

  app.get('/clientes/cnpj/:cnpj', async req => {
    const rawCnpj = String((req.params as { cnpj?: string }).cnpj ?? '');
    const data = await lookupCnpj(rawCnpj);
    return { success: true, data, error: null };
  });

  app.get('/clientes/documento/:documento', async req => {
    const rawDoc = String((req.params as { documento?: string }).documento ?? '');
    const digits = normalizeDocumento(rawDoc);
    if (!isValidDocumento(digits)) {
      throw new HttpError(400, 'INVALID_DOCUMENT', 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
    }

    if (digits.length === 14) {
      const data = await lookupCnpj(digits);
      return { success: true, data, error: null };
    }

    // CPF (11 dígitos): verifica se já existe cadastro na base da empresa e valida dígitos verificadores
    const existingRows = await withTenant(db, req.user.current_tenant_id, tx =>
      tx.execute(sql`
        SELECT id, nome, documento, email, telefone, endereco, status
        FROM clientes
        WHERE regexp_replace(coalesce(documento, ''), '\D', '', 'g') = ${digits}
          AND status <> 'INATIVO'
        LIMIT 1
      `),
    );

    const existing = existingRows[0] as {
      id?: string;
      nome?: string;
      documento?: string | null;
      email?: string | null;
      telefone?: string | null;
      endereco?: Record<string, string> | string | null;
    } | undefined;

    if (existing && existing.nome) {
      let addr: Record<string, string> = {};
      if (typeof existing.endereco === 'string') {
        try { addr = JSON.parse(existing.endereco); } catch { addr = {}; }
      } else if (existing.endereco && typeof existing.endereco === 'object') {
        addr = existing.endereco;
      }

      return {
        success: true,
        data: {
          cnpj: digits,
          razao_social: existing.nome,
          nome_fantasia: null,
          situacao_cadastral: 'CADASTRADO NA BASE',
          natureza_juridica: 'Pessoa Física (CPF)',
          porte: null,
          capital_social: null,
          data_abertura: null,
          cnae_principal: null,
          telefone: existing.telefone || null,
          email: existing.email || null,
          endereco: {
            cep: addr.cep || '',
            rua: addr.rua || '',
            numero: addr.numero || '',
            complemento: addr.complemento || '',
            bairro: addr.bairro || '',
            cidade: addr.cidade || '',
            uf: addr.uf || '',
          },
          fonte: 'cadastro_interno',
        },
        error: null,
      };
    }

    return {
      success: true,
      data: {
        cnpj: digits,
        razao_social: '',
        nome_fantasia: null,
        situacao_cadastral: 'CPF VÁLIDO',
        natureza_juridica: 'Pessoa Física (CPF)',
        porte: null,
        capital_social: null,
        data_abertura: null,
        cnae_principal: null,
        telefone: null,
        email: null,
        endereco: {
          cep: '',
          rua: '',
          numero: '',
          complemento: '',
          bairro: '',
          cidade: '',
          uf: '',
        },
        fonte: 'validacao_cpf',
      },
      error: null,
    };
  });

  app.get('/clientes/opcoes', async req => {
    const rows = await withTenant(db, req.user.current_tenant_id, tx =>
      tx.execute(sql`select id,nome,documento from clientes where status <> 'INATIVO' order by nome asc limit 100`)
    );
    return { success: true, data: rows, error: null };
  });

  app.get('/clientes', async req => {
    if(!('page' in (req.query as object))&&!('limit' in (req.query as object))&&!('search' in (req.query as object))){const rows=await withTenant(db,req.user.current_tenant_id,tx=>tx.execute(sql`select id,nome,documento,email,telefone,endereco,status from clientes where status <> 'INATIVO' order by nome asc limit 100`));return {success:true,data:rows,error:null};}
    const page=pageQuery(req.query);
    const sort=safeSort(page.sort,{nome:'nome',status:'status'},'nome');
    const result=await withTenant(db,req.user.current_tenant_id,async tx=>{const term=page.search?`%${page.search}%`:null;const status=page.status&&page.status!=='TODOS'?page.status:null;const [count]=await tx.execute(sql`select count(*)::int total from clientes where status <> 'INATIVO' and (${status}::text is null or status = ${status}) and (${term}::text is null or nome ilike ${term} or documento ilike ${term} or email ilike ${term})`);const rows=await tx.execute(sql`select id,nome,documento,email,telefone,endereco,status from clientes where status <> 'INATIVO' and (${status}::text is null or status = ${status}) and (${term}::text is null or nome ilike ${term} or documento ilike ${term} or email ilike ${term}) order by ${sql.raw(sort.column)} ${sql.raw(sort.direction)} limit ${page.limit} offset ${page.offset}`);return pageResult(rows,page.page,page.limit,Number(count.total));});
    return {success:true,data:result,error:null};
  });

  app.post('/clientes', async req => {
    const body = z.object({
      nome: z.string().min(1).max(200),
      documento: z.string().max(20).optional().nullable(),
      email: z.string().email().max(200).optional().nullable(),
      telefone: z.string().max(20).optional().nullable(),
      endereco: z.record(z.string(), z.unknown()).optional().nullable(),
      status: z.string().max(50).default('ATIVO')
    }).parse(req.body);

    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        INSERT INTO clientes (tenant_id, nome, documento, email, telefone, endereco, status)
        VALUES (${req.user.current_tenant_id}::uuid, ${body.nome}, ${body.documento ?? null}, ${body.email ?? null}, ${body.telefone ?? null}, ${body.endereco ? sql`${JSON.stringify(body.endereco)}::jsonb` : null}, ${body.status})
        RETURNING id, nome, documento, email, telefone, endereco, status
      `)
    );
    return { success: true, data: rows[0], error: null };
  });

  app.put('/clientes/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({
      nome: z.string().min(1).max(200).optional(),
      documento: z.string().max(20).optional().nullable(),
      email: z.string().email().max(200).optional().nullable(),
      telefone: z.string().max(20).optional().nullable(),
      endereco: z.record(z.string(), z.unknown()).optional().nullable(),
      status: z.string().max(50).optional()
    }).parse(req.body);

    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        UPDATE clientes
        SET nome = COALESCE(${body.nome ?? null}, nome),
            documento = COALESCE(${body.documento ?? null}, documento),
            email = COALESCE(${body.email ?? null}, email),
            telefone = COALESCE(${body.telefone ?? null}, telefone),
            endereco = COALESCE(${body.endereco ? sql`${JSON.stringify(body.endereco)}::jsonb` : null}, endereco),
            status = COALESCE(${body.status ?? null}, status)
      WHERE id = ${id} AND status <> 'INATIVO'
        RETURNING id, nome, documento, email, telefone, endereco, status
      `)
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Cliente não encontrado.');
    return { success: true, data: rows[0], error: null };
  });

  app.delete('/clientes/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`UPDATE clientes SET status = 'INATIVO' WHERE id = ${id} AND status <> 'INATIVO' RETURNING id`)
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Cliente não encontrado.');
    return { success: true, data: null, error: null };
  });
}

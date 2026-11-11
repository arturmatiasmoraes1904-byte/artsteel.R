import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';
import {pageQuery,pageResult,safeSort} from '../lib/pagination.js';

const approvalSchema=z.object({
  locacao:z.object({data_inicio:z.iso.date(),data_fim_prevista:z.iso.date()}).optional(),
}).strict().superRefine((value,context)=>{
  if(value.locacao&&value.locacao.data_fim_prevista<=value.locacao.data_inicio){
    context.addIssue({code:'custom',path:['locacao','data_fim_prevista'],message:'A data final da locação deve ser posterior à data inicial.'});
  }
});

async function hasTable(tx: { execute: Database['execute'] }, table: string): Promise<boolean> {
  const [row] = await tx.execute(sql`SELECT to_regclass(${`public.${table}`}) AS rel`);
  return Boolean(row?.rel);
}

async function hasColumn(tx: { execute: Database['execute'] }, table: string, column: string): Promise<boolean> {
  const [row] = await tx.execute(sql`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `);
  return Boolean(row?.ok);
}

async function ensureProductionStart(tx:any,tenantId:string){
  let [workflow]=await tx.execute(sql`select id from workflows where tenant_id=${tenantId}::uuid and deleted_at is null order by created_at asc limit 1`);
  if(!workflow) [workflow]=await tx.execute(sql`insert into workflows(tenant_id,nome,descricao) values(${tenantId}::uuid,'Produção','Fluxo padrão criado na aprovação de orçamento.') returning id`);
  let [stage]=await tx.execute(sql`select id from workflow_stages where tenant_id=${tenantId}::uuid and workflow_id=${workflow.id}::uuid and deleted_at is null order by ordem asc limit 1`);
  if(!stage) [stage]=await tx.execute(sql`insert into workflow_stages(tenant_id,workflow_id,nome,cor,ordem) values(${tenantId}::uuid,${workflow.id}::uuid,'A fazer','#6b7280',0) returning id`);
  return {workflowId:String(workflow.id),stageId:String(stage.id)};
}

export async function orcamentosRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN', 'OPERADOR']);
  });

  // Dashboard de Orçamentos
  app.get('/orcamentos/dashboard', async req => {
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        SELECT 
          COUNT(*) as total_orcamentos,
          COUNT(CASE WHEN status = 'APROVADO' THEN 1 END) as aprovados,
          COUNT(CASE WHEN status = 'ENVIADO' THEN 1 END) as aguardando_resposta,
          SUM(CASE WHEN status = 'APROVADO' THEN valor_total ELSE 0 END) as receita_aprovada,
          COUNT(CASE WHEN validade < CURRENT_DATE AND status IN ('RASCUNHO', 'ENVIADO') THEN 1 END) as vencidos
        FROM orcamentos
        WHERE tenant_id = ${req.user.current_tenant_id}::uuid AND deleted_at IS NULL
      `)
    );
    const data = rows[0] || { total_orcamentos: 0, aprovados: 0, aguardando_resposta: 0, receita_aprovada: 0, vencidos: 0 };
    return { success: true, data, error: null };
  });

  // Listar Orçamentos
  app.get('/orcamentos', async req => {
    const page=pageQuery(req.query);
    const {status}=z.object({status:z.enum(['RASCUNHO','ENVIADO','VISUALIZADO','APROVADO','REPROVADO','VENCIDO']).optional()}).parse(req.query);
    const sort=safeSort(page.sort,{created_at:'o.created_at',valor_total:'o.valor_total',validade:'o.validade',status:'o.status'},'created_at');
    const result=await withTenant(db,req.user.current_tenant_id,async tx=>{
      const term=page.search?`%${page.search}%`:null;
      const hasTipo = await hasColumn(tx, 'orcamentos', 'tipo');
      const hasPrazoEntrega = await hasColumn(tx, 'orcamentos', 'prazo_entrega');
      const hasAprovadoEm = await hasColumn(tx, 'orcamentos', 'aprovado_em');
      const hasHistorico = !hasPrazoEntrega && (await hasTable(tx, 'orcamento_historico'));
      const statusFilter = status ? sql`and o.status = ${status}` : sql``;
      const [count]=await tx.execute(sql`select count(*)::int total from orcamentos o join clientes cl on cl.id=o.cliente_id where o.tenant_id=${req.user.current_tenant_id}::uuid and o.deleted_at is null ${statusFilter} and (${term}::text is null or cl.nome ilike ${term} or o.numero::text ilike ${term})`);
      const rows=await tx.execute(sql`
        select
          o.id,
          o.numero,
          ${hasTipo ? sql`o.tipo` : sql`'SERVICO'::text as tipo`},
          o.status,
          o.valor_total,
          o.validade,
          o.condicoes_pagamento,
          ${hasPrazoEntrega ? sql`o.prazo_entrega` : hasHistorico ? sql`(select h.metadata->>'prazo_entrega' from orcamento_historico h where h.tenant_id=o.tenant_id and h.orcamento_id=o.id and h.evento='CRIADO' order by h.created_at desc limit 1) as prazo_entrega` : sql`null::text as prazo_entrega`},
          ${hasAprovadoEm ? sql`o.aprovado_em` : sql`null::timestamptz as aprovado_em`},
          o.created_at,
          cl.nome cliente_nome
        from orcamentos o
        join clientes cl on cl.id=o.cliente_id
        where o.tenant_id=${req.user.current_tenant_id}::uuid
          and o.deleted_at is null
          ${statusFilter}
          and (${term}::text is null or cl.nome ilike ${term} or o.numero::text ilike ${term})
        order by ${sql.raw(sort.column)} ${sql.raw(sort.direction)}
        limit ${page.limit} offset ${page.offset}
      `);
      return pageResult(rows,page.page,page.limit,Number(count.total));
    });
    return {success:true,data:result,error:null};
  });

  app.get('/orcamentos/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      const [quote] = await tx.execute(sql`
        SELECT o.*, cl.nome as cliente_nome, cl.documento as cliente_documento, cl.email as cliente_email, cl.telefone as cliente_telefone, cl.endereco as cliente_endereco,
               case 
                 when t.segmento = 'LOCADORA' or t.nome_fantasia ilike '%Atlas%' or t.nome_fantasia ilike '%loca%' then 'Art Steel Locações'
                 when t.segmento = 'SERRALHERIA' or t.nome_fantasia ilike '%Ferro%' or t.nome_fantasia ilike '%Arts%' then 'Art Steel'
                 else t.nome_fantasia 
               end as empresa_nome,
               case 
                 when t.segmento = 'LOCADORA' or t.razao_social ilike '%Atlas%' or t.razao_social ilike '%loca%' then 'Art Steel Locações'
                 when t.segmento = 'SERRALHERIA' or t.razao_social ilike '%Ferro%' or t.razao_social ilike '%Arts%' then 'Art Steel'
                 else t.razao_social 
               end as empresa_razao,
               t.cnpj as empresa_cnpj
        FROM orcamentos o
        JOIN clientes cl ON cl.id = o.cliente_id
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = ${req.user.current_tenant_id}::uuid AND o.id = ${id}::uuid AND o.deleted_at IS NULL
      `);
      if (!quote) throw new HttpError(404, 'NOT_FOUND', 'Orçamento não encontrado.');
      let prazoEntrega = quote.prazo_entrega ?? null;
      let historicoCriadoMeta: Record<string, any> | null = null;
      const hasPrazoCol = await hasColumn(tx, 'orcamentos', 'prazo_entrega');
      const hasUnidade = await hasColumn(tx, 'orcamento_itens', 'unidade');
      const hasMedidas = await hasColumn(tx, 'orcamento_itens', 'medidas');
      if ((!hasPrazoCol || !hasUnidade || !hasMedidas) && (await hasTable(tx, 'orcamento_historico'))) {
        const [hist] = await tx.execute(sql`
          SELECT metadata
          FROM orcamento_historico
          WHERE tenant_id = ${req.user.current_tenant_id}::uuid
            AND orcamento_id = ${id}::uuid
            AND evento = 'CRIADO'
          ORDER BY created_at DESC
          LIMIT 1
        `);
        if (hist?.metadata && typeof hist.metadata === 'object') {
          historicoCriadoMeta = hist.metadata as Record<string, any>;
        }
        if (prazoEntrega === null && historicoCriadoMeta?.prazo_entrega) {
          prazoEntrega = String(historicoCriadoMeta.prazo_entrega);
        }
      }
      const rawItens = await tx.execute(sql`
        SELECT id, produto_nome,
          ${hasUnidade ? sql`unidade` : sql`'UN'::text as unidade`},
          ${hasMedidas ? sql`medidas` : sql`null::jsonb as medidas`},
          quantidade, valor_unitario, desconto, total
        FROM orcamento_itens
        WHERE orcamento_id = ${id}::uuid
        ORDER BY id ASC
      `);
      const fallbackItensMeta = Array.isArray(historicoCriadoMeta?.itens_meta) ? historicoCriadoMeta.itens_meta : [];
      const itens = rawItens.map((row: Record<string, any>) => {
        const matchMeta = fallbackItensMeta.find((m: any) => m?.produto_nome === row.produto_nome && Number(m?.total) === Number(row.total));
        const unidade = hasUnidade ? row.unidade : (matchMeta?.unidade ?? 'UN');
        const medidas = (hasMedidas && Array.isArray(row.medidas) && row.medidas.length > 0)
          ? row.medidas
          : (Array.isArray(matchMeta?.medidas) && matchMeta.medidas.length > 0)
          ? matchMeta.medidas
          : [{ unidade: String(unidade || 'UN'), quantidade: Number(row.quantidade), valor_unitario: Number(row.valor_unitario) }];
        return { ...row, unidade, medidas };
      });
      let contratoDados: Record<string, any> | null = null;
      if (await hasTable(tx, 'orcamento_historico')) {
        const [contratoHist] = await tx.execute(sql`
          SELECT metadata
          FROM orcamento_historico
          WHERE tenant_id = ${req.user.current_tenant_id}::uuid
            AND orcamento_id = ${id}::uuid
            AND evento = 'CONTRATO_ATUALIZADO'
          ORDER BY created_at DESC
          LIMIT 1
        `);
        if (contratoHist?.metadata && typeof contratoHist.metadata === 'object') {
          contratoDados = (contratoHist.metadata as Record<string, any>).contrato_dados ?? null;
        }
      }
      return { ...quote, prazo_entrega: prazoEntrega, contrato_dados: contratoDados, itens };
    });
    return { success: true, data: result, error: null };
  });

  app.put('/orcamentos/:id/contrato', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.record(z.string(), z.unknown()).parse(req.body ?? {});
    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      const [quote] = await tx.execute(sql`
        SELECT id FROM orcamentos
        WHERE tenant_id = ${req.user.current_tenant_id}::uuid
          AND id = ${id}::uuid
          AND deleted_at IS NULL
      `);
      if (!quote) throw new HttpError(404, 'NOT_FOUND', 'Contrato/Orçamento não encontrado.');
      if (await hasTable(tx, 'orcamento_historico')) {
        await tx.execute(sql`
          INSERT INTO orcamento_historico (tenant_id, orcamento_id, evento, actor_user_id, metadata)
          VALUES (
            ${req.user.current_tenant_id}::uuid,
            ${id}::uuid,
            'CONTRATO_ATUALIZADO',
            ${req.user.sub}::uuid,
            ${JSON.stringify({ contrato_dados: body })}::jsonb
          )
        `);
      }
      return { id, contrato_dados: body };
    });
    return { success: true, data: result, error: null };
  });

  // Criar Orçamento (Rascunho)
  app.post('/orcamentos', async req => {
    const measureSchema = z.object({
      unidade: z.enum(['UN', 'KG', 'M']),
      quantidade: z.number().min(0.01),
      valor_unitario: z.number().min(0),
    });
    const body = z.object({
      cliente_id: z.string().uuid(),
      tipo: z.enum(['SERVICO','LOCACAO']).default('SERVICO'),
      validade: z.string().optional().nullable(),
      condicoes_pagamento: z.string().optional().nullable(),
      prazo_entrega: z.string().trim().max(200).optional().nullable(),
      observacoes: z.string().optional().nullable(),
      itens: z.array(z.object({
        produto_nome: z.string().min(1),
        unidade: z.string().trim().min(1).max(20).default('UN'),
        quantidade: z.number().min(0.01).default(1),
        valor_unitario: z.number().min(0).default(0),
        desconto: z.number().min(0).max(100).default(0),
        medidas: z.array(measureSchema).min(1).max(3).optional()
      })).min(1)
    }).parse(req.body);

    const roundCurrency = (value: number) => Math.round(value * 100) / 100;
    const normalizedItens = body.itens.map(item => {
      const medidas = item.medidas && item.medidas.length > 0
        ? item.medidas
        : [{
            unidade: (['UN', 'KG', 'M'].includes(item.unidade) ? item.unidade : 'UN') as 'UN' | 'KG' | 'M',
            quantidade: item.quantidade,
            valor_unitario: item.valor_unitario,
          }];
      const subtotal = roundCurrency(medidas.reduce((sum, m) => sum + m.quantidade * m.valor_unitario, 0));
      const unidade = medidas.map(m => m.unidade).join('+');
      const quantidade = medidas.length === 1 ? medidas[0].quantidade : 1;
      const valor_unitario = medidas.length === 1 ? medidas[0].valor_unitario : subtotal;
      const total = roundCurrency(subtotal * (1 - item.desconto / 100));
      return {
        produto_nome: item.produto_nome,
        unidade,
        medidas,
        quantidade,
        valor_unitario,
        desconto: item.desconto,
        total,
      };
    });

    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      // Calcula total geral aplicando desconto percentual sobre a soma das medidas de cada item
      const totalGeral = roundCurrency(normalizedItens.reduce((total, item) => total + item.total, 0));
      const hasPrazoEntrega = await hasColumn(tx, 'orcamentos', 'prazo_entrega');
      const hasTipo = await hasColumn(tx, 'orcamentos', 'tipo');
      const hasUnidade = await hasColumn(tx, 'orcamento_itens', 'unidade');
      const hasMedidas = await hasColumn(tx, 'orcamento_itens', 'medidas');

      let orcamento: Record<string, any>;
      if (hasPrazoEntrega && hasTipo) {
        [orcamento] = await tx.execute(sql`
          INSERT INTO orcamentos (
            tenant_id, cliente_id, tipo, status, valor_total, validade, condicoes_pagamento, prazo_entrega, observacoes
          ) VALUES (
            ${req.user.current_tenant_id}::uuid, ${body.cliente_id}, ${body.tipo}, 'RASCUNHO', ${totalGeral},
            ${body.validade ? sql`${body.validade}::date` : null}, ${body.condicoes_pagamento ?? null}, ${body.prazo_entrega ?? null}, ${body.observacoes ?? null}
          ) RETURNING *
        `);
      } else if (hasTipo) {
        [orcamento] = await tx.execute(sql`
          INSERT INTO orcamentos (
            tenant_id, cliente_id, tipo, status, valor_total, validade, condicoes_pagamento, observacoes
          ) VALUES (
            ${req.user.current_tenant_id}::uuid, ${body.cliente_id}, ${body.tipo}, 'RASCUNHO', ${totalGeral},
            ${body.validade ? sql`${body.validade}::date` : null}, ${body.condicoes_pagamento ?? null}, ${body.observacoes ?? null}
          ) RETURNING *
        `);
      } else {
        [orcamento] = await tx.execute(sql`
          INSERT INTO orcamentos (
            tenant_id, cliente_id, status, valor_total, validade, condicoes_pagamento, observacoes
          ) VALUES (
            ${req.user.current_tenant_id}::uuid, ${body.cliente_id}, 'RASCUNHO', ${totalGeral},
            ${body.validade ? sql`${body.validade}::date` : null}, ${body.condicoes_pagamento ?? null}, ${body.observacoes ?? null}
          ) RETURNING *
        `);
      }

      if (((!hasPrazoEntrega && body.prazo_entrega) || !hasUnidade || !hasMedidas) && (await hasTable(tx, 'orcamento_historico'))) {
        await tx.execute(sql`
          INSERT INTO orcamento_historico (tenant_id, orcamento_id, evento, actor_user_id, metadata)
          VALUES (
            ${req.user.current_tenant_id}::uuid,
            ${orcamento.id}::uuid,
            'CRIADO',
            ${req.user.sub}::uuid,
            ${JSON.stringify({
              prazo_entrega: body.prazo_entrega ?? null,
              itens_meta: normalizedItens.map(i => ({ produto_nome: i.produto_nome, unidade: i.unidade, medidas: i.medidas, total: i.total })),
            })}::jsonb
          )
        `);
      }

      if (hasUnidade && hasMedidas) {
        await tx.execute(sql`
          INSERT INTO orcamento_itens (
            tenant_id, orcamento_id, produto_nome, unidade, medidas, quantidade, valor_unitario, desconto, total
          )
          SELECT ${req.user.current_tenant_id}::uuid, ${orcamento.id}, item.produto_nome,
            coalesce(item.unidade, 'UN'), item.medidas, item.quantidade, item.valor_unitario, item.desconto, item.total
          FROM jsonb_to_recordset(${JSON.stringify(normalizedItens)}::jsonb) AS item(
            produto_nome text, unidade text, medidas jsonb, quantidade numeric, valor_unitario numeric, desconto numeric, total numeric
          )
        `);
      } else if (hasUnidade) {
        await tx.execute(sql`
          INSERT INTO orcamento_itens (
            tenant_id, orcamento_id, produto_nome, unidade, quantidade, valor_unitario, desconto, total
          )
          SELECT ${req.user.current_tenant_id}::uuid, ${orcamento.id}, item.produto_nome,
            coalesce(item.unidade, 'UN'), item.quantidade, item.valor_unitario, item.desconto, item.total
          FROM jsonb_to_recordset(${JSON.stringify(normalizedItens)}::jsonb) AS item(
            produto_nome text, unidade text, quantidade numeric, valor_unitario numeric, desconto numeric, total numeric
          )
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO orcamento_itens (
            tenant_id, orcamento_id, produto_nome, quantidade, valor_unitario, desconto, total
          )
          SELECT ${req.user.current_tenant_id}::uuid, ${orcamento.id}, item.produto_nome,
            item.quantidade, item.valor_unitario, item.desconto, item.total
          FROM jsonb_to_recordset(${JSON.stringify(normalizedItens)}::jsonb) AS item(
            produto_nome text, unidade text, quantidade numeric, valor_unitario numeric, desconto numeric, total numeric
          )
        `);
      }
      return { ...orcamento, tipo: orcamento.tipo ?? body.tipo, prazo_entrega: orcamento.prazo_entrega ?? body.prazo_entrega ?? null };
    });

    return { success: true, data: result, error: null };
  });

  // Enviar Orçamento
  app.put('/orcamentos/:id/enviar', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const [orcamento] = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        UPDATE orcamentos 
        SET status = 'ENVIADO' 
        WHERE tenant_id = ${req.user.current_tenant_id}::uuid AND id = ${id}::uuid AND deleted_at IS NULL AND status = 'RASCUNHO'
        RETURNING *
      `)
    );
    if (!orcamento) throw new HttpError(400, 'BAD_REQUEST', 'Orçamento não encontrado ou já enviado.');
    return { success: true, data: orcamento, error: null };
  });

  // Garante um link público válido para compartilhar com o cliente.
  app.post('/orcamentos/:id/link-publico', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      const [quote] = await tx.execute(sql`select id,token_publico from orcamentos where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid and deleted_at is null`);
      if (!quote) throw new HttpError(404, 'NOT_FOUND', 'Orçamento não encontrado.');
      const token = quote.token_publico ?? (await tx.execute(sql`update orcamentos set token_publico=gen_random_uuid() where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid returning token_publico`))[0]?.token_publico;
      if (!token) throw new HttpError(500, 'TOKEN_ERROR', 'Não foi possível gerar o link público.');
      if (await hasTable(tx, 'orcamento_publico_tokens')) {
        await tx.execute(sql`insert into orcamento_publico_tokens(token,tenant_id,orcamento_id) values(${token}::uuid,${req.user.current_tenant_id}::uuid,${id}::uuid) on conflict (orcamento_id) do update set expira_em=now()+interval '7 days'`);
        const [saved] = await tx.execute(sql`select token,expira_em from orcamento_publico_tokens where orcamento_id=${id}::uuid`);
        return saved;
      }
      return { token, expira_em: new Date(Date.now() + 7 * 86_400_000).toISOString() };
    });
    return { success: true, data: result, error: null };
  });

  app.put('/orcamentos/:id/aprovar',async req=>{
    const id=z.string().uuid().parse((req.params as { id: string }).id);
    const body=approvalSchema.parse(req.body??{});
    const result=await withTenant(db,req.user.current_tenant_id,async tx=>{
      const [quote]=await tx.execute(sql`select * from orcamentos where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid and deleted_at is null for update`);
      if(!quote) throw new HttpError(404,'NOT_FOUND','Orçamento não encontrado.');
      const hasFinOrcamentoId = await hasColumn(tx, 'transacoes_financeiras', 'orcamento_id');
      const hasCardOrcamentoId = await hasColumn(tx, 'producao_cards', 'orcamento_id');
      if(quote.status==='APROVADO') {
        const [conta]=hasFinOrcamentoId
          ? await tx.execute(sql`select id from transacoes_financeiras where orcamento_id=${id}::uuid and deleted_at is null`)
          : await tx.execute(sql`select id from transacoes_financeiras where tenant_id=${req.user.current_tenant_id}::uuid and anexos->>'orcamento_id'=${id} and deleted_at is null limit 1`);
        const [card]=hasCardOrcamentoId
          ? await tx.execute(sql`select id from producao_cards where orcamento_id=${id}::uuid and deleted_at is null`)
          : await tx.execute(sql`select id from producao_cards where tenant_id=${req.user.current_tenant_id}::uuid and dados_customizados->>'orcamento_id'=${id} and deleted_at is null limit 1`);
        return {orcamento:quote,conta_id:conta?.id??null,card_id:card?.id??null,contrato_id:null,alreadyApproved:true};
      }
      if(!['RASCUNHO','ENVIADO','VISUALIZADO'].includes(String(quote.status))) throw new HttpError(409,'INVALID_STATUS','Este orçamento não pode mais ser aprovado.');
      if(quote.validade&&new Date(String(quote.validade)).getTime()<Date.now()-86_400_000) throw new HttpError(409,'QUOTE_EXPIRED','Este orçamento está vencido e não pode ser aprovado.');
      const quoteTipo = String(quote.tipo ?? 'SERVICO');
      if(quoteTipo==='LOCACAO'&&!body.locacao) throw new HttpError(400,'RENTAL_DATES_REQUIRED','Informe o período de locação para aprovar este orçamento.');

      const hasAprovadoEm = await hasColumn(tx, 'orcamentos', 'aprovado_em');
      const hasMotivoReprovacao = await hasColumn(tx, 'orcamentos', 'motivo_reprovacao');
      const [orcamento] = hasAprovadoEm && hasMotivoReprovacao
        ? await tx.execute(sql`update orcamentos set status='APROVADO',aprovado_em=now(),motivo_reprovacao=null where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid returning *`)
        : hasAprovadoEm
          ? await tx.execute(sql`update orcamentos set status='APROVADO',aprovado_em=now() where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid returning *`)
          : await tx.execute(sql`update orcamentos set status='APROVADO' where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid returning *`);

      const dueDate=body.locacao?.data_inicio??(quote.validade?String(quote.validade).slice(0,10):new Date().toISOString().slice(0,10));
      const [conta]=hasFinOrcamentoId
        ? await tx.execute(sql`insert into transacoes_financeiras(tenant_id,tipo,descricao,valor,data_competencia,data_vencimento,status,categoria,cliente_id,orcamento_id) values(${req.user.current_tenant_id}::uuid,'RECEITA',${`Orçamento #${quote.numero??id} aprovado`},${quote.valor_total},current_date,${dueDate}::date,'PENDENTE','Venda',${quote.cliente_id}::uuid,${id}::uuid) returning id`)
        : await tx.execute(sql`insert into transacoes_financeiras(tenant_id,tipo,descricao,valor,data_competencia,data_vencimento,status,categoria,cliente_id,anexos) values(${req.user.current_tenant_id}::uuid,'RECEITA',${`Orçamento #${quote.numero??id} aprovado`},${quote.valor_total},current_date,${dueDate}::date,'PENDENTE','Venda',${quote.cliente_id}::uuid,${JSON.stringify({orcamento_id:id,tipo_origem:'ORCAMENTO'})}::jsonb) returning id`);

      let contratoId:string|null=null,cardId:string|null=null;
      if(quoteTipo==='LOCACAO') {
        const [contract]=await tx.execute(sql`insert into contratos_locacao(tenant_id,cliente_id,data_inicio,data_fim_prevista,valor_total,condicao_pagamento,status) values(${req.user.current_tenant_id}::uuid,${quote.cliente_id}::uuid,${body.locacao!.data_inicio}::date,${body.locacao!.data_fim_prevista}::date,${quote.valor_total},coalesce(${quote.condicoes_pagamento},'A definir'),'ATIVO') returning id`);
        contratoId=String(contract.id);
      } else {
        const start=await ensureProductionStart(tx,req.user.current_tenant_id);
        const deliveryDate = quote.validade ? String(quote.validade).slice(0, 10) : null;
        const [card]=hasCardOrcamentoId
          ? await tx.execute(sql`insert into producao_cards(tenant_id,workflow_id,stage_id,cliente_id,orcamento_id,titulo,descricao,valor,data_entrega) values(${req.user.current_tenant_id}::uuid,${start.workflowId}::uuid,${start.stageId}::uuid,${quote.cliente_id}::uuid,${id}::uuid,${`Orçamento #${quote.numero??id}`},${quote.observacoes ?? null},${quote.valor_total},${deliveryDate ? sql`${deliveryDate}::date` : null}) returning id`)
          : await tx.execute(sql`insert into producao_cards(tenant_id,workflow_id,stage_id,cliente_id,titulo,descricao,valor,data_entrega,dados_customizados) values(${req.user.current_tenant_id}::uuid,${start.workflowId}::uuid,${start.stageId}::uuid,${quote.cliente_id}::uuid,${`Orçamento #${quote.numero??id}`},${quote.observacoes ?? null},${quote.valor_total},${deliveryDate ? sql`${deliveryDate}::date` : null},${JSON.stringify({orcamento_id:id})}::jsonb) returning id`);
        cardId=String(card.id);
      }
      if (await hasTable(tx, 'orcamento_historico')) {
        await tx.execute(sql`insert into orcamento_historico(tenant_id,orcamento_id,evento,actor_user_id,ip,user_agent,metadata) values(${req.user.current_tenant_id}::uuid,${id}::uuid,'APROVADO',${req.user.sub}::uuid,${req.ip},${req.headers['user-agent']??null},${sql`${JSON.stringify({conta_id:conta.id,contrato_id:contratoId,card_id:cardId})}::jsonb`})`);
      }
      return {orcamento,conta_id:conta.id,contrato_id:contratoId,card_id:cardId,alreadyApproved:false};
    });
    return {success:true,data:result,error:null};
  });

  app.put('/orcamentos/:id/reprovar',async req=>{
    const id=z.string().uuid().parse((req.params as { id: string }).id);
    const {motivo}=z.object({motivo:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
    const orcamento=await withTenant(db,req.user.current_tenant_id,async tx=>{
      const hasMotivoReprovacao = await hasColumn(tx, 'orcamentos', 'motivo_reprovacao');
      const [updated] = hasMotivoReprovacao
        ? await tx.execute(sql`update orcamentos set status='REPROVADO',motivo_reprovacao=${motivo} where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid and deleted_at is null and status in ('RASCUNHO','ENVIADO','VISUALIZADO') returning *`)
        : await tx.execute(sql`update orcamentos set status='REPROVADO' where tenant_id=${req.user.current_tenant_id}::uuid and id=${id}::uuid and deleted_at is null and status in ('RASCUNHO','ENVIADO','VISUALIZADO') returning *`);
      if(!updated) throw new HttpError(409,'INVALID_STATUS','Este orçamento não pode mais ser rejeitado.');
      if (await hasTable(tx, 'orcamento_historico')) {
        await tx.execute(sql`insert into orcamento_historico(tenant_id,orcamento_id,evento,motivo,actor_user_id,ip,user_agent) values(${req.user.current_tenant_id}::uuid,${id}::uuid,'REPROVADO',${motivo},${req.user.sub}::uuid,${req.ip},${req.headers['user-agent']??null})`);
      }
      return { ...updated, motivo_reprovacao: updated.motivo_reprovacao ?? motivo };
    });
    return {success:true,data:orcamento,error:null};
  });

  // Exclusão segura: mantém o registro no banco para auditoria, mas o remove das listas.
  app.delete('/orcamentos/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      const [deleted] = await tx.execute(sql`
        UPDATE orcamentos
        SET deleted_at = now()
        WHERE tenant_id = ${req.user.current_tenant_id}::uuid
          AND id = ${id}::uuid
          AND deleted_at IS NULL
        RETURNING id, status
      `);
      if (!deleted) {
        throw new HttpError(404, 'NOT_FOUND', 'Orçamento não encontrado nesta empresa.');
      }

      if (deleted.status === 'APROVADO') {
        const hasFinOrcamentoId = await hasColumn(tx, 'transacoes_financeiras', 'orcamento_id');
        if (hasFinOrcamentoId) {
          await tx.execute(sql`
            UPDATE transacoes_financeiras
            SET deleted_at = now(), status = 'CANCELADO'
            WHERE tenant_id = ${req.user.current_tenant_id}::uuid
              AND orcamento_id = ${id}::uuid
              AND status = 'PENDENTE'
              AND deleted_at IS NULL
          `);
        } else {
          await tx.execute(sql`
            UPDATE transacoes_financeiras
            SET deleted_at = now(), status = 'CANCELADO'
            WHERE tenant_id = ${req.user.current_tenant_id}::uuid
              AND anexos->>'orcamento_id' = ${id}
              AND status = 'PENDENTE'
              AND deleted_at IS NULL
          `);
        }

        if (await hasTable(tx, 'producao_cards')) {
          const hasCardOrcamentoId = await hasColumn(tx, 'producao_cards', 'orcamento_id');
          if (hasCardOrcamentoId) {
            await tx.execute(sql`
              UPDATE producao_cards
              SET deleted_at = now()
              WHERE tenant_id = ${req.user.current_tenant_id}::uuid
                AND orcamento_id = ${id}::uuid
                AND deleted_at IS NULL
            `);
          } else {
            await tx.execute(sql`
              UPDATE producao_cards
              SET deleted_at = now()
              WHERE tenant_id = ${req.user.current_tenant_id}::uuid
                AND dados_customizados->>'orcamento_id' = ${id}
                AND deleted_at IS NULL
            `);
          }
        }
      }

      return deleted;
    });
    return { success: true, data: result, error: null };
  });
}

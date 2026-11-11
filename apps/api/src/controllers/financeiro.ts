import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';
import {pageQuery,pageResult,safeSort} from '../lib/pagination.js';

const paymentSchema = z.object({
  valor: z.number().positive().refine(value => Math.abs(Math.round(value * 100) - value * 100) < 1e-7, 'Informe no máximo duas casas decimais.'),
  data_pagamento: z.iso.date(),
  metodo: z.enum(['DINHEIRO','PIX','CARTAO_CREDITO','CARTAO_DEBITO','BOLETO','TRANSFERENCIA','OUTRO']),
  metodo_outro: z.string().trim().max(100).optional(),
  observacao: z.string().trim().max(1000).optional(),
  acao_parcial: z.enum(['MANTER_ABERTO','QUITAR']).optional()
}).superRefine((body, context) => {
  if (body.metodo === 'OUTRO' && !body.metodo_outro) context.addIssue({code:'custom',path:['metodo_outro'],message:'Descreva o método de pagamento.'});
});

async function tenantRole(db: Database, userId: string, tenantId: string) {
  const rows = await db.execute(sql`select role from user_tenants where user_id=${userId}::uuid and tenant_id=${tenantId}::uuid and is_active=true`);
  return String(rows[0]?.role ?? '');
}

async function hasPagamentosTable(tx: { execute: Database['execute'] }): Promise<boolean> {
  const [row] = await tx.execute(sql`SELECT to_regclass('public.financeiro_pagamentos') AS rel`);
  return Boolean(row?.rel);
}

type StoredPagamento = {
  id: string;
  valor: number;
  valor_dispensado: number;
  metodo: string;
  metodo_outro: string | null;
  data_pagamento: string;
  observacao: string | null;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
  revertido_em: string | null;
  revertido_por: string | null;
  revertido_por_nome: string | null;
  justificativa_reversao?: string | null;
};

function parseAnexosObj(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (typeof raw === 'object') return { ...(raw as Record<string, any>) };
  return {};
}

export async function financeiroRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN', 'FINANCEIRO']);
  });

  app.get('/financeiro/dashboard', async req => {
    const rows = await withTenant(db, req.user.current_tenant_id, async tx => {
      if (await hasPagamentosTable(tx)) {
        return tx.execute(sql`
          WITH pagamentos AS (
            SELECT tenant_id,transacao_id,
              SUM(valor) FILTER (WHERE revertido_em IS NULL) AS valor_pago,
              SUM(valor+valor_dispensado) FILTER (WHERE revertido_em IS NULL) AS valor_liquidado
            FROM financeiro_pagamentos
            WHERE tenant_id=${req.user.current_tenant_id}::uuid
            GROUP BY tenant_id,transacao_id
          )
          SELECT
            COALESCE(SUM(CASE WHEN t.tipo='RECEITA' AND t.status='PAGO' THEN COALESCE(p.valor_pago,t.valor) ELSE 0 END),0) AS total_recebido,
            COALESCE(SUM(CASE WHEN t.tipo='DESPESA' AND t.status='PAGO' THEN COALESCE(p.valor_pago,t.valor) ELSE 0 END),0) AS total_pago,
            COALESCE(SUM(CASE WHEN t.tipo='RECEITA' AND t.status IN ('PENDENTE','ATRASADO') THEN GREATEST(t.valor-COALESCE(p.valor_liquidado,0),0) ELSE 0 END),0) AS receitas_pendentes,
            COALESCE(SUM(CASE WHEN t.tipo='DESPESA' AND t.status IN ('PENDENTE','ATRASADO') THEN GREATEST(t.valor-COALESCE(p.valor_liquidado,0),0) ELSE 0 END),0) AS despesas_pendentes
          FROM transacoes_financeiras t
          LEFT JOIN pagamentos p ON p.tenant_id=t.tenant_id AND p.transacao_id=t.id
          WHERE t.tenant_id = ${req.user.current_tenant_id}::uuid AND t.deleted_at IS NULL
        `);
      }

      return tx.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN t.tipo='RECEITA' AND t.status='PAGO' THEN COALESCE((t.anexos->>'valor_pago')::numeric, t.valor) ELSE 0 END),0) AS total_recebido,
          COALESCE(SUM(CASE WHEN t.tipo='DESPESA' AND t.status='PAGO' THEN COALESCE((t.anexos->>'valor_pago')::numeric, t.valor) ELSE 0 END),0) AS total_pago,
          COALESCE(SUM(CASE WHEN t.tipo='RECEITA' AND t.status IN ('PENDENTE','ATRASADO') THEN GREATEST(t.valor-COALESCE((t.anexos->>'valor_liquidado')::numeric, 0),0) ELSE 0 END),0) AS receitas_pendentes,
          COALESCE(SUM(CASE WHEN t.tipo='DESPESA' AND t.status IN ('PENDENTE','ATRASADO') THEN GREATEST(t.valor-COALESCE((t.anexos->>'valor_liquidado')::numeric, 0),0) ELSE 0 END),0) AS despesas_pendentes
        FROM transacoes_financeiras t
        WHERE t.tenant_id = ${req.user.current_tenant_id}::uuid AND t.deleted_at IS NULL
      `);
    });
    const data = rows[0] || { total_recebido: 0, total_pago: 0, receitas_pendentes: 0, despesas_pendentes: 0 };
    return { 
      success: true, 
      data: {
        saldo_atual: Number(data.total_recebido) - Number(data.total_pago),
        receitas_pendentes: Number(data.receitas_pendentes),
        despesas_pendentes: Number(data.despesas_pendentes)
      }, 
      error: null 
    };
  });

  app.get('/financeiro/transacoes', async req => {
    const page=pageQuery(req.query);
    const sort=safeSort(page.sort,{data_vencimento:'data_vencimento',valor:'valor',created_at:'created_at',status:'status'},'data_vencimento');
    const isOwner = await tenantRole(db, req.user.sub, req.user.current_tenant_id) === 'ADMIN';
    const result=await withTenant(db,req.user.current_tenant_id,async tx=>{
      const term=page.search?`%${page.search}%`:null;
      const [count]=await tx.execute(sql`
        SELECT count(*)::int total 
        FROM transacoes_financeiras 
        WHERE tenant_id = ${req.user.current_tenant_id}::uuid 
          AND deleted_at is null 
          AND (${term}::text is null or descricao ilike ${term} or categoria ilike ${term} or conta_bancaria ilike ${term})
      `);

      if (await hasPagamentosTable(tx)) {
        const rows=await tx.execute(sql`
          WITH pagina AS (
            SELECT t.tenant_id,t.id,t.tipo,t.descricao,t.valor,t.data_competencia,t.data_vencimento,t.data_pagamento,t.status,t.categoria,t.conta_bancaria,t.cliente_id,t.anexos,t.created_at
            FROM transacoes_financeiras t
            WHERE t.tenant_id = ${req.user.current_tenant_id}::uuid
              AND t.deleted_at is null
              AND (${term}::text is null or t.descricao ilike ${term} or t.categoria ilike ${term} or t.conta_bancaria ilike ${term})
            ORDER BY ${sql.raw(sort.column)} ${sql.raw(sort.direction)}
            LIMIT ${page.limit} OFFSET ${page.offset}
          ), pagamentos AS (
            SELECT p.tenant_id,p.transacao_id,
              COALESCE(SUM(p.valor) FILTER (WHERE p.revertido_em IS NULL),0) AS valor_pago,
              COALESCE(SUM(p.valor+p.valor_dispensado) FILTER (WHERE p.revertido_em IS NULL),0) AS valor_liquidado,
              jsonb_agg(
                jsonb_build_object('id',p.id,'valor',p.valor,'valor_dispensado',p.valor_dispensado,'metodo',p.metodo,'metodo_outro',p.metodo_outro,'data_pagamento',p.data_pagamento,'observacao',p.observacao,'registrado_por',p.registrado_por,'registrado_por_nome',u.name,'registrado_em',p.registrado_em,'revertido_em',p.revertido_em,'revertido_por',p.revertido_por,'revertido_por_nome',ru.name)
                || CASE WHEN ${isOwner} THEN jsonb_build_object('justificativa_reversao',p.justificativa_reversao) ELSE '{}'::jsonb END
                ORDER BY p.registrado_em
              ) AS pagamentos
            FROM financeiro_pagamentos p
            JOIN pagina t ON p.tenant_id=t.tenant_id AND p.transacao_id=t.id
            LEFT JOIN users u ON u.id=p.registrado_por
            LEFT JOIN users ru ON ru.id=p.revertido_por
            GROUP BY p.tenant_id,p.transacao_id
          )
          SELECT t.id,t.tipo,t.descricao,t.valor,t.data_competencia,t.data_vencimento,t.data_pagamento,t.status,t.categoria,t.conta_bancaria,t.cliente_id,t.anexos,t.created_at,
            COALESCE(p.valor_pago,0) AS valor_pago,
            GREATEST(t.valor-COALESCE(p.valor_liquidado,0),0) AS saldo_aberto,
            COALESCE(p.pagamentos,'[]'::jsonb) AS pagamentos
          FROM pagina t
          LEFT JOIN pagamentos p ON p.tenant_id=t.tenant_id AND p.transacao_id=t.id
          ORDER BY ${sql.raw(sort.column)} ${sql.raw(sort.direction)}
        `);
        return pageResult(rows,page.page,page.limit,Number(count.total));
      }

      const rawRows = await tx.execute(sql`
        SELECT t.id,t.tipo,t.descricao,t.valor,t.data_competencia,t.data_vencimento,t.data_pagamento,t.status,t.categoria,t.conta_bancaria,t.cliente_id,t.anexos,t.created_at
        FROM transacoes_financeiras t
        WHERE t.tenant_id = ${req.user.current_tenant_id}::uuid
          AND t.deleted_at is null
          AND (${term}::text is null or t.descricao ilike ${term} or t.categoria ilike ${term} or t.conta_bancaria ilike ${term})
        ORDER BY ${sql.raw(sort.column)} ${sql.raw(sort.direction)}
        LIMIT ${page.limit} OFFSET ${page.offset}
      `);

      const enriched = rawRows.map(row => {
        const anexos = parseAnexosObj(row.anexos);
        const list: StoredPagamento[] = Array.isArray(anexos.pagamentos) ? anexos.pagamentos : [];
        const active = list.filter(p => !p.revertido_em);
        const sumPago = active.reduce((acc, p) => acc + Number(p.valor || 0), 0);
        const sumLiquidado = active.reduce((acc, p) => acc + Number(p.valor || 0) + Number(p.valor_dispensado || 0), 0);
        const valorTotal = Number(row.valor || 0);
        const valor_pago = row.status === 'PAGO' && sumPago === 0 ? valorTotal : sumPago;
        const saldo_aberto = row.status === 'PAGO' ? 0 : Math.max(0, valorTotal - sumLiquidado);
        const pagamentos = list.map(p => {
          const copy = { ...p };
          if (!isOwner) delete copy.justificativa_reversao;
          return copy;
        });
        return {
          ...row,
          valor_pago,
          saldo_aberto,
          pagamentos,
        };
      });

      return pageResult(enriched,page.page,page.limit,Number(count.total));
    });
    return {success:true,data:result,error:null};
  });

  app.post('/financeiro/transacoes', async req => {
    const body = z.object({
      tipo: z.enum(['RECEITA', 'DESPESA', 'TRANSFERENCIA']),
      descricao: z.string().min(1).max(200),
      valor: z.number().min(0),
      data_competencia: z.string(),
      data_vencimento: z.string(),
      status: z.enum(['PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO']).default('PENDENTE'),
      categoria: z.string().min(1).max(100),
      conta_bancaria: z.string().max(100).default('Conta Principal'),
      cliente_id: z.string().uuid().optional().nullable(),
      data_pagamento: z.string().optional().nullable(),
      anexos: z.record(z.string(), z.unknown()).optional().nullable()
    }).parse(req.body);
    if (body.status === 'PAGO') throw new HttpError(400,'PAYMENT_REQUIRED','Use Dar Baixa para registrar os dados do pagamento.');

    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        INSERT INTO transacoes_financeiras (
          tenant_id, tipo, descricao, valor, data_competencia, data_vencimento, status, categoria, conta_bancaria, cliente_id, data_pagamento, anexos
        )
        VALUES (
          ${req.user.current_tenant_id}::uuid, ${body.tipo}, ${body.descricao}, ${body.valor}, ${body.data_competencia}, ${body.data_vencimento}, ${body.status}, ${body.categoria}, ${body.conta_bancaria}, ${body.cliente_id ?? null}, ${body.data_pagamento ?? null}, ${body.anexos ? sql`${JSON.stringify(body.anexos)}::jsonb` : null}
        )
        RETURNING *
      `)
    );
    const created = rows[0];
    return {
      success: true,
      data: {
        ...created,
        valor_pago: 0,
        saldo_aberto: Number(created?.valor ?? body.valor),
        pagamentos: [],
      },
      error: null,
    };
  });

  app.put('/financeiro/transacoes/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({
      tipo: z.enum(['RECEITA', 'DESPESA', 'TRANSFERENCIA']).optional(),
      descricao: z.string().min(1).max(200).optional(),
      valor: z.number().min(0).optional(),
      data_competencia: z.string().optional(),
      data_vencimento: z.string().optional(),
      status: z.enum(['PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO']).optional(),
      categoria: z.string().min(1).max(100).optional(),
      conta_bancaria: z.string().max(100).optional(),
      cliente_id: z.string().uuid().optional().nullable(),
      anexos: z.record(z.string(), z.unknown()).optional().nullable()
    }).parse(req.body);
    if (body.status === 'PAGO') throw new HttpError(400,'PAYMENT_REQUIRED','Use Dar Baixa para registrar os dados do pagamento.');

    const rows = await withTenant(db, req.user.current_tenant_id, async tx => {
      if (body.valor !== undefined || body.status !== undefined) {
        if (await hasPagamentosTable(tx)) {
          const [payment] = await tx.execute(sql`SELECT id FROM financeiro_pagamentos WHERE tenant_id=${req.user.current_tenant_id}::uuid AND transacao_id=${id}::uuid LIMIT 1`);
          if (payment) throw new HttpError(409,'PAYMENT_HISTORY_LOCKED','O valor/status deste lançamento não pode ser editado após registrar pagamentos. Use o fluxo de baixa ou reversão.');
        } else {
          const [existing] = await tx.execute(sql`SELECT anexos FROM transacoes_financeiras WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid AND deleted_at IS NULL`);
          const anexosObj = parseAnexosObj(existing?.anexos);
          if (Array.isArray(anexosObj.pagamentos) && anexosObj.pagamentos.length > 0) {
            throw new HttpError(409,'PAYMENT_HISTORY_LOCKED','O valor/status deste lançamento não pode ser editado após registrar pagamentos. Use o fluxo de baixa ou reversão.');
          }
        }
      }

      return tx.execute(sql`
        UPDATE transacoes_financeiras
        SET 
          tipo = COALESCE(${body.tipo ?? null}, tipo),
          descricao = COALESCE(${body.descricao ?? null}, descricao),
          valor = COALESCE(${body.valor ?? null}, valor),
          data_competencia = COALESCE(${body.data_competencia ?? null}, data_competencia),
          data_vencimento = COALESCE(${body.data_vencimento ?? null}, data_vencimento),
          status = COALESCE(${body.status ?? null}, status),
          categoria = COALESCE(${body.categoria ?? null}, categoria),
          conta_bancaria = COALESCE(${body.conta_bancaria ?? null}, conta_bancaria),
          cliente_id = COALESCE(${body.cliente_id ?? null}, cliente_id),
          anexos = COALESCE(${body.anexos ? sql`${JSON.stringify(body.anexos)}::jsonb` : null}, anexos)
        WHERE id = ${id}::uuid AND tenant_id = ${req.user.current_tenant_id}::uuid AND deleted_at IS NULL
        RETURNING *
      `);
    });
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Transação não encontrada.');
    return { success: true, data: rows[0], error: null };
  });

  app.post('/financeiro/transacoes/:id/baixas', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = paymentSchema.parse(req.body);
    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      const [transaction] = await tx.execute(sql`SELECT * FROM transacoes_financeiras WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid AND deleted_at IS NULL FOR UPDATE`);
      if (!transaction) throw new HttpError(404,'NOT_FOUND','Lançamento não encontrado.');
      if (transaction.status === 'PAGO') throw new HttpError(409,'ALREADY_PAID','Este lançamento já está quitado.');
      if (transaction.status === 'CANCELADO') throw new HttpError(409,'CANCELLED','Não é possível dar baixa em um lançamento cancelado.');

      if (await hasPagamentosTable(tx)) {
        const [totals] = await tx.execute(sql`SELECT COALESCE(SUM(valor+valor_dispensado),0) AS liquidado FROM financeiro_pagamentos WHERE tenant_id=${req.user.current_tenant_id}::uuid AND transacao_id=${id}::uuid AND revertido_em IS NULL`);
        const remaining = Math.max(0, Number(transaction.valor) - Number(totals.liquidado));
        if (body.valor > remaining + 0.001) throw new HttpError(400,'PAYMENT_TOO_LARGE','O valor informado é maior que o saldo em aberto.');
        const partial = body.valor < remaining - 0.001;
        if (partial && !body.acao_parcial) throw new HttpError(400,'PARTIAL_ACTION_REQUIRED','Escolha se o saldo ficará em aberto ou será dispensado.');
        if (!partial && body.acao_parcial === 'QUITAR') throw new HttpError(400,'INVALID_PARTIAL_ACTION','A opção quitar com saldo dispensado só se aplica a pagamento parcial.');
        const writtenOff = partial && body.acao_parcial === 'QUITAR' ? remaining - body.valor : 0;
        const [payment] = await tx.execute(sql`
          INSERT INTO financeiro_pagamentos(tenant_id,transacao_id,valor,valor_dispensado,metodo,metodo_outro,data_pagamento,observacao,registrado_por)
          VALUES(${req.user.current_tenant_id}::uuid,${id}::uuid,${body.valor},${writtenOff},${body.metodo},${body.metodo_outro??null},${body.data_pagamento}::date,${body.observacao??null},${req.user.sub}::uuid)
          RETURNING id,valor,valor_dispensado
        `);
        const nextStatus = partial && body.acao_parcial === 'MANTER_ABERTO'
          ? sql`CASE WHEN data_vencimento < current_date THEN 'ATRASADO' ELSE 'PENDENTE' END`
          : sql`'PAGO'`;
        const [updated] = await tx.execute(sql`UPDATE transacoes_financeiras SET status=${nextStatus},data_pagamento=${body.data_pagamento}::date WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid RETURNING id,status,data_pagamento`);
        return { ...updated, pagamento: payment };
      }

      const [userRow] = await tx.execute(sql`SELECT name FROM users WHERE id=${req.user.sub}::uuid`);
      const anexosObj = parseAnexosObj(transaction.anexos);
      const list: StoredPagamento[] = Array.isArray(anexosObj.pagamentos) ? anexosObj.pagamentos : [];
      const liquidado = list.filter(p => !p.revertido_em).reduce((acc, p) => acc + Number(p.valor || 0) + Number(p.valor_dispensado || 0), 0);
      const remaining = Math.max(0, Number(transaction.valor) - liquidado);
      if (body.valor > remaining + 0.001) throw new HttpError(400,'PAYMENT_TOO_LARGE','O valor informado é maior que o saldo em aberto.');
      const partial = body.valor < remaining - 0.001;
      if (partial && !body.acao_parcial) throw new HttpError(400,'PARTIAL_ACTION_REQUIRED','Escolha se o saldo ficará em aberto ou será dispensado.');
      if (!partial && body.acao_parcial === 'QUITAR') throw new HttpError(400,'INVALID_PARTIAL_ACTION','A opção quitar com saldo dispensado só se aplica a pagamento parcial.');
      const writtenOff = partial && body.acao_parcial === 'QUITAR' ? Number((remaining - body.valor).toFixed(2)) : 0;

      const paymentEntry: StoredPagamento = {
        id: crypto.randomUUID(),
        valor: body.valor,
        valor_dispensado: writtenOff,
        metodo: body.metodo,
        metodo_outro: body.metodo_outro ?? null,
        data_pagamento: body.data_pagamento,
        observacao: body.observacao ?? null,
        registrado_por: req.user.sub,
        registrado_por_nome: String(userRow?.name ?? 'Usuário'),
        registrado_em: new Date().toISOString(),
        revertido_em: null,
        revertido_por: null,
        revertido_por_nome: null,
      };
      const updatedList = [...list, paymentEntry];
      const activeList = updatedList.filter(p => !p.revertido_em);
      const nextAnexos = {
        ...anexosObj,
        pagamentos: updatedList,
        valor_pago: activeList.reduce((acc, p) => acc + Number(p.valor || 0), 0),
        valor_liquidado: activeList.reduce((acc, p) => acc + Number(p.valor || 0) + Number(p.valor_dispensado || 0), 0),
      };
      const nextStatus = partial && body.acao_parcial === 'MANTER_ABERTO'
        ? sql`CASE WHEN data_vencimento < current_date THEN 'ATRASADO' ELSE 'PENDENTE' END`
        : sql`'PAGO'`;
      const [updated] = await tx.execute(sql`
        UPDATE transacoes_financeiras
        SET status=${nextStatus}, data_pagamento=${body.data_pagamento}::date, anexos=${JSON.stringify(nextAnexos)}::jsonb
        WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid
        RETURNING id,status,data_pagamento
      `);
      return { ...updated, pagamento: { id: paymentEntry.id, valor: paymentEntry.valor, valor_dispensado: paymentEntry.valor_dispensado } };
    });
    return {success:true,data:result,error:null};
  });

  // Compatibility for already-open clients; the new UI always supplies payment details.
  app.put('/financeiro/transacoes/:id/pagar', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({data_pagamento:z.iso.date()}).parse(req.body);
    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      const [transaction] = await tx.execute(sql`SELECT * FROM transacoes_financeiras WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid AND deleted_at IS NULL FOR UPDATE`);
      if (!transaction) throw new HttpError(404,'NOT_FOUND','Lançamento não encontrado.');
      if (transaction.status === 'PAGO') throw new HttpError(409,'ALREADY_PAID','Este lançamento já está quitado.');

      if (await hasPagamentosTable(tx)) {
        const [totals] = await tx.execute(sql`SELECT COALESCE(SUM(valor+valor_dispensado),0) AS liquidado FROM financeiro_pagamentos WHERE tenant_id=${req.user.current_tenant_id}::uuid AND transacao_id=${id}::uuid AND revertido_em IS NULL`);
        const remaining = Math.max(0,Number(transaction.valor)-Number(totals.liquidado));
        if(remaining<=0)throw new HttpError(409,'ALREADY_SETTLED','Não há saldo em aberto para dar baixa.');
        const [payment] = await tx.execute(sql`INSERT INTO financeiro_pagamentos(tenant_id,transacao_id,valor,metodo,data_pagamento,observacao,registrado_por) VALUES(${req.user.current_tenant_id}::uuid,${id}::uuid,${remaining},'LEGADO',${body.data_pagamento}::date,'Baixa registrada por cliente de versão anterior.',${req.user.sub}::uuid) RETURNING id`);
        const [updated] = await tx.execute(sql`UPDATE transacoes_financeiras SET status='PAGO',data_pagamento=${body.data_pagamento}::date WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid RETURNING id,status,data_pagamento`);
        return {...updated,pagamento:payment};
      }

      const [updated] = await tx.execute(sql`UPDATE transacoes_financeiras SET status='PAGO',data_pagamento=${body.data_pagamento}::date WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid RETURNING id,status,data_pagamento`);
      return updated;
    });
    return {success:true,data:result,error:null};
  });

  app.post('/financeiro/transacoes/:id/reverter-baixa', async req => {
    const id = z.string().uuid().parse((req.params as {id:string}).id);
    const {justificativa} = z.object({justificativa:z.string().trim().min(10).max(1000)}).parse(req.body);
    const result = await withTenant(db,req.user.current_tenant_id,async tx=>{
      const [transaction]=await tx.execute(sql`SELECT * FROM transacoes_financeiras WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid AND deleted_at IS NULL FOR UPDATE`);
      if(!transaction)throw new HttpError(404,'NOT_FOUND','Lançamento não encontrado.');
      if(transaction.status!=='PAGO')throw new HttpError(409,'NOT_PAID','Este lançamento não está quitado.');

      if (await hasPagamentosTable(tx)) {
        const [legacyPayment]=await tx.execute(sql`SELECT id FROM financeiro_pagamentos WHERE tenant_id=${req.user.current_tenant_id}::uuid AND transacao_id=${id}::uuid AND revertido_em IS NULL LIMIT 1`);
        if(!legacyPayment){
          await tx.execute(sql`INSERT INTO financeiro_pagamentos(tenant_id,transacao_id,valor,metodo,data_pagamento,observacao) VALUES(${req.user.current_tenant_id}::uuid,${id}::uuid,${transaction.valor},'LEGADO',coalesce(${transaction.data_pagamento}::date,current_date),'Histórico preservado automaticamente na reversão.')`);
        }
        await tx.execute(sql`UPDATE financeiro_pagamentos SET revertido_em=now(),revertido_por=${req.user.sub}::uuid,justificativa_reversao=${justificativa} WHERE tenant_id=${req.user.current_tenant_id}::uuid AND transacao_id=${id}::uuid AND revertido_em IS NULL`);
        const [updated]=await tx.execute(sql`UPDATE transacoes_financeiras SET status=CASE WHEN data_vencimento<current_date THEN 'ATRASADO' ELSE 'PENDENTE' END,data_pagamento=NULL WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid RETURNING id,status,data_pagamento`);
        return updated;
      }

      const [userRow] = await tx.execute(sql`SELECT name FROM users WHERE id=${req.user.sub}::uuid`);
      const anexosObj = parseAnexosObj(transaction.anexos);
      let list: StoredPagamento[] = Array.isArray(anexosObj.pagamentos) ? anexosObj.pagamentos : [];
      if (!list.some(p => !p.revertido_em)) {
        list = [
          ...list,
          {
            id: crypto.randomUUID(),
            valor: Number(transaction.valor),
            valor_dispensado: 0,
            metodo: 'LEGADO',
            metodo_outro: null,
            data_pagamento: String(transaction.data_pagamento ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
            observacao: 'Histórico preservado automaticamente na reversão.',
            registrado_por: null,
            registrado_por_nome: null,
            registrado_em: new Date().toISOString(),
            revertido_em: null,
            revertido_por: null,
            revertido_por_nome: null,
          },
        ];
      }
      const nowIso = new Date().toISOString();
      const revertedList = list.map(p => p.revertido_em ? p : {
        ...p,
        revertido_em: nowIso,
        revertido_por: req.user.sub,
        revertido_por_nome: String(userRow?.name ?? 'Usuário'),
        justificativa_reversao: justificativa,
      });
      const nextAnexos = {
        ...anexosObj,
        pagamentos: revertedList,
        valor_pago: 0,
        valor_liquidado: 0,
      };
      const [updated]=await tx.execute(sql`
        UPDATE transacoes_financeiras
        SET status=CASE WHEN data_vencimento<current_date THEN 'ATRASADO' ELSE 'PENDENTE' END,
            data_pagamento=NULL,
            anexos=${JSON.stringify(nextAnexos)}::jsonb
        WHERE id=${id}::uuid AND tenant_id=${req.user.current_tenant_id}::uuid
        RETURNING id,status,data_pagamento
      `);
      return updated;
    });
    return {success:true,data:result,error:null};
  });

  app.delete('/financeiro/transacoes/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`UPDATE transacoes_financeiras SET deleted_at = NOW() WHERE id = ${id}::uuid AND tenant_id = ${req.user.current_tenant_id}::uuid RETURNING id`)
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Transação não encontrada.');
    return { success: true, data: null, error: null };
  });
}

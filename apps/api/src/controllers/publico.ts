import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {withTenant,type Database} from '../db/client.js';
import {HttpError} from '../middlewares/auth.js';
import {isValidDocumento, normalizeDocumento} from '../lib/documento.js';

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

export async function publicoRoutes(app:FastifyInstance,db:Database) {
  const referenceFor=async(token:string)=>{
    if (await hasTable(db, 'orcamento_publico_tokens')) {
      const [reference]=await db.execute(sql`select tenant_id,orcamento_id from orcamento_publico_tokens where token=${token}::uuid and expira_em>now()`);
      if (reference) return reference;
    }
    const [fallback]=await db.execute(sql`select tenant_id,id as orcamento_id from orcamentos where token_publico=${token}::uuid and deleted_at is null`);
    if(!fallback)throw new HttpError(404,'NOT_FOUND','Orçamento não encontrado ou expirado.');
    return fallback;
  };
  app.get('/public/orcamentos/:token',async req=>{const token=z.string().uuid().parse((req.params as { token: string }).token);const reference=await referenceFor(token);const quote=await withTenant(db,String(reference.tenant_id),async tx=>{const hasTipo=await hasColumn(tx,'orcamentos','tipo');const hasUnidade=await hasColumn(tx,'orcamento_itens','unidade');const hasMedidas=await hasColumn(tx,'orcamento_itens','medidas');const [orcamento]=await tx.execute(sql`select o.id,o.numero,o.status,o.valor_total,o.validade,o.condicoes_pagamento,o.observacoes,${hasTipo?sql`o.tipo`:sql`'SERVICO'::text as tipo`},cl.nome cliente_nome,case when t.segmento = 'LOCADORA' or t.nome_fantasia ilike '%Atlas%' or t.nome_fantasia ilike '%loca%' then 'Art Steel Locações' when t.segmento = 'SERRALHERIA' or t.nome_fantasia ilike '%Ferro%' or t.nome_fantasia ilike '%Arts%' then 'Art Steel' else t.nome_fantasia end as nome_fantasia from orcamentos o join clientes cl on cl.id=o.cliente_id join tenants t on t.id=o.tenant_id where o.id=${reference.orcamento_id}::uuid`);if(orcamento?.status==='ENVIADO'){await tx.execute(sql`update orcamentos set status='VISUALIZADO' where id=${reference.orcamento_id}::uuid and status='ENVIADO'`);orcamento.status='VISUALIZADO';}const itens=await tx.execute(sql`select produto_nome,${hasUnidade?sql`unidade`:sql`'UN'::text as unidade`},${hasMedidas?sql`medidas`:sql`null::jsonb as medidas`},quantidade,valor_unitario,desconto,total from orcamento_itens where orcamento_id=${reference.orcamento_id}::uuid order by id`);return {...orcamento,itens};});return {success:true,data:quote,error:null};});
  app.post('/public/orcamentos/:token/aceite',async req=>{
    const token=z.string().uuid().parse((req.params as { token: string }).token),body=z.object({nome:z.string().trim().min(3),documento:z.string().trim().min(11).max(18)}).parse(req.body),reference=await referenceFor(token);
    if (!isValidDocumento(body.documento)) throw new HttpError(400, 'INVALID_DOCUMENT', 'CPF ou CNPJ inválido.');
    body.documento = normalizeDocumento(body.documento);
    const result=await withTenant(db,String(reference.tenant_id),async tx=>{
      const [quote]=await tx.execute(sql`select * from orcamentos where id=${reference.orcamento_id}::uuid for update`);
      if(!quote||!['ENVIADO','VISUALIZADO'].includes(String(quote.status)))throw new HttpError(409,'INVALID_STATUS','Este orçamento não está disponível para aceite.');
      if(quote.validade&&new Date(String(quote.validade)).getTime()<Date.now()-86_400_000)throw new HttpError(409,'QUOTE_EXPIRED','Este orçamento está vencido e não pode ser aprovado.');
      if(quote.tipo==='LOCACAO')throw new HttpError(409,'RENTAL_REQUIRES_PERIOD','A locação precisa ser aprovada pelo vendedor com o período definido.');
      let [workflow]=await tx.execute(sql`select id from workflows where tenant_id=${reference.tenant_id}::uuid and deleted_at is null limit 1`);if(!workflow)[workflow]=await tx.execute(sql`insert into workflows(tenant_id,nome) values(${reference.tenant_id}::uuid,'Produção') returning id`);
      let [stage]=await tx.execute(sql`select id from workflow_stages where tenant_id=${reference.tenant_id}::uuid and workflow_id=${workflow.id}::uuid and deleted_at is null order by ordem limit 1`);if(!stage)[stage]=await tx.execute(sql`insert into workflow_stages(tenant_id,workflow_id,nome,ordem) values(${reference.tenant_id}::uuid,${workflow.id}::uuid,'A fazer',0) returning id`);
      const hasFinOrcamentoId = await hasColumn(tx, 'transacoes_financeiras', 'orcamento_id');
      const hasCardOrcamentoId = await hasColumn(tx, 'producao_cards', 'orcamento_id');
      const [conta]=hasFinOrcamentoId
        ? await tx.execute(sql`insert into transacoes_financeiras(tenant_id,tipo,descricao,valor,data_competencia,data_vencimento,status,categoria,cliente_id,orcamento_id) values(${reference.tenant_id}::uuid,'RECEITA','Orçamento público aprovado',${quote.valor_total},current_date,coalesce(${quote.validade}::date,current_date),'PENDENTE','Venda',${quote.cliente_id}::uuid,${quote.id}::uuid) returning id`)
        : await tx.execute(sql`insert into transacoes_financeiras(tenant_id,tipo,descricao,valor,data_competencia,data_vencimento,status,categoria,cliente_id,anexos) values(${reference.tenant_id}::uuid,'RECEITA','Orçamento público aprovado',${quote.valor_total},current_date,coalesce(${quote.validade}::date,current_date),'PENDENTE','Venda',${quote.cliente_id}::uuid,${JSON.stringify({orcamento_id:quote.id,tipo_origem:'ORCAMENTO'})}::jsonb) returning id`);
      const [card]=hasCardOrcamentoId
        ? await tx.execute(sql`insert into producao_cards(tenant_id,workflow_id,stage_id,cliente_id,orcamento_id,titulo,valor) values(${reference.tenant_id}::uuid,${workflow.id}::uuid,${stage.id}::uuid,${quote.cliente_id}::uuid,${quote.id}::uuid,${`Orçamento #${quote.numero}`},${quote.valor_total}) returning id`)
        : await tx.execute(sql`insert into producao_cards(tenant_id,workflow_id,stage_id,cliente_id,titulo,valor,dados_customizados) values(${reference.tenant_id}::uuid,${workflow.id}::uuid,${stage.id}::uuid,${quote.cliente_id}::uuid,${`Orçamento #${quote.numero}`},${quote.valor_total},${JSON.stringify({orcamento_id:quote.id})}::jsonb) returning id`);
      if (await hasColumn(tx, 'orcamentos', 'aceite_nome')) {
        await tx.execute(sql`update orcamentos set status='APROVADO',aprovado_em=now(),assinatura_ip=${req.ip},assinatura_data=now(),aceite_nome=${body.nome},aceite_documento=${body.documento} where id=${quote.id}::uuid`);
      } else {
        await tx.execute(sql`update orcamentos set status='APROVADO',aprovado_em=now(),assinatura_ip=${req.ip},assinatura_data=now() where id=${quote.id}::uuid`);
      }
      if (await hasTable(tx, 'orcamento_historico')) {
        await tx.execute(sql`insert into orcamento_historico(tenant_id,orcamento_id,evento,ip,user_agent,metadata) values(${reference.tenant_id}::uuid,${quote.id}::uuid,'APROVADO_PUBLICO',${req.ip},${req.headers['user-agent']??null},${sql`${JSON.stringify({nome:body.nome,conta_id:conta.id,card_id:card.id})}::jsonb`})`);
      }
      return {accepted:true,conta_id:conta.id,card_id:card.id};
    });return {success:true,data:result,error:null};
  });
  app.post('/public/orcamentos/:token/reprovar',async req=>{const token=z.string().uuid().parse((req.params as { token: string }).token),{motivo}=z.object({motivo:z.string().trim().min(3).max(1000)}).parse(req.body),reference=await referenceFor(token);const quote=await withTenant(db,String(reference.tenant_id),async tx=>{const [updated]=await tx.execute(sql`update orcamentos set status='REPROVADO',motivo_reprovacao=${motivo} where id=${reference.orcamento_id}::uuid and status in ('ENVIADO','VISUALIZADO') returning *`);if(!updated)throw new HttpError(409,'INVALID_STATUS','Este orçamento não está disponível para reprovação.');if(await hasTable(tx,'orcamento_historico')){await tx.execute(sql`insert into orcamento_historico(tenant_id,orcamento_id,evento,motivo,ip,user_agent) values(${reference.tenant_id}::uuid,${updated.id}::uuid,'REPROVADO_PUBLICO',${motivo},${req.ip},${req.headers['user-agent']??null})`);}return updated;});return {success:true,data:quote,error:null};});
}

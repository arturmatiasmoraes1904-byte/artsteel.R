import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError } from '../middlewares/auth.js';
import { userTenants } from '../repositories/auth.js';

const ok=(data:unknown)=>({success:true,data,error:null});
type DashboardScope='LOCACAO'|'SERRALHERIA'|null;

async function dashboardDetails(tx:any,scope:DashboardScope){
  const [salesMix,revenueRows,cashFlowRows,financeSummary,activities,contacts,alerts,stockSummary,quoteSummary,quoteStatuses]=await Promise.all([
    tx.execute(sql`select coalesce(nullif(categoria,''),'Sem categoria') as name,coalesce(sum(valor),0)::float as value from transacoes_financeiras where deleted_at is null and tipo='RECEITA' group by 1 order by value desc limit 6`),
    tx.execute(sql`select date_trunc('month',data_competencia)::date as month,coalesce(sum(valor),0)::float as value from transacoes_financeiras where deleted_at is null and tipo='RECEITA' and data_competencia >= date_trunc('month',current_date)-interval '5 months' group by 1 order by 1`),
    tx.execute(sql`select date_trunc('month',data_competencia)::date as month,coalesce(sum(valor) filter(where tipo='RECEITA'),0)::float as receitas,coalesce(sum(valor) filter(where tipo='DESPESA'),0)::float as despesas from transacoes_financeiras where deleted_at is null and data_competencia >= date_trunc('month',current_date)-interval '5 months' group by 1 order by 1`),
    tx.execute(sql`select coalesce(sum(valor) filter(where tipo='RECEITA' and data_competencia>=date_trunc('month',current_date)),0)::float as receitas_mes,coalesce(sum(valor) filter(where tipo='RECEITA' and status in ('PENDENTE','ATRASADO')),0)::float as receitas_pendentes,coalesce(sum(valor) filter(where tipo='DESPESA' and data_competencia>=date_trunc('month',current_date)),0)::float as despesas_mes from transacoes_financeiras where deleted_at is null`),
    tx.execute(sql`select * from (
      select id,'financeiro' as type,concat('Movimentação financeira: ',descricao,'.') as message,created_at as occurred_at from transacoes_financeiras where deleted_at is null
      union all select id,'orcamento' as type,concat('Orçamento #',numero,' ',lower(status),'.') as message,created_at as occurred_at from orcamentos where deleted_at is null
      union all select id,'producao' as type,concat('Processo ',titulo,' em andamento.') as message,created_at as occurred_at from producao_cards where deleted_at is null
    ) activity order by occurred_at desc limit 8`),
    tx.execute(sql`select id,nome as name,email,telefone as phone from clientes where status <> 'INATIVO' order by id limit 5`),
    tx.execute(sql`select * from (
      select concat('financeiro-',id) as id,'Há contas vencidas que exigem atenção.' as message,created_at as occurred_at from transacoes_financeiras where deleted_at is null and tipo='RECEITA' and status in ('PENDENTE','ATRASADO') and data_vencimento<current_date
      union all select concat('estoque-',id) as id,concat('Estoque baixo: ',nome,'.') as message,created_at as occurred_at from produtos where deleted_at is null and status='ATIVO' and estoque_atual<=estoque_minimo
      union all select concat('manutencao-',id) as id,concat('Equipamento em manutenção: ',nome,'.') as message,null::timestamptz as occurred_at from equipamentos where status='MANUTENCAO'
    ) alert order by occurred_at desc nulls last limit 6`),
    tx.execute(sql`select count(*)::int as total_produtos,count(*) filter(where status='ATIVO' and estoque_atual<=estoque_minimo)::int as baixo_estoque,coalesce(sum(estoque_atual*custo_medio),0)::float as valor_estoque from produtos where deleted_at is null`),
    tx.execute(sql`select count(*)::int as total, count(*) filter(where status='APROVADO')::int as aprovados, count(*) filter(where status in ('ENVIADO','VISUALIZADO'))::int as pendentes, coalesce(sum(valor_total) filter(where status in ('ENVIADO','VISUALIZADO')),0)::float as pipeline from orcamentos where deleted_at is null`),
    tx.execute(sql`select status as name,count(*)::int as quantidade from orcamentos where deleted_at is null group by status order by status`),
  ]);
  const today=new Date();
  const months=Array.from({length:6},(_,index)=>{
    const date=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-5+index,1));
    return {key:date.toISOString().slice(0,7),name:new Intl.DateTimeFormat('pt-BR',{month:'short',timeZone:'UTC'}).format(date).replace('.','')};
  });
  const valuesByMonth=new Map(revenueRows.map((row:any)=>[String(row.month).slice(0,7),Number(row.value)]));
  const cashFlowByMonth=new Map(cashFlowRows.map((row:any)=>[String(row.month).slice(0,7),{receitas:Number(row.receitas),despesas:Number(row.despesas)}]));
  const stock=stockSummary[0]??{total_produtos:0,baixo_estoque:0,valor_estoque:0};
  const quotes=quoteSummary[0]??{total:0,aprovados:0,pendentes:0,pipeline:0};
  const finance=financeSummary[0]??{receitas_mes:0,receitas_pendentes:0,despesas_mes:0};
  return {
    salesMix:salesMix.map((row:any)=>({name:String(row.name),value:Number(row.value)})),
    revenueHistory:months.map(month=>({name:month.name,value:valuesByMonth.get(month.key)??0})),
    cashFlowHistory:months.map(month=>({name:month.name,...(cashFlowByMonth.get(month.key)??{receitas:0,despesas:0})})),
    finance:{receitasMes:Number(finance.receitas_mes),receitasPendentes:Number(finance.receitas_pendentes),despesasMes:Number(finance.despesas_mes)},
    stock:{total:Number(stock.total_produtos),baixo:Number(stock.baixo_estoque),valor:Number(stock.valor_estoque)},
    quotes:{total:Number(quotes.total),aprovados:Number(quotes.aprovados),pendentes:Number(quotes.pendentes),pipeline:Number(quotes.pipeline)},
    quoteStatuses:quoteStatuses.map((row:any)=>({name:String(row.name),quantidade:Number(row.quantidade)})),
    activities:activities.map((row:any)=>({id:String(row.id),type:row.type,message:String(row.message),occurredAt:row.occurred_at})),
    contacts:contacts.map((row:any)=>({id:String(row.id),name:String(row.name),email:row.email,phone:row.phone})),
    alerts:alerts.map((row:any)=>({id:String(row.id),message:String(row.message),occurredAt:row.occurred_at})),
  };
}

export async function dashboardRoutes(app:FastifyInstance,db:Database){
  app.addHook('preHandler',auth(db));
  app.get('/locacao/dashboard',async req=>ok(await withTenant(db,req.user.current_tenant_id,async tx=>{
    const [fleet]=await tx.execute(sql`select count(*) filter(where status!='INATIVO')::int as total,count(*) filter(where status='LOCADO')::int as alugados,count(*) filter(where status='MANUTENCAO')::int as manutencao from equipamentos`);
    const [finance]=await tx.execute(sql`select coalesce(sum(valor) filter(where tipo='RECEITA' and data_competencia>=date_trunc('month',current_date)),0) as faturamento,coalesce(sum(valor) filter(where tipo='RECEITA' and status in ('PENDENTE','ATRASADO') and data_vencimento<current_date),0) as vencido,coalesce(sum(valor) filter(where tipo='RECEITA'),0) as total from transacoes_financeiras where deleted_at is null`);
    const categories=await tx.execute(sql`select categoria as name,count(*) filter(where status='LOCADO')::int as alugados,count(*) filter(where status='DISPONIVEL')::int as disponiveis from equipamentos group by categoria order by categoria`);
    return {ocupacao:Number(fleet.total)?Number(fleet.alugados)/Number(fleet.total)*100:0,manutencao:fleet.manutencao,faturamento:Number(finance.faturamento),inadimplencia:Number(finance.total)?Number(finance.vencido)/Number(finance.total)*100:0,categories,...await dashboardDetails(tx,'LOCACAO')};
  })));
  app.get('/serralheria/dashboard',async req=>ok(await withTenant(db,req.user.current_tenant_id,async tx=>{
    const kpi={tempo_medio:null,margem:null,desperdicio:null,otd:null};
    const stages=await tx.execute(sql`select coalesce(ws.nome,'Sem etapa') as name,count(*)::int as quantidade from producao_cards pc left join workflow_stages ws on ws.id=pc.stage_id where pc.deleted_at is null group by ws.nome order by ws.nome`);
    const costs=await tx.execute(sql`select left(titulo,24) as name,valor::float as orcado,valor::float as real from producao_cards where deleted_at is null order by created_at desc limit 8`);
    return {...kpi,stages,costs,...await dashboardDetails(tx,'SERRALHERIA')};
  })));
  app.get('/dashboard/consolidado',async req=>{
    const tenants=await userTenants(db,req.user.sub);
    const allowed=tenants.filter(t=>t.role==='ADMIN'||t.role==='FINANCEIRO');
    if(!allowed.length) throw new HttpError(403,'ROLE_DENIED','Consolidado disponível para administradores e financeiro.');
    const companies=await Promise.all(allowed.map(async tenant=>{
      const values=await withTenant(db,String(tenant.id),async tx=>(await tx.execute(sql`select coalesce(sum(valor),0)::float as faturamento,coalesce(sum(valor) filter(where status_pagamento!='PAGO'),0)::float as recebiveis,coalesce(sum(valor) filter(where status_pagamento='PAGO'),0)::float as recebido from faturas`))[0]);
      return {name:String(tenant.nome_fantasia),faturamento:Number(values.faturamento),recebiveis:Number(values.recebiveis),recebido:Number(values.recebido)};
    }));
    return ok({companies,faturamento:companies.reduce((n,c)=>n+c.faturamento,0),recebiveis:companies.reduce((n,c)=>n+c.recebiveis,0),recebido:companies.reduce((n,c)=>n+c.recebido,0),ebitda:null,fluxo_caixa_livre:null,nota:'EBITDA e fluxo de caixa livre dependem do cadastro de despesas operacionais, impostos e investimentos.'});
  });
}


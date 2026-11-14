// Local demonstration only. Uses PostgreSQL WASM in memory and loses data on exit.
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../services/password.js';
import {buildApp} from '../app.js';
import type {Database} from './client.js';
const pg=new PGlite();
await pg.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
await pg.exec(`
  create table if not exists orcamentos(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,cliente_id uuid not null,numero serial,tipo text not null default 'SERVICO',status text not null default 'RASCUNHO',valor_total numeric not null default 0,validade date,condicoes_pagamento text,prazo_entrega text,observacoes text,token_publico uuid default gen_random_uuid(),motivo_reprovacao text,aprovado_em timestamptz,deleted_at timestamptz,created_at timestamptz not null default now());
  create table if not exists orcamento_itens(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,orcamento_id uuid not null,produto_nome text not null,unidade text not null default 'UN',medidas jsonb,quantidade numeric not null,valor_unitario numeric not null,desconto numeric not null,total numeric not null);
  create table if not exists workflows(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,nome text not null,descricao text,deleted_at timestamptz,created_at timestamptz not null default now());
  create table if not exists workflow_stages(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,workflow_id uuid not null,nome text not null,cor text,ordem integer not null,sla_horas integer,exige_motivo_retorno boolean default false,deleted_at timestamptz,created_at timestamptz not null default now());
  create table if not exists producao_cards(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,workflow_id uuid not null,stage_id uuid not null,cliente_id uuid,orcamento_id uuid unique,titulo text not null,descricao text,prioridade text,valor numeric,data_entrega date,dados_customizados jsonb,ordem integer,deleted_at timestamptz,created_at timestamptz not null default now());
  create table if not exists orcamento_historico(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,orcamento_id uuid not null,evento text not null,motivo text,actor_user_id uuid,ip text,user_agent text,metadata jsonb,created_at timestamptz not null default now());
  alter table transacoes_financeiras add column if not exists orcamento_id uuid;
  alter table transacoes_financeiras add column if not exists producao_card_id uuid;
  alter table equipamentos add column if not exists modelo text;
  alter table equipamentos add column if not exists criticidade text not null default 'Média';
  alter table equipamentos add column if not exists data_aquisicao date;
  alter table equipamentos add column if not exists localizacao text;
  alter table equipamentos add column if not exists deleted_at timestamptz;
  alter table contratos_locacao add column if not exists periodicidade text default 'MENSAL';
  alter table contratos_locacao add column if not exists dia_vencimento integer default 5;
  alter table contratos_locacao add column if not exists indice_reajuste text default 'IGP-M';
  alter table contratos_locacao add column if not exists observacoes text;
  alter table contratos_locacao add column if not exists documento_url text;
  alter table contratos_locacao add column if not exists renovacao_automatica boolean not null default true;
  alter table contratos_locacao add column if not exists ciclos_cobrados integer not null default 1;
  alter table contratos_locacao add column if not exists proximo_vencimento date;
  alter table ordens_manutencao add column if not exists tipo_manutencao text;
  alter table ordens_manutencao add column if not exists descricao_problema text;
  alter table ordens_manutencao add column if not exists tecnico_responsavel text;
  alter table ordens_manutencao add column if not exists data_abertura timestamptz not null default now();
  alter table ordens_manutencao add column if not exists data_conclusao timestamptz;
  alter table ordens_manutencao add column if not exists deleted_at timestamptz;
`);
const password=process.env.DEMO_PASSWORD??'Nexo-Demo-2026!';
const user='20000000-0000-4000-8000-000000000001';
await pg.query('insert into users(id,name,email,password_hash) values($1,$2,$3,$4)',[user,'Gestor','demo@nexo.local',await hashPassword(password)]);
const companies=[{id:'10000000-0000-4000-8000-000000000001',name:'Art Steel Locações',segment:'LOCADORA'},{id:'10000000-0000-4000-8000-000000000002',name:'Art Steel',segment:'SERRALHERIA'}];
for(const company of companies){
  await pg.query('insert into tenants(id,razao_social,nome_fantasia,cnpj,segmento) values($1,$2,$3,$4,$5)',[company.id,company.name,company.name,company.id,company.segment]);
  await pg.query("insert into user_tenants(user_id,tenant_id,role) values($1,$2,'ADMIN')",[user,company.id]);
  const {rows:[customer]}=await pg.query<{id:string}>("insert into clientes(tenant_id,nome) values($1,'Construtora Horizonte · demonstração') returning id",[company.id]);
  if(company.segment==='LOCADORA'){
    const equipment=['Betoneira 400 L','Compactador de solo','Martelete 10 kg','Andaime tubular','Gerador 8 kVA','Betoneira 250 L','Placa vibratória','Martelete 5 kg'];
    for(const [i,name] of equipment.entries()){
      const {rows:[asset]}=await pg.query<{id:string}>('insert into equipamentos(tenant_id,nome,numero_patrimonio,categoria,status,valor_diaria,valor_reposicao) values($1,$2,$3,$4,$5,$6,$7) returning id',[company.id,name,'PAT-'+String(i+1).padStart(3,'0'),['Concreto','Compactação','Demolição','Acesso','Energia','Concreto','Compactação','Demolição'][i],i===4?'MANUTENCAO':i<3?'LOCADO':'DISPONIVEL',[90,150,85,35,220,65,110,70][i],6000]);
      if(i<3){
        const {rows:[contract]}=await pg.query<{id:string}>("insert into contratos_locacao(tenant_id,cliente_id,data_inicio,data_fim_prevista,renovacao_automatica,ciclos_cobrados,proximo_vencimento,valor_total,condicao_pagamento) values($1,$2,current_date-5,null,true,1,(current_date-5+interval '1 month')::date,$3,'À vista') returning id",[company.id,customer.id,[90,150,85][i]*15]);
        await pg.query('insert into itens_contrato(tenant_id,contrato_id,equipamento_id,valor_unitario) values($1,$2,$3,$4)',[company.id,contract.id,asset.id,[90,150,85][i]]);
      }
      if(i===4)await pg.query("insert into ordens_manutencao(tenant_id,equipamento_id,tipo,descricao) values($1,$2,'PREVENTIVA','Revisão de filtros e lubrificação')",[company.id,asset.id]);
    }
  }else{
    await pg.query("insert into materias_primas(tenant_id,descricao,tipo,liga_metalica,peso_por_metro,preco_por_kg,estoque_atual) values($1,'Barra chata 50 × 6 mm','BARRA','Aço carbono',2.355,8.5,120),($1,'Tubo 40 × 40 × 2 mm','TUBO','Aço carbono',2.39,9.2,80)",[company.id]);
    for(const [i,name] of ['Portão residencial','Guarda-corpo da escada','Estrutura de cobertura','Mezanino industrial','Porta de acesso'].entries()){
      const {rows:[quote]}=await pg.query<{id:string}>('insert into orcamentos_projetos(tenant_id,descricao_projeto,peso_total_calculado_kg,custo_materia_prima,custo_mao_obra,custo_acabamento,margem_lucro_pct,valor_final) values($1,$2,120,960,900,300,25,2880) returning id',[company.id,name]);
      await pg.query("insert into ordens_servico_serralheria(tenant_id,orcamento_id,status_etapa,data_entrega_prometida,created_at,concluido_em,peso_consumido_kg,peso_desperdicio_kg,custo_real) values($1,$2,$3,current_date+7,now()-interval '8 days',case when $3='CONCLUIDO' then now() else null end,130,10,2200)",[company.id,quote.id,['CORTE','SOLDA','ACABAMENTO','MONTAGEM','CONCLUIDO'][i]]);
    }
    const {rows:[approvedQuote]}=await pg.query<{id:string}>("insert into orcamentos(tenant_id,cliente_id,tipo,status,valor_total,validade,condicoes_pagamento,prazo_entrega,aprovado_em) values($1,$2,'SERVICO','APROVADO',6090,current_date+8,'50% Entrada, 50% na Entrega','15 dias úteis',now()) returning id",[company.id,customer.id]);
    await pg.query("insert into orcamento_itens(tenant_id,orcamento_id,produto_nome,unidade,quantidade,valor_unitario,desconto,total) values($1,$2,'Portão basculante em aço carbono','UN',1,6090,0,6090)",[company.id,approvedQuote.id]);
  }
  for(let i=0;i<6;i++)await pg.query("insert into faturas(tenant_id,origem,valor,data_vencimento,status_pagamento,tipo_documento) values($1,$2,$3,current_date+($4::int),$5,$6)",[company.id,company.segment==='LOCADORA'?'LOCACAO':'SERRALHERIA',(i+1)*1250,(i-1)*7,i===0?'ATRASADO':i%2?'PAGO':'PENDENTE',company.segment==='LOCADORA'?'FATURA_LOCACAO':'NFSE_SERVICO']);
}
await pg.exec('create role demo_app nosuperuser nobypassrls; grant usage on schema public to demo_app; grant select,insert,update,delete on all tables in schema public to demo_app; grant usage,select on all sequences in schema public to demo_app; set role demo_app;');
// Both drivers execute the same parameterized Drizzle SQL; only result shape differs.
function adapt(source:ReturnType<typeof drizzle>):Database {
  return {execute:async(query:Parameters<typeof source.execute>[0])=>(await source.execute(query)).rows,
    transaction:(callback:(tx:Database)=>Promise<unknown>)=>source.transaction(tx=>callback(adapt(tx as unknown as ReturnType<typeof drizzle>)))
  } as unknown as Database;
}
const app=await buildApp(adapt(drizzle(pg)),randomBytes(32).toString('hex'));
app.addHook('onClose',async()=>pg.close());
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close();});
await app.listen({host:'127.0.0.1',port:3333});
console.log('DEMONSTRAÇÃO EM MEMÓRIA. Acesse http://localhost:3000 — demo@nexo.local. Consulte a senha no README ou DEMO_PASSWORD.');

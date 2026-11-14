import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {calculateQuote,quoteSchema} from '../src/services/quote.js';
import {hashPassword,verifyPassword} from '../src/services/password.js';
import {buildApp} from '../src/app.js';
import {normalizeEquipamentoInput} from '../src/controllers/equipamentos.js';
import {lookupCnpj} from '../src/services/cnpj.js';
import type {Database} from '../src/db/client.js';
import {apiRequestHeaders} from '../../web/src/lib/apiRequestHeaders.js';
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',c='10000000-0000-4000-8000-000000000003';
const user='20000000-0000-4000-8000-000000000001';
const financeUser='20000000-0000-4000-8000-000000000002',operatorUser='20000000-0000-4000-8000-000000000003';
const equipmentA='30000000-0000-4000-8000-000000000001',equipmentB='30000000-0000-4000-8000-000000000002';
const customerA='40000000-0000-4000-8000-000000000001',customerB='40000000-0000-4000-8000-000000000002';
const pg=new PGlite();let app:Awaited<ReturnType<typeof buildApp>>;
before(async()=>{
  await pg.exec(await readFile(new URL('../src/db/schema.sql',import.meta.url),'utf8'));
  const passwordHash=await hashPassword('Strong-Test-Password');
  await pg.query('insert into users(id,name,email,password_hash) values($1,$2,$3,$4),($5,$6,$7,$4),($8,$9,$10,$4)',[user,'Teste','teste@nexo.local',passwordHash,financeUser,'Financeiro','financeiro@nexo.local',operatorUser,'Operador','operador@nexo.local']);
  for(const [id,name] of [[a,'Empresa A'],[b,'Empresa B'],[c,'Empresa sem acesso']])await pg.query('insert into tenants(id,razao_social,nome_fantasia,cnpj,segmento) values($1,$2,$2,$4,$3)',[id,name,'MISTO',id]);
  for(const id of [a,b])await pg.query("insert into user_tenants(user_id,tenant_id,role) values($1,$2,'ADMIN')",[user,id]);
  await pg.query("insert into user_tenants(user_id,tenant_id,role) values($1,$2,'FINANCEIRO'),($3,$2,'OPERADOR')",[financeUser,a,operatorUser]);
  for(const [tenant,equipment,customer] of [[a,equipmentA,customerA],[b,equipmentB,customerB]]){
    await pg.query("insert into equipamentos(id,tenant_id,nome,numero_patrimonio,categoria,valor_diaria) values($1,$2,'Betoneira','PAT-001','Concreto',100)",[equipment,tenant]);
    await pg.query("insert into clientes(id,tenant_id,nome) values($1,$2,'Cliente')",[customer,tenant]);
  }
  await pg.query("update clientes set endereco=$1::jsonb where id=$2",[JSON.stringify({rua:'Rua das Flores',numero:'123',bairro:'Centro',cidade:'São Paulo',uf:'SP'}),customerA]);
  await pg.exec(`
    create table orcamentos(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,cliente_id uuid not null,numero serial,tipo text not null default 'SERVICO',status text not null default 'RASCUNHO',valor_total numeric not null default 0,validade date,condicoes_pagamento text,prazo_entrega text,observacoes text,motivo_reprovacao text,aprovado_em timestamptz,deleted_at timestamptz,created_at timestamptz not null default now());
    create table orcamento_itens(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,orcamento_id uuid not null,produto_nome text not null,unidade text not null default 'UN',medidas jsonb,quantidade numeric not null,valor_unitario numeric not null,desconto numeric not null,total numeric not null);
    create table workflows(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,nome text not null,descricao text,deleted_at timestamptz,created_at timestamptz not null default now());
    create table workflow_stages(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,workflow_id uuid not null,nome text not null,cor text,ordem integer not null,deleted_at timestamptz,created_at timestamptz not null default now());
    create table producao_cards(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,workflow_id uuid not null,stage_id uuid not null,cliente_id uuid,orcamento_id uuid unique,titulo text not null,descricao text,prioridade text,valor numeric,data_entrega date,dados_customizados jsonb,ordem integer,deleted_at timestamptz,created_at timestamptz not null default now());
    create table orcamento_historico(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,orcamento_id uuid not null,evento text not null,motivo text,actor_user_id uuid,ip text,user_agent text,metadata jsonb,created_at timestamptz not null default now());
    alter table transacoes_financeiras add column if not exists orcamento_id uuid;
    alter table transacoes_financeiras add column if not exists producao_card_id uuid;
    alter table equipamentos add column if not exists deleted_at timestamptz;
    alter table contratos_locacao add column if not exists periodicidade text default 'MENSAL';
    alter table contratos_locacao add column if not exists dia_vencimento integer default 5;
    alter table contratos_locacao add column if not exists indice_reajuste text default 'IGP-M';
    alter table contratos_locacao add column if not exists observacoes text;
    alter table contratos_locacao add column if not exists documento_url text;
    alter table workflow_stages add column sla_horas integer;
    alter table workflow_stages add column exige_motivo_retorno boolean default false;
    alter table ordens_manutencao add column tipo_manutencao text;
    alter table ordens_manutencao add column descricao_problema text;
    alter table ordens_manutencao add column tecnico_responsavel text;
    alter table ordens_manutencao add column data_abertura timestamptz not null default now();
    alter table ordens_manutencao add column data_conclusao timestamptz;
    alter table ordens_manutencao add column deleted_at timestamptz;
  `);
  await pg.exec('create role test_app nosuperuser nobypassrls; grant usage on schema public to test_app; grant select,insert,update,delete on all tables in schema public to test_app; grant usage,select on all sequences in schema public to test_app; set role test_app;');
  // Normalize PGlite's { rows } result to the postgres-js array interface.
  function adapt(source: any): any {return {execute:async(query:unknown)=>(await source.execute(query)).rows,transaction:(callback:(tx:unknown)=>Promise<unknown>)=>source.transaction((tx:unknown)=>callback(adapt(tx)))};}
  app=await buildApp(adapt(drizzle(pg)) as Database,'test-secret-at-least-thirty-two-characters',false);
  app.get('/__test/missing-database-object',async()=>{throw Object.assign(new Error('sensitive database detail'),{code:'42703'});});
});
after(async()=>{await app?.close();await pg.close();});
test('password hashing rejects a wrong password',async()=>{const hash=await hashPassword('correct');assert.equal(await verifyPassword('correct',hash),true);assert.equal(await verifyPassword('wrong',hash),false);});
test('quote calculates physical mass and gross margin',()=>{
  const input=quoteSchema.parse({descricao_projeto:'Chapa',liga:'ACO',comprimento_m:2,largura_mm:1000,espessura_mm:2,quantidade:1,preco_por_kg:8,horas:8,custo_hora:60,custo_acabamento:200,margem_lucro_pct:25});
  const result=calculateQuote(input);assert.equal(result.peso_total_calculado_kg,31.4);assert.equal(result.valor_final,1241.6);
  assert.throws(()=>quoteSchema.parse({...input,margem_lucro_pct:100}));
});
test('RLS denies unscoped reads and writes and prevents cross-tenant references',async()=>{
  assert.equal((await pg.query('select * from equipamentos')).rows.length,0);
  await assert.rejects(pg.query("insert into clientes(tenant_id,nome) values($1,'Inválido')",[a]));
  await pg.transaction(async tx=>{
    await tx.query("select set_config('app.current_tenant_id',$1,true)",[a]);
    const rows=await tx.query<{id:string}>('select id from equipamentos');assert.deepEqual(rows.rows.map(r=>r.id),[equipmentA]);
  });
  assert.equal((await pg.query('select * from equipamentos')).rows.length,0);
  await assert.rejects(pg.transaction(async tx=>{
    await tx.query("select set_config('app.current_tenant_id',$1,true)",[a]);
    await tx.query("insert into contratos_locacao(tenant_id,cliente_id,data_inicio,data_fim_prevista,valor_total,condicao_pagamento) values($1,$2,current_date,current_date,100,'À vista')",[a,customerB]);
  }));
  await assert.rejects(pg.transaction(async tx=>{
    await tx.query("select set_config('app.current_tenant_id',$1,true)",[a]);
    await tx.query("insert into clientes(tenant_id,nome) values($1,'Vazamento')",[b]);
  }));
});
type TestSession={token:string;userTenants:Array<{id:string}>;activeTenant:{id:string}};
let cachedSession:TestSession|undefined;
async function login():Promise<TestSession>{if(cachedSession)return cachedSession;const res=await app.inject({method:'POST',url:'/auth/login',payload:{email:'teste@nexo.local',password:'Strong-Test-Password'}});assert.equal(res.statusCode,200);cachedSession=res.json().data as TestSession;return cachedSession;}
async function loginAs(email:string):Promise<TestSession>{const res=await app.inject({method:'POST',url:'/auth/login',payload:{email,password:'Strong-Test-Password'}});assert.equal(res.statusCode,200,res.body);return res.json().data as TestSession;}
test('login, tenant switching, and tenant-scoped API reads',async()=>{
  const session=await login();assert.equal(session.userTenants.length,2);assert.equal(session.activeTenant.id,a);
  const headers={authorization:`Bearer ${session.token}`};
  const list=await app.inject({url:'/locacao/equipamentos',headers});assert.equal(list.statusCode,200);assert.deepEqual(list.json().data.map((r:{id:string})=>r.id),[equipmentA]);
  const forbidden=await app.inject({method:'POST',url:'/auth/switch-tenant',headers,payload:{target_tenant_id:c}});assert.equal(forbidden.statusCode,403);
  const switched=await app.inject({method:'POST',url:'/auth/switch-tenant',headers,payload:{target_tenant_id:b}});assert.equal(switched.statusCode,200);
  const next=await app.inject({url:'/locacao/equipamentos',headers:{authorization:`Bearer ${switched.json().data.token}`}});assert.deepEqual(next.json().data.map((r:{id:string})=>r.id),[equipmentB]);
  const unauthorized=await app.inject({url:'/locacao/equipamentos'});assert.equal(unauthorized.statusCode,401);
});
test('CORS preflight permits authenticated mutation methods from the web app',async()=>{
  for(const method of ['DELETE','PUT','PATCH']){
    const response=await app.inject({method:'OPTIONS',url:'/financeiro/transacoes/test-id',headers:{
      origin:'http://localhost:3000',
      'access-control-request-method':method,
      'access-control-request-headers':'authorization,content-type',
    }});
    assert.equal(response.statusCode,204,`${method}: ${response.body}`);
    assert.equal(response.headers['access-control-allow-origin'],'http://localhost:3000');
    assert.ok(String(response.headers['access-control-allow-methods']).split(',').map(value=>value.trim()).includes(method));
    assert.match(String(response.headers['access-control-allow-headers']),/authorization/i);
  }
});
test('API requests set JSON content-type only when a non-empty body is present',()=>{
  const noBody=apiRequestHeaders('test-token',{method:'DELETE'});
  assert.equal(noBody.get('authorization'),'Bearer test-token');
  assert.equal(noBody.has('content-type'),false);
  const emptyBody=apiRequestHeaders('test-token',{method:'DELETE',body:''});
  assert.equal(emptyBody.has('content-type'),false);
  const jsonBody=apiRequestHeaders('test-token',{method:'PUT',body:JSON.stringify({status:'OK'})});
  assert.equal(jsonBody.get('content-type'),'application/json');
  const overridden=apiRequestHeaders('test-token',{method:'POST',body:'{}',headers:{'Content-Type':'application/custom','Authorization':'Bearer override'}});
  assert.equal(overridden.get('content-type'),'application/custom');
  assert.equal(overridden.get('authorization'),'Bearer override');
});
test('database schema failures return safe guidance and a log reference',async()=>{
  const response=await app.inject({url:'/__test/missing-database-object'});
  assert.equal(response.statusCode,500);
  assert.equal(response.json().error.code,'DATABASE_MIGRATION_REQUIRED');
  assert.match(response.json().error.message,/migrations da API/);
  assert.ok(response.json().error.reference);
  assert.doesNotMatch(response.body,/sensitive database detail/);
});
test('company registration data is saved in the active tenant',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const response=await app.inject({method:'PUT',url:'/empresa',headers,payload:{
    nome_fantasia:'Empresa Atualizada',razao_social:'Empresa Atualizada LTDA',cnpj:'12.345.678/0001-95',
    telefone:'(11) 99999-0000',email:'contato@example.com',cidade:'São Paulo',estado:'SP'
  }});
  assert.equal(response.statusCode,200,response.body);
  const saved=response.json().data;
  assert.equal(saved.nome_fantasia,'Empresa Atualizada');
  assert.equal(saved.email,'contato@example.com');
  const {rows} = await pg.query<{nome_fantasia:string;email:string}>('select nome_fantasia,email from tenants where id=$1',[a]);
  const [row] = rows;
  assert.deepEqual(row,{nome_fantasia:'Empresa Atualizada',email:'contato@example.com'});
});
test('contract creation reserves an asset and rejects duplicate rental',async()=>{
  const session=await login();const headers={authorization:`Bearer ${session.token}`};
  const payload={cliente_id:customerA,data_inicio:'2026-09-19',data_fim_prevista:'2026-09-22',condicao_pagamento:'À vista',equipamento_ids:[equipmentA],periodicidade:'MENSAL',dia_vencimento:5,status:'ATIVO'};
  const created=await app.inject({method:'POST',url:'/locacao/contratos',headers,payload});assert.equal(created.statusCode,200,created.body);assert.equal(Number(created.json().data.valor_total),300);
  const rentedEquipment=await app.inject({url:'/locacao/equipamentos?status=LOCADO',headers});assert.equal(rentedEquipment.statusCode,200,rentedEquipment.body);assert.equal(rentedEquipment.json().data[0].status,'LOCADO');
  const finance=await app.inject({url:'/financeiro/transacoes?page=1&limit=50&search=Locação%3A%20Contrato',headers});
  assert.equal(finance.statusCode,200,finance.body);
  assert.equal(finance.json().data.data.length,1);
  assert.equal(finance.json().data.data[0].tipo,'RECEITA');
  assert.equal(finance.json().data.data[0].anexos.contrato_id,created.json().data.id);
  const duplicate=await app.inject({method:'POST',url:'/locacao/contratos',headers,payload});assert.equal(duplicate.statusCode,409);
  const foreign=await app.inject({method:'POST',url:'/locacao/contratos',headers,payload:{...payload,equipamento_ids:[equipmentB]}});assert.equal(foreign.statusCode,409);
  const returned=await app.inject({method:'PUT',url:`/locacao/contratos/${created.json().data.id}/encerrar`,headers});
  assert.equal(returned.statusCode,200,returned.body);
  assert.equal((await app.inject({url:'/locacao/equipamentos',headers})).json().data[0].status,'DISPONIVEL');
});
test('contract creation validates dates and requires at least one asset',async()=>{
  const session=await login();const headers={authorization:`Bearer ${session.token}`};
  const payload={cliente_id:customerA,data_inicio:'2026-09-22',data_fim_prevista:'2026-09-22',equipamento_ids:[equipmentA]};
  const invalidDates=await app.inject({method:'POST',url:'/locacao/contratos',headers,payload});
  assert.equal(invalidDates.statusCode,400,invalidDates.body);
  const noAssets=await app.inject({method:'POST',url:'/locacao/contratos',headers,payload:{...payload,data_inicio:'2026-09-19',data_fim_prevista:'2026-09-22',equipamento_ids:[]}});
  assert.equal(noAssets.statusCode,400,noAssets.body);
});
test('concluding the last maintenance order releases the equipment',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const opened=await app.inject({method:'POST',url:'/locacao/manutencoes',headers,payload:{equipamento_id:equipmentA,tipo_manutencao:'CORRETIVA',descricao_problema:'Troca de correia',tecnico_responsavel:'Ana'}});
  assert.equal(opened.statusCode,200,opened.body);
  assert.equal((await app.inject({url:'/locacao/equipamentos',headers})).json().data[0].status,'MANUTENCAO');
  const duplicate=await app.inject({method:'POST',url:'/locacao/manutencoes',headers,payload:{equipamento_id:equipmentA,tipo_manutencao:'PREVENTIVA',descricao_problema:'Ordem duplicada'}});
  assert.equal(duplicate.statusCode,409,duplicate.body);
  assert.equal(duplicate.json().error.code,'ACTIVE_MAINTENANCE_EXISTS');
  const concluded=await app.inject({method:'PUT',url:`/locacao/manutencoes/${opened.json().data.id}`,headers,payload:{status:'CONCLUIDA'}});
  assert.equal(concluded.statusCode,200,concluded.body);
  assert.equal((await app.inject({url:'/locacao/equipamentos',headers})).json().data[0].status,'DISPONIVEL');
});
test('contract list and soft deletion work',async()=>{
  const session=await login();
  const switched=await app.inject({method:'POST',url:'/auth/switch-tenant',headers:{authorization:`Bearer ${session.token}`},payload:{target_tenant_id:b}});
  assert.equal(switched.statusCode,200,switched.body);
  const headers={authorization:`Bearer ${switched.json().data.token}`};
  const payload={cliente_id:customerB,data_inicio:'2026-09-19',data_fim_prevista:'2026-09-22',condicao_pagamento:'À vista',equipamento_ids:[equipmentB]};
  const created=await app.inject({method:'POST',url:'/locacao/contratos',headers,payload});
  assert.equal(created.statusCode,200,created.body);
  assert.equal((await app.inject({url:'/locacao/equipamentos',headers})).json().data[0].status,'LOCADO');
  const id=created.json().data.id as string;
  const list=await app.inject({url:'/locacao/contratos',headers});
  assert.equal(list.statusCode,200,list.body);
  assert.equal(list.json().data.some((contract:{id:string})=>contract.id===id),true);
  const deleted=await app.inject({method:'DELETE',url:`/locacao/contratos/${id}`,headers});
  assert.equal(deleted.statusCode,200,deleted.body);
  assert.equal((await app.inject({url:'/locacao/equipamentos',headers})).json().data[0].status,'DISPONIVEL');
  const after=await app.inject({url:'/locacao/contratos',headers});
  assert.equal(after.json().data.some((contract:{id:string})=>contract.id===id),false);
});
test('equipment status aliases persist using the canonical LOCADO value',()=>{
  const common={nome:'Equipamento QA',patrimonio:'QA-STATUS-01',categoria:'Ferramenta',valor_locacao:100};
  assert.equal(normalizeEquipamentoInput({...common,status:'LOCADO'}).status,'LOCADO');
  assert.equal(normalizeEquipamentoInput({...common,status:'ALUGADO'}).status,'LOCADO');
});
test('finance transaction can be soft deleted',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const created=await app.inject({method:'POST',url:'/financeiro/transacoes',headers,payload:{tipo:'DESPESA',descricao:'Lançamento para exclusão',valor:100,data_competencia:'2026-10-14',data_vencimento:'2026-10-20',categoria:'Teste'}});
  assert.equal(created.statusCode,200,created.body);
  const id=created.json().data.id;
  const deleted=await app.inject({method:'DELETE',url:`/financeiro/transacoes/${id}`,headers});
  assert.equal(deleted.statusCode,200,deleted.body);
  const listed=await app.inject({url:'/financeiro/transacoes?page=1&limit=50&search=exclusão',headers});
  assert.equal(listed.statusCode,200,listed.body);
  assert.equal(listed.json().data.data.some((row:{id:string})=>row.id===id),false);
});
const isoDaysFromNow=(days:number)=>new Date(Date.now()+days*86_400_000).toISOString().slice(0,10);
test('finance payments record every method, support partial balances, and restrict reversal reasons to ADMIN',async()=>{
  const admin=await login(),adminHeaders={authorization:`Bearer ${admin.token}`};
  const finance=await loginAs('financeiro@nexo.local'),financeHeaders={authorization:`Bearer ${finance.token}`};
  const operator=await loginAs('operador@nexo.local'),operatorHeaders={authorization:`Bearer ${operator.token}`};
  const methods=['DINHEIRO','PIX','CARTAO_CREDITO','CARTAO_DEBITO','BOLETO','TRANSFERENCIA','OUTRO'] as const;
  let reversedId='';
  for(const [index,metodo] of methods.entries()){
    const created=await app.inject({method:'POST',url:'/financeiro/transacoes',headers:adminHeaders,payload:{tipo:'RECEITA',descricao:`Pagamento QA ${metodo}`,valor:100,data_competencia:'2026-10-15',data_vencimento:isoDaysFromNow(30),categoria:'Teste'}});
    assert.equal(created.statusCode,200,created.body);
    const id=created.json().data.id as string;
    const paid=await app.inject({method:'POST',url:`/financeiro/transacoes/${id}/baixas`,headers:financeHeaders,payload:{valor:100,data_pagamento:'2026-10-15',metodo,metodo_outro:metodo==='OUTRO'?'Carteira digital':undefined,observacao:'Comprovante conferido'}});
    assert.equal(paid.statusCode,200,paid.body);
    assert.equal(paid.json().data.status,'PAGO');
    const listed=await app.inject({url:`/financeiro/transacoes?page=1&limit=50&search=${encodeURIComponent(`Pagamento QA ${metodo}`)}`,headers:financeHeaders});
    assert.equal(listed.statusCode,200,listed.body);
    const event=(listed.json().data.data[0].pagamentos as Array<Record<string,unknown>>)[0];
    assert.equal(event.metodo,metodo);
    assert.equal(event.registrado_por_nome,'Financeiro');
    assert.equal('justificativa_reversao' in event,false);
    if(index===0)reversedId=id;
  }
  const invalidReversal=await app.inject({method:'POST',url:`/financeiro/transacoes/${reversedId}/reverter-baixa`,headers:financeHeaders,payload:{justificativa:'curta'}});
  assert.equal(invalidReversal.statusCode,400);
  const forbidden=await app.inject({method:'POST',url:`/financeiro/transacoes/${reversedId}/reverter-baixa`,headers:operatorHeaders,payload:{justificativa:'Ajuste solicitado pelo cliente'}});
  assert.equal(forbidden.statusCode,403);
  const reversed=await app.inject({method:'POST',url:`/financeiro/transacoes/${reversedId}/reverter-baixa`,headers:financeHeaders,payload:{justificativa:'Pagamento lançado em duplicidade'}});
  assert.equal(reversed.statusCode,200,reversed.body);
  assert.equal(reversed.json().data.status,'PENDENTE');
  const financeList=await app.inject({url:`/financeiro/transacoes?page=1&limit=50&search=${encodeURIComponent('Pagamento QA DINHEIRO')}`,headers:financeHeaders});
  const financeEvent=(financeList.json().data.data[0].pagamentos as Array<Record<string,unknown>>)[0];
  assert.equal(financeEvent.revertido_em!==null,true);
  assert.equal('justificativa_reversao' in financeEvent,false);
  const ownerList=await app.inject({url:`/financeiro/transacoes?page=1&limit=50&search=${encodeURIComponent('Pagamento QA DINHEIRO')}`,headers:adminHeaders});
  const ownerEvent=(ownerList.json().data.data[0].pagamentos as Array<Record<string,unknown>>)[0];
  assert.equal(ownerEvent.justificativa_reversao,'Pagamento lançado em duplicidade');
  const switched=await app.inject({method:'POST',url:'/auth/switch-tenant',headers:adminHeaders,payload:{target_tenant_id:b}});
  assert.equal(switched.statusCode,200,switched.body);
  const otherTenantHeaders={authorization:`Bearer ${switched.json().data.token}`};
  const hiddenFromOtherTenant=await app.inject({url:`/financeiro/transacoes?page=1&limit=50&search=${encodeURIComponent('Pagamento QA DINHEIRO')}`,headers:otherTenantHeaders});
  assert.equal(hiddenFromOtherTenant.statusCode,200,hiddenFromOtherTenant.body);
  assert.equal(hiddenFromOtherTenant.json().data.data.length,0);
});
test('partial payments keep an open balance or explicitly write it off when settled',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const create=async(descricao:string)=>{
    const result=await app.inject({method:'POST',url:'/financeiro/transacoes',headers,payload:{tipo:'RECEITA',descricao,valor:100,data_competencia:'2026-10-15',data_vencimento:isoDaysFromNow(30),categoria:'Teste'}});
    assert.equal(result.statusCode,200,result.body);return result.json().data.id as string;
  };
  const openId=await create('Pagamento parcial em aberto QA');
  const missingChoice=await app.inject({method:'POST',url:`/financeiro/transacoes/${openId}/baixas`,headers,payload:{valor:30,data_pagamento:'2026-10-15',metodo:'PIX'}});
  assert.equal(missingChoice.statusCode,400);
  const partial=await app.inject({method:'POST',url:`/financeiro/transacoes/${openId}/baixas`,headers,payload:{valor:30,data_pagamento:'2026-10-15',metodo:'PIX',acao_parcial:'MANTER_ABERTO'}});
  assert.equal(partial.statusCode,200,partial.body);
  assert.equal(partial.json().data.status,'PENDENTE');
  const openList=await app.inject({url:`/financeiro/transacoes?page=1&limit=50&search=${encodeURIComponent('Pagamento parcial em aberto QA')}`,headers});
  assert.equal(Number(openList.json().data.data[0].saldo_aberto),70);
  const finalPayment=await app.inject({method:'POST',url:`/financeiro/transacoes/${openId}/baixas`,headers,payload:{valor:70,data_pagamento:'2026-10-16',metodo:'DINHEIRO'}});
  assert.equal(finalPayment.statusCode,200,finalPayment.body);
  assert.equal(finalPayment.json().data.status,'PAGO');

  const waivedId=await create('Pagamento parcial quitado QA');
  const waived=await app.inject({method:'POST',url:`/financeiro/transacoes/${waivedId}/baixas`,headers,payload:{valor:40,data_pagamento:'2026-10-15',metodo:'BOLETO',acao_parcial:'QUITAR'}});
  assert.equal(waived.statusCode,200,waived.body);
  assert.equal(waived.json().data.status,'PAGO');
  const waivedList=await app.inject({url:`/financeiro/transacoes?page=1&limit=50&search=${encodeURIComponent('Pagamento parcial quitado QA')}`,headers});
  const event=(waivedList.json().data.data[0].pagamentos as Array<Record<string,unknown>>)[0];
  assert.equal(Number(event.valor_dispensado),60);
  assert.equal(Number(waivedList.json().data.data[0].saldo_aberto),0);
});
test('stock product deletion is soft, idempotent-safe, and tenant-scoped',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const created=await app.inject({method:'POST',url:'/estoque/produtos',headers,payload:{nome:'Produto para exclusão QA',sku:'QA-DELETE-01',custo_medio:10,preco_venda:20,estoque_atual:2,estoque_minimo:0}});
  assert.equal(created.statusCode,200,created.body);
  const id=created.json().data.id as string;
  const paginated=await app.inject({url:'/estoque/produtos?page=1&limit=10&search=QA-DELETE-01',headers});
  assert.equal(paginated.statusCode,200,paginated.body);
  assert.equal(paginated.json().data.meta.limit,10);
  assert.equal(paginated.json().data.data.some((product:{id:string})=>product.id===id),true);
  const movementPage=await app.inject({url:'/estoque/movimentacoes?page=1&limit=5',headers});
  assert.equal(movementPage.statusCode,200,movementPage.body);
  assert.equal(movementPage.json().data.meta.limit,5);
  const deleted=await app.inject({method:'DELETE',url:`/estoque/produtos/${id}`,headers});
  assert.equal(deleted.statusCode,200,deleted.body);
  assert.equal(deleted.json().data.id,id);
  const listed=await app.inject({url:'/estoque/produtos',headers});
  assert.equal(listed.statusCode,200,listed.body);
  assert.equal(listed.json().data.some((product:{id:string})=>product.id===id),false);
  assert.equal((await app.inject({method:'DELETE',url:`/estoque/produtos/${id}`,headers})).statusCode,404);
  const switched=await app.inject({method:'POST',url:'/auth/switch-tenant',headers,payload:{target_tenant_id:b}});
  assert.equal(switched.statusCode,200,switched.body);
  const otherTenantHeaders={authorization:`Bearer ${switched.json().data.token}`};
  assert.equal((await app.inject({method:'DELETE',url:`/estoque/produtos/${id}`,headers:otherTenantHeaders})).statusCode,404);
});
test('quote-to-production workflow enforces sequential stages',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const quote=await app.inject({method:'POST',url:'/serralheria/orcamentos',headers,payload:{descricao_projeto:'Chapa teste',liga:'ACO',comprimento_m:2,largura_mm:1000,espessura_mm:2,quantidade:1,preco_por_kg:8,horas:8,custo_hora:60,custo_acabamento:200,margem_lucro_pct:25}});assert.equal(quote.statusCode,200,quote.body);
  const order=await app.inject({method:'POST',url:'/serralheria/ordens-servico',headers,payload:{orcamento_id:quote.json().data.id,data_entrega_prometida:'2026-10-01'}});assert.equal(order.statusCode,200,order.body);
  const url=`/serralheria/ordens-servico/${order.json().data.id}/etapa`;
  assert.equal((await app.inject({method:'PATCH',url,headers,payload:{status_etapa:'CONCLUIDO'}})).statusCode,409);
  assert.equal((await app.inject({method:'PATCH',url,headers,payload:{status_etapa:'SOLDA'}})).statusCode,200);
});
test('dashboards return tenant-scoped metrics and chart datasets',async()=>{const session=await login();const headers={authorization:`Bearer ${session.token}`};const rental=await app.inject({url:'/locacao/dashboard',headers});assert.equal(rental.statusCode,200,rental.body);assert.ok(rental.json().data.ocupacao>=0);assert.equal(rental.json().data.revenueHistory.length,6);assert.deepEqual(rental.json().data.contacts.map((contact:{id:string})=>contact.id),[customerA]);for(const url of ['/serralheria/dashboard','/dashboard/consolidado']){const res=await app.inject({url,headers});assert.equal(res.statusCode,200,res.body);}});
test('production cards move between stages and create one receivable on completion',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const response=await app.inject({url:'/producao/workflows?page=1&limit=50',headers});
  assert.equal(response.statusCode,200,response.body);
  const workflow=response.json().data.data[0],stages=workflow.stages as Array<{id:string;ordem:number}>;
  assert.ok(stages.length>=2);
  const created=await app.inject({method:'POST',url:'/producao/cards',headers,payload:{workflow_id:workflow.id,stage_id:stages[0].id,titulo:'Card teste kanban',cliente_id:customerA,valor:123.45}});
  assert.equal(created.statusCode,200,created.body);
  const cardId=created.json().data.id as string;
  const moved=await app.inject({method:'PUT',url:`/producao/cards/${cardId}/mover`,headers,payload:{stage_id:stages[1].id,ordem:0}});
  assert.equal(moved.statusCode,200,moved.body);
  assert.equal(moved.json().data.card.stage_id,stages[1].id);
  const lastStage=stages.reduce((last,stage)=>stage.ordem>last.ordem?stage:last,stages[0]);
  const completed=await app.inject({method:'PUT',url:`/producao/cards/${cardId}/mover`,headers,payload:{stage_id:lastStage.id,ordem:0}});
  assert.equal(completed.statusCode,200,completed.body);
  assert.equal(completed.json().data.concluido,true);
  const retried=await app.inject({method:'PUT',url:`/producao/cards/${cardId}/mover`,headers,payload:{stage_id:lastStage.id,ordem:0}});
  assert.equal(retried.statusCode,200,retried.body);
  const finance=await app.inject({url:'/financeiro/transacoes?page=1&limit=50&search=Card%20teste%20kanban',headers});
  assert.equal(finance.statusCode,200,finance.body);
  assert.equal(finance.json().data.data.length,1);
});
test('production workflows and stages can be customized and safely deleted',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const created=await app.inject({method:'POST',url:'/producao/workflows',headers,payload:{nome:'Fluxo customizável',descricao:'QA',stages:[{nome:'Entrada',cor:'#112233'},{nome:'Final',cor:'#445566'}]}});
  assert.equal(created.statusCode,200,created.body);
  const workflow=created.json().data,stages=workflow.stages as Array<{id:string;ordem:number}>;
  const updated=await app.inject({method:'PUT',url:`/producao/workflows/${workflow.id}/stages/${stages[0].id}`,headers,payload:{nome:'Triagem',cor:'#abcdef'}});
  assert.equal(updated.statusCode,200,updated.body);
  assert.equal(updated.json().data.nome,'Triagem');
  const reordered=await app.inject({method:'PUT',url:`/producao/workflows/${workflow.id}/stages/order`,headers,payload:{stage_ids:[stages[1].id,stages[0].id]}});
  assert.equal(reordered.statusCode,200,reordered.body);
  const card=await app.inject({method:'POST',url:'/producao/cards',headers,payload:{workflow_id:workflow.id,stage_id:stages[0].id,titulo:'Card para remover'}});
  assert.equal(card.statusCode,200,card.body);
  const blockedStage=await app.inject({method:'DELETE',url:`/producao/workflows/${workflow.id}/stages/${stages[0].id}`,headers});
  assert.equal(blockedStage.statusCode,409);
  const blockedWorkflow=await app.inject({method:'DELETE',url:`/producao/workflows/${workflow.id}`,headers});
  assert.equal(blockedWorkflow.statusCode,409);
  assert.equal((await app.inject({method:'DELETE',url:`/producao/cards/${card.json().data.id}`,headers})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:`/producao/workflows/${workflow.id}/stages/${stages[0].id}`,headers})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:`/producao/workflows/${workflow.id}`,headers})).statusCode,200);
});
test('deleting a draft quote is tenant-scoped and removes it from the list',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const quote=await app.inject({method:'POST',url:'/orcamentos',headers,payload:{cliente_id:customerA,tipo:'SERVICO',itens:[{produto_nome:'Orçamento para exclusão QA',quantidade:1,valor_unitario:100,desconto:0}]}});
  assert.equal(quote.statusCode,200,quote.body);
  const id=quote.json().data.id as string;
  const deleted=await app.inject({method:'DELETE',url:`/orcamentos/${id}`,headers});
  assert.equal(deleted.statusCode,200,deleted.body);
  const list=await app.inject({url:'/orcamentos?page=1&limit=50&search=Orçamento%20para%20exclusão%20QA',headers});
  assert.equal(list.statusCode,200,list.body);
  assert.equal(list.json().data.data.some((row:{id:string})=>row.id===id),false);
  assert.equal((await app.inject({method:'DELETE',url:`/orcamentos/${id}`,headers})).statusCode,404);
  const otherTenant=await app.inject({method:'POST',url:'/auth/switch-tenant',headers,payload:{target_tenant_id:b}});
  assert.equal(otherTenant.statusCode,200,otherTenant.body);
  const foreignHeaders={authorization:`Bearer ${otherTenant.json().data.token}`};
  assert.equal((await app.inject({method:'DELETE',url:`/orcamentos/${id}`,headers:foreignHeaders})).statusCode,404);
});
test('quote stores its delivery deadline and returns customer address for PDF generation',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const created=await app.inject({method:'POST',url:'/orcamentos',headers,payload:{cliente_id:customerA,prazo_entrega:'15 dias úteis',itens:[{produto_nome:'Portão',quantidade:1,valor_unitario:100,desconto:0}]}});
  assert.equal(created.statusCode,200,created.body);
  assert.equal(created.json().data.prazo_entrega,'15 dias úteis');
  const loaded=await app.inject({url:`/orcamentos/${created.json().data.id}`,headers});
  assert.equal(loaded.statusCode,200,loaded.body);
  assert.equal(loaded.json().data.prazo_entrega,'15 dias úteis');
  assert.deepEqual(loaded.json().data.cliente_endereco,{rua:'Rua das Flores',numero:'123',bairro:'Centro',cidade:'São Paulo',uf:'SP'});
});
test('client dropdown options return a compact list for the active tenant',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const response=await app.inject({url:'/clientes/opcoes',headers});
  assert.equal(response.statusCode,200,response.body);
  const options=response.json().data as Array<{id:string;nome:string;documento:string|null;endereco?:unknown}>;
  assert.deepEqual(options.map(option=>option.id),[customerA]);
  assert.equal(options[0].nome,'Cliente');
  assert.equal('endereco' in options[0],false);
});
test('quote inserts all line items in one request and calculates their total with unit and percentage discount',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const created=await app.inject({method:'POST',url:'/orcamentos',headers,payload:{cliente_id:customerA,tipo:'SERVICO',itens:[
    {produto_nome:'Portão',unidade:'UN',quantidade:1,valor_unitario:100,desconto:0},
    {produto_nome:'Perfil em barra',unidade:'M',quantidade:2,valor_unitario:50,desconto:10},
    {produto_nome:'Chapa de aço',unidade:'KG',quantidade:10,valor_unitario:20,desconto:25},
    {produto_nome:'Estrutura completa',desconto:10,medidas:[
      {unidade:'UN',quantidade:2,valor_unitario:50},
      {unidade:'KG',quantidade:10,valor_unitario:10},
      {unidade:'M',quantidade:5,valor_unitario:20},
    ]},
  ]}});
  assert.equal(created.statusCode,200,created.body);
  assert.equal(Number(created.json().data.valor_total),610);
  const loaded=await app.inject({url:`/orcamentos/${created.json().data.id}`,headers});
  assert.equal(loaded.statusCode,200,loaded.body);
  assert.equal(loaded.json().data.itens.length,4);
  assert.deepEqual(
    loaded.json().data.itens
      .map((i:{produto_nome:string;unidade:string;total:string;medidas:Array<{unidade:string}>})=>({produto_nome:i.produto_nome,unidade:i.unidade,medidas:i.medidas.map(m=>m.unidade),total:Number(i.total)}))
      .sort((x:{produto_nome:string},y:{produto_nome:string})=>x.produto_nome.localeCompare(y.produto_nome)),
    [
      {produto_nome:'Chapa de aço',unidade:'KG',medidas:['KG'],total:150},
      {produto_nome:'Estrutura completa',unidade:'UN+KG+M',medidas:['UN','KG','M'],total:270},
      {produto_nome:'Perfil em barra',unidade:'M',medidas:['M'],total:90},
      {produto_nome:'Portão',unidade:'UN',medidas:['UN'],total:100},
    ],
  );
});
test('rejecting a quote validates the reason and records the rejected status',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const quote=await app.inject({method:'POST',url:'/orcamentos',headers,payload:{cliente_id:customerA,tipo:'SERVICO',itens:[{produto_nome:'Portão',quantidade:1,valor_unitario:100,desconto:0}]}});
  assert.equal(quote.statusCode,200,quote.body);
  const id=quote.json().data.id as string;
  const invalid=await app.inject({method:'PUT',url:`/orcamentos/${id}/reprovar`,headers,payload:{motivo:'x'}});
  assert.equal(invalid.statusCode,400,invalid.body);
  const rejected=await app.inject({method:'PUT',url:`/orcamentos/${id}/reprovar`,headers,payload:{motivo:'Prazo de entrega incompatível'}});
  assert.equal(rejected.statusCode,200,rejected.body);
  assert.equal(rejected.json().data.status,'REPROVADO');
  assert.equal((await app.inject({method:'PUT',url:`/orcamentos/${id}/reprovar`,headers,payload:{motivo:'Reprovação repetida'}})).statusCode,409);
});
test('CNPJ lookup queries api.w14n.dev/v1 first and falls back to BrasilAPI on 404',async()=>{
  const session=await login(),headers={authorization:`Bearer ${session.token}`};
  const invalidRes=await app.inject({url:'/clientes/cnpj/11111111111111',headers});
  assert.equal(invalidRes.statusCode,400,invalidRes.body);

  const w14nResult=await lookupCnpj('00.043.463/0004-83',async(input)=>{
    const url=String(input);
    assert.match(url,/api\.w14n\.dev\/v1\/company\/00043463000483/);
    return new Response(JSON.stringify({
      meta:{api_version:'1',dataset:'company_profiles_export_sectors',data_as_of:'2026-08',source:'RFB'},
      data:{
        cnpj:'00043463000483',
        legal_name:'PANABRA MINERACAO AGROPASTORIL LTDA',
        trade_name:'PANABRA',
        legal_nature:{code:'2062',description_pt:'Sociedade Empresária Limitada'},
        status:{code:'02',description_en:'Active'},
        opened_on:'1969-06-26',
        company_size:{code:'01',description_en:'Microenterprise (ME)'},
        share_capital:{amount:50000,currency:'BRL'},
        main_activity:{cnae_code:'0710301',description_pt:'Extração de minério de ferro'},
        location:{city:'Brasília',state:'DF',postal_code:'70310500',country:'BR'},
      },
    }),{status:200,headers:{'content-type':'application/json'}});
  });
  assert.equal(w14nResult.fonte,'w14n');
  assert.equal(w14nResult.razao_social,'PANABRA MINERACAO AGROPASTORIL LTDA');
  assert.equal(w14nResult.nome_fantasia,'PANABRA');
  assert.equal(w14nResult.situacao_cadastral,'ATIVA');
  assert.equal(w14nResult.endereco.cep,'70310-500');
  assert.equal(w14nResult.endereco.cidade,'Brasília');
  assert.equal(w14nResult.endereco.uf,'DF');

  const fallbackResult=await lookupCnpj('12.345.678/0001-95',async(input)=>{
    const url=String(input);
    if(url.includes('api.w14n.dev')){
      return new Response(JSON.stringify({error:{code:'NOT_FOUND',message:'Not in sample',hint:''}}),{status:404});
    }
    return new Response(JSON.stringify({
      cnpj:'12345678000195',
      razao_social:'SERRALHERIA EXEMPLO LTDA',
      nome_fantasia:'ART STEEL',
      descricao_situacao_cadastral:'ATIVA',
      natureza_juridica:'Sociedade Empresária Limitada',
      porte:'ME',
      capital_social:120000,
      data_inicio_atividade:'2020-03-10',
      cnae_fiscal:2542000,
      cnae_fiscal_descricao:'Fabricação de artigos de serralheria, exceto esquadrias',
      ddd_telefone_1:'11988887777',
      email:'CONTATO@ARTSTEEL.COM.BR',
      cep:'01001000',
      descricao_tipo_de_logradouro:'PRAÇA',
      logradouro:'DA SÉ',
      numero:'100',
      bairro:'SÉ',
      municipio:'SÃO PAULO',
      uf:'sp',
    }),{status:200,headers:{'content-type':'application/json'}});
  });
  assert.equal(fallbackResult.fonte,'brasilapi');
  assert.equal(fallbackResult.razao_social,'SERRALHERIA EXEMPLO LTDA');
  assert.equal(fallbackResult.telefone,'(11) 98888-7777');
  assert.equal(fallbackResult.email,'contato@artsteel.com.br');
  assert.equal(fallbackResult.endereco.cep,'01001-000');
  assert.equal(fallbackResult.endereco.rua,'PRAÇA DA SÉ');
  assert.equal(fallbackResult.endereco.uf,'SP');
});

async function injectJson<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  token?: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: T; rawBody: string }> {
  const res = await app.inject({
    method,
    url,
    remoteAddress: '10.255.0.1',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
  let body = null as T;
  try {
    body = JSON.parse(res.body) as T;
  } catch {
    body = res.body as unknown as T;
  }
  return { statusCode: res.statusCode, body, rawBody: res.body };
}

let cachedArtSteelToken: string | null = null;
async function getArtSteelToken(rememberMe?: boolean): Promise<string> {
  if (!rememberMe && cachedArtSteelToken) return cachedArtSteelToken;
  const loginRes = await injectJson<{ success: boolean; data: { token: string } }>(
    'POST',
    '/auth/login',
    undefined,
    {
      email: 'teste@nexo.local',
      password: 'Strong-Test-Password',
      ...(rememberMe !== undefined ? { rememberMe } : {}),
    },
  );
  assert.equal(loginRes.statusCode, 200, loginRes.rawBody);
  const token = loginRes.body?.data?.token;
  assert.ok(token, loginRes.rawBody);
  if (!rememberMe) cachedArtSteelToken = token;
  return token;
}

test('artsteel: cadastro de cliente 100% opcional e limpeza de campos no PUT', async () => {
  const token = await getArtSteelToken();

  const createEmptyRes = await injectJson<{
    success: boolean;
    data: { id: string; nome: string; status: string };
  }>('POST', '/clientes', token, {});
  assert.ok([200, 201].includes(createEmptyRes.statusCode), createEmptyRes.rawBody);
  assert.equal(createEmptyRes.body.success, true);
  assert.equal(createEmptyRes.body.data.nome, 'Cliente sem nome');
  assert.equal(createEmptyRes.body.data.status, 'ATIVO');

  const createPartialRes = await injectJson<{
    success: boolean;
    data: { id: string; nome: string; email: string | null; telefone: string | null };
  }>('POST', '/clientes', token, {
    nome: 'Cliente Parcial ArtSteel',
    email: '',
    telefone: '(31) 99999-0000',
  });
  assert.ok([200, 201].includes(createPartialRes.statusCode), createPartialRes.rawBody);
  assert.equal(createPartialRes.body.data.nome, 'Cliente Parcial ArtSteel');
  assert.equal(createPartialRes.body.data.email, null);

  const updateClearRes = await injectJson<{
    success: boolean;
    data: { telefone: string | null; email: string | null };
  }>('PUT', `/clientes/${createPartialRes.body.data.id}`, token, {
    telefone: '',
    email: '',
  });
  assert.equal(updateClearRes.statusCode, 200, updateClearRes.rawBody);
  assert.equal(updateClearRes.body.data.telefone, null);
  assert.equal(updateClearRes.body.data.email, null);
});

test('artsteel: equipamento default Média, contrato sem data fim, renovação automática mensal e encerramento', async () => {
  const token = await getArtSteelToken();

  const eqRes = await injectJson<{
    success: boolean;
    data: { id: string; criticidade: string; patrimonio: string; valor_locacao: number; status: string };
  }>('POST', '/locacao/equipamentos', token, {
    nome: 'Andaimes Art Steel Teste',
    patrimonio: 'PAT-ART-070',
    valor_locacao: 450,
  });
  assert.equal(eqRes.statusCode, 201, eqRes.rawBody);
  assert.equal(eqRes.body.success, true);
  assert.equal(eqRes.body.data.criticidade, 'Média');
  assert.equal(eqRes.body.data.patrimonio, 'PAT-ART-070');
  assert.equal(Number(eqRes.body.data.valor_locacao), 450);

  const contratoRes = await injectJson<{
    success: boolean;
    data: {
      id: string;
      data_fim_prevista: string | null;
      renovacao_automatica: boolean;
      ciclos_cobrados: number;
    };
  }>('POST', '/locacao/contratos', token, {
    cliente_id: customerA,
    data_inicio: isoDaysFromNow(-70),
    equipamento_ids: [eqRes.body.data.id],
  });
  assert.ok([200, 201].includes(contratoRes.statusCode), contratoRes.rawBody);
  assert.equal(contratoRes.body.success, true);
  assert.equal(contratoRes.body.data.data_fim_prevista, null);
  assert.equal(contratoRes.body.data.renovacao_automatica, true);
  assert.equal(Number(contratoRes.body.data.ciclos_cobrados), 3);

  const contratoId = contratoRes.body.data.id;
  const txSearch = encodeURIComponent('Mensalidade Locação');
  const txBeforeRes = await injectJson<{
    success: boolean;
    data: {
      data: Array<{ id: string; tipo: string; valor: number; anexos?: { contrato_id?: string; ciclo?: number } | null }>;
    };
  }>('GET', `/financeiro/transacoes?tipo=RECEITA&limit=100&search=${txSearch}`, token);
  assert.equal(txBeforeRes.statusCode, 200, txBeforeRes.rawBody);
  const txBeforeRows = txBeforeRes.body.data.data.filter((row) => row.anexos?.contrato_id === contratoId);
  assert.equal(txBeforeRows.length, 3);
  for (const row of txBeforeRows) {
    assert.equal(row.tipo, 'RECEITA');
  }

  const listRes = await injectJson<{
    success: boolean;
    data: Array<{ id: string; ciclos_cobrados: number; renovacao_automatica: boolean }>;
  }>('GET', '/locacao/contratos', token);
  assert.equal(listRes.statusCode, 200, listRes.rawBody);
  const listed = listRes.body.data.find((item) => item.id === contratoId);
  assert.ok(listed);
  assert.equal(Number(listed.ciclos_cobrados), 3);

  const txAfterRes = await injectJson<{
    success: boolean;
    data: {
      data: Array<{ id: string; anexos?: { contrato_id?: string } | null }>;
    };
  }>('GET', `/financeiro/transacoes?tipo=RECEITA&limit=100&search=${txSearch}`, token);
  assert.equal(txAfterRes.statusCode, 200, txAfterRes.rawBody);
  const txAfterRows = txAfterRes.body.data.data.filter((row) => row.anexos?.contrato_id === contratoId);
  assert.equal(txAfterRows.length, 3);

  const encerrarRes = await injectJson<{
    success: boolean;
    data: { status: string; renovacao_automatica: boolean };
  }>('PUT', `/locacao/contratos/${contratoId}/encerrar`, token, {});
  assert.equal(encerrarRes.statusCode, 200, encerrarRes.rawBody);
  assert.equal(encerrarRes.body.success, true);
  assert.equal(encerrarRes.body.data.status, 'ENCERRADO');
  assert.equal(encerrarRes.body.data.renovacao_automatica, false);

  const eqAfterRes = await injectJson<{
    success: boolean;
    data: Array<{ id: string; status: string }>;
  }>('GET', '/locacao/equipamentos', token);
  assert.equal(eqAfterRes.statusCode, 200, eqAfterRes.rawBody);
  const eqAfter = eqAfterRes.body.data.find((item) => item.id === eqRes.body.data.id);
  assert.equal(eqAfter?.status, 'DISPONIVEL');
});

test('artsteel: contas a pagar ordenadas por vencimento e lembretes_a_pagar no dashboard', async () => {
  const token = await getArtSteelToken();
  const marker = 'LMB-ARTSTEEL-VENC';

  const entries = [
    { desc: `${marker}-5D`, due: isoDaysFromNow(5), valor: 500 },
    { desc: `${marker}-ATRASADA`, due: isoDaysFromNow(-3), valor: 300 },
    { desc: `${marker}-HOJE`, due: isoDaysFromNow(0), valor: 200 },
  ];

  for (const item of entries) {
    const postRes = await injectJson<{ success: boolean }>(
      'POST',
      '/financeiro/transacoes',
      token,
      {
        tipo: 'DESPESA',
        descricao: item.desc,
        valor: item.valor,
        data_competencia: item.due,
        data_vencimento: item.due,
        status: 'PENDENTE',
        categoria: 'Fornecedores',
      },
    );
    assert.ok([200, 201].includes(postRes.statusCode), postRes.rawBody);
  }

  const listRes = await injectJson<{
    success: boolean;
    data: { data: Array<{ descricao: string; data_vencimento: string }> };
  }>('GET', `/financeiro/transacoes?tipo=DESPESA&status=ABERTO&search=${encodeURIComponent(marker)}`, token);
  assert.equal(listRes.statusCode, 200, listRes.rawBody);
  const payables = listRes.body.data.data;
  assert.equal(payables.length, 3);
  assert.equal(payables[0]?.descricao, `${marker}-ATRASADA`);
  assert.equal(payables[1]?.descricao, `${marker}-HOJE`);
  assert.equal(payables[2]?.descricao, `${marker}-5D`);

  const dashRes = await injectJson<{
    success: boolean;
    data: {
      lembretes_a_pagar: {
        vencidas: { quantidade: number; total: number };
        vence_hoje: { quantidade: number; total: number };
        proximos_7_dias: { quantidade: number; total: number };
      };
    };
  }>('GET', '/financeiro/dashboard', token);
  assert.equal(dashRes.statusCode, 200, dashRes.rawBody);
  assert.ok(dashRes.body.data.lembretes_a_pagar.vencidas.quantidade >= 1);
  assert.ok(dashRes.body.data.lembretes_a_pagar.vence_hoje.quantidade >= 1);
  assert.ok(dashRes.body.data.lembretes_a_pagar.proximos_7_dias.quantidade >= 1);
});

test('artsteel: persistência de /empresa e preservação de remember no switch-tenant', async () => {
  const token = await getArtSteelToken(true);

  const putEmpresaRes = await injectJson<{ success: boolean }>('PUT', '/empresa', token, {
    nome_fantasia: 'Art Steel Locações',
    razao_social: 'Filomeno Serviços Ltda.',
    cnpj: '51.972.840/0001-57',
    telefone: '(31) 97341-1767',
    email: 'artsteel56@gmail.com',
  });
  assert.equal(putEmpresaRes.statusCode, 200, putEmpresaRes.rawBody);

  const getEmpresaRes = await injectJson<{
    success: boolean;
    data: { nome_fantasia: string; razao_social: string };
  }>('GET', '/empresa', token);
  assert.equal(getEmpresaRes.statusCode, 200, getEmpresaRes.rawBody);
  assert.equal(getEmpresaRes.body.data.nome_fantasia, 'Art Steel Locações');
  assert.equal(getEmpresaRes.body.data.razao_social, 'Filomeno Serviços Ltda.');

  const switchRes = await injectJson<{ success: boolean; data: { token: string } }>(
    'POST',
    '/auth/switch-tenant',
    token,
    { target_tenant_id: b },
  );
  assert.equal(switchRes.statusCode, 200, switchRes.rawBody);
  const switchedToken = switchRes.body.data.token;
  assert.ok(switchedToken && switchedToken.includes('.'));

  const payload = JSON.parse(
    Buffer.from(switchedToken.split('.')[1]!, 'base64url').toString('utf8'),
  ) as { remember?: boolean; iat: number; exp: number };
  assert.equal(payload.remember, true);
  assert.ok(payload.exp - payload.iat > 20 * 86400);
});

test('artsteel: bloqueia cliente_id de outro tenant no orçamento e sanitiza sort de protótipo', async () => {
  const token = await getArtSteelToken();

  const crossTenantQuote = await injectJson<{ success: boolean; error?: { code?: string } }>(
    'POST',
    '/orcamentos',
    token,
    {
      cliente_id: customerB,
      tipo: 'SERVICO',
      itens: [{ produto_nome: 'Portão', quantidade: 1, valor_unitario: 100 }],
    },
  );
  assert.equal(crossTenantQuote.statusCode, 400, crossTenantQuote.rawBody);
  assert.equal(crossTenantQuote.body.error?.code, 'INVALID_CUSTOMER');

  const protoSortRes = await injectJson<{ success: boolean }>(
    'GET',
    '/financeiro/transacoes?sort=toString:asc',
    token,
  );
  assert.equal(protoSortRes.statusCode, 200, protoSortRes.rawBody);
  assert.equal(protoSortRes.body.success, true);
});



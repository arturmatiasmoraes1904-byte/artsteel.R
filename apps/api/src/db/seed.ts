import postgres from 'postgres';
import {hashPassword} from '../services/password.js';
if(!process.env.DATABASE_ADMIN_URL||!process.env.SEED_EMAIL||!process.env.SEED_PASSWORD)throw new Error('Configure DATABASE_ADMIN_URL, SEED_EMAIL e SEED_PASSWORD.');
if(process.env.SEED_PASSWORD.length<12)throw new Error('A senha inicial precisa ter 12 caracteres ou mais.');
const db=postgres(process.env.DATABASE_ADMIN_URL,{max:1});
try{await db.begin(async tx=>{
  const existing=await tx`select id from users where email=${process.env.SEED_EMAIL!.toLowerCase()}`;
  if(existing.length){console.log('Usuário já existe; seed preservado.');return;}
  const password=await hashPassword(process.env.SEED_PASSWORD!);
  const [user]=await tx`insert into users(name,email,password_hash) values('Administrador',${process.env.SEED_EMAIL!.toLowerCase()},${password}) returning id`;
  const companies=[{name:'Art Steel Locações',segment:'LOCADORA',cnpj:'00000000000101'},{name:'Art Steel',segment:'SERRALHERIA',cnpj:'00000000000202'}];
  for(const company of companies){
    const [tenant]=await tx`insert into tenants(razao_social,nome_fantasia,cnpj,segmento) values(${company.name},${company.name},${company.cnpj},${company.segment}) returning id`;
    await tx`insert into user_tenants(user_id,tenant_id,role) values(${user.id},${tenant.id},'ADMIN')`;
    await tx`select set_config('app.current_tenant_id',${tenant.id},true)`;
    await tx`insert into clientes(tenant_id,nome,documento) values(${tenant.id},'Cliente demonstração','DEMO')`;
    if(company.segment==='LOCADORA'){
      for(const [i,name] of ['Betoneira 400 L','Compactador de solo','Martelete 10 kg','Andaime tubular','Gerador 8 kVA','Betoneira 250 L'].entries()){
        const [equipment]=await tx`insert into equipamentos(tenant_id,nome,numero_patrimonio,categoria,status,valor_diaria,valor_reposicao) values(${tenant.id},${name},${'PAT-'+String(i+1).padStart(3,'0')},${['Concreto','Compactação','Demolição','Acesso','Energia','Concreto'][i]},${i===4?'MANUTENCAO':'DISPONIVEL'},${[90,150,85,35,220,65][i]},${[6000,9000,3500,1400,12000,4000][i]}) returning id`;
        if(i===4)await tx`insert into ordens_manutencao(tenant_id,equipamento_id,tipo,descricao) values(${tenant.id},${equipment.id},'PREVENTIVA','Revisão de filtros e lubrificação')`;
      }
    }else{
      await tx`insert into materias_primas(tenant_id,descricao,tipo,liga_metalica,peso_por_metro,preco_por_kg,estoque_atual) values(${tenant.id},'Barra chata 50 × 6 mm','BARRA','Aço carbono',2.355,8.5,120),(${tenant.id},'Tubo 40 × 40 × 2 mm','TUBO','Aço carbono',2.39,9.2,80)`;
      for(const [i,description] of ['Portão residencial','Guarda-corpo escada','Estrutura de cobertura'].entries()){
        const [quote]=await tx`insert into orcamentos_projetos(tenant_id,descricao_projeto,peso_total_calculado_kg,custo_materia_prima,custo_mao_obra,custo_acabamento,margem_lucro_pct,valor_final) values(${tenant.id},${description},120,960,900,300,25,2880) returning id`;
        await tx`insert into ordens_servico_serralheria(tenant_id,orcamento_id,status_etapa,data_entrega_prometida) values(${tenant.id},${quote.id},${['CORTE','SOLDA','ACABAMENTO'][i]},current_date+${(i+1)*7}::int)`;
      }
    }
    for(let i=0;i<4;i++)await tx`insert into faturas(tenant_id,origem,valor,data_vencimento,status_pagamento,tipo_documento) values(${tenant.id},${company.segment==='LOCADORA'?'LOCACAO':'SERRALHERIA'},${(i+1)*1250},current_date+${(i-1)*7}::int,${i===0?'ATRASADO':i===1?'PAGO':'PENDENTE'},${company.segment==='LOCADORA'?'FATURA_LOCACAO':'NFSE_SERVICO'})`;
  }
  console.log('Empresas criadas com a identidade da Art Steel e da Art Steel Locações.');
});}finally{await db.end();}

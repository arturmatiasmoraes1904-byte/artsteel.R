import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
if (!process.env.DATABASE_ADMIN_URL) throw new Error('Configure DATABASE_ADMIN_URL.');
const adminUrl = new URL(process.env.DATABASE_ADMIN_URL);
const local = ['localhost','127.0.0.1','[::1]'].includes(adminUrl.hostname);
const appPassword = process.env.DATABASE_APP_PASSWORD ?? (local ? 'local_app_change_me' : '');
if (!local && (appPassword.length < 24 || appPassword === 'local_app_change_me')) {
  throw new Error('Defina DATABASE_APP_PASSWORD com uma senha exclusiva de pelo menos 24 caracteres para nexo_app.');
}
const client = postgres(process.env.DATABASE_ADMIN_URL, { max: 1, prepare: false });
try {
  await client.begin(async tx => {
    await tx`select pg_advisory_xact_lock(937421)`;
    await tx`create table if not exists schema_migrations (version integer primary key, applied_at timestamptz default now())`;
    const applied = await tx`select version from schema_migrations where version=1`;
    if (!applied.length) {
      await tx.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      await tx`insert into schema_migrations(version) values(1)`;
    }
    // Quote through PostgreSQL format(%L), never interpolate secrets into SQL.
    await tx`select set_config('app.provision_password', ${appPassword}, true)`;
    await tx.unsafe("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='nexo_app') THEN EXECUTE format('CREATE ROLE nexo_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', current_setting('app.provision_password')); END IF; END $$;");
    await tx.unsafe(await readFile(new URL('./restrict-data-api.sql', import.meta.url), 'utf8'));
    await tx`insert into schema_migrations(version) values(2) on conflict do nothing`;
    await tx.unsafe('GRANT USAGE ON SCHEMA public TO nexo_app; GRANT SELECT ON users,tenants,user_tenants TO nexo_app; GRANT SELECT,INSERT,UPDATE,DELETE ON clientes,equipamentos,contratos_locacao,itens_contrato,ordens_manutencao,materias_primas,orcamentos_projetos,ordens_servico_serralheria,faturas TO nexo_app;');
    const approvalMigration=await tx`select version from schema_migrations where version=3`;
    if (!approvalMigration.length) {
      await tx.unsafe(await readFile(new URL('./migrations/003_orcamento_aprovacao.sql', import.meta.url), 'utf8'));
      await tx`insert into schema_migrations(version) values(3)`;
    }
    const paginationMigration=await tx`select version from schema_migrations where version=4`;
    if (!paginationMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/004_pagination_indexes.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(4)`;}
    const cardEditMigration=await tx`select version from schema_migrations where version=5`;
    if (!cardEditMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/005_producao_card_edicao.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(5)`;}
    const publicMigration=await tx`select version from schema_migrations where version=6`;
    if (!publicMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/006_orcamento_publico.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(6)`;}
    const maintenanceMigration=await tx`select version from schema_migrations where version=7`;
    if (!maintenanceMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/007_manutencoes_operacao.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(7)`;}
    const productionFinanceMigration=await tx`select version from schema_migrations where version=8`;
    if (!productionFinanceMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/008_producao_financeiro.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(8)`;}
    const compatibilityMigration=await tx`select version from schema_migrations where version=9`;
    if (!compatibilityMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/009_clientes_compatibilidade.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(9)`;}
    const identityMigration=await tx`select version from schema_migrations where version=10`;
    if (!identityMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/010_identidade_empresas.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(10)`;}
    const maintenanceCompatibilityMigration=await tx`select version from schema_migrations where version=11`;
    if (!maintenanceCompatibilityMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/011_compatibilidade_ordens_manutencao.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(11)`;}
    const equipmentStatusMigration=await tx`select version from schema_migrations where version=12`;
    if (!equipmentStatusMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/012_equipamento_status_canonico.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(12)`;}
    const financeDeleteMigration=await tx`select version from schema_migrations where version=13`;
    if (!financeDeleteMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/013_financeiro_exclusao.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(13)`;}
    const companySettingsMigration=await tx`select version from schema_migrations where version=14`;
    if (!companySettingsMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/014_dados_cadastrais_empresas.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(14)`;}
    const contractsDeleteMigration=await tx`select version from schema_migrations where version=15`;
    if (!contractsDeleteMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/015_contratos_exclusao.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(15)`;}
    const stockSecurityMigration=await tx`select version from schema_migrations where version=16`;
    if (!stockSecurityMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/016_estoque_permissoes_rls.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(16)`;}
    const contractFinanceCompatibilityMigration=await tx`select version from schema_migrations where version=17`;
    if (!contractFinanceCompatibilityMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/017_contrato_financeiro_compatibilidade.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(17)`;}
    const financePaymentAuditMigration=await tx`select version from schema_migrations where version=18`;
    if (!financePaymentAuditMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/018_financeiro_baixas_auditoria.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(18)`;}
    const quoteDeliveryMigration=await tx`select version from schema_migrations where version=19`;
    if (!quoteDeliveryMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/019_orcamento_prazo_entrega.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(19)`;}
    const stockPerformanceMigration=await tx`select version from schema_migrations where version=20`;
    if (!stockPerformanceMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/020_estoque_performance_indexes.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(20)`;}
    const quoteItemUnitMigration=await tx`select version from schema_migrations where version=21`;
    if (!quoteItemUnitMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/021_orcamento_itens_unidade.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(21)`;}
    const artsteelContratosEquipamentosMigration=await tx`select version from schema_migrations where version=22`;
    if (!artsteelContratosEquipamentosMigration.length) {await tx.unsafe(await readFile(new URL('./migrations/022_artsteel_contratos_equipamentos.sql', import.meta.url), 'utf8'));await tx`insert into schema_migrations(version) values(22)`;}
  });
  console.log('Migração concluída.');
} finally { await client.end(); }


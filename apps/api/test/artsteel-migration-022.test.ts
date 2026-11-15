import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/services/password.js';
import type { Database } from '../src/db/client.js';

test('migration 022 allows nullable end dates, adds renewal columns idempotently, and checks constraints', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE ROLE nexo_app;
      CREATE TABLE clientes (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      CREATE TABLE equipamentos (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        nome text NOT NULL,
        numero_patrimonio text NOT NULL,
        categoria text NOT NULL,
        valor_diaria numeric(12,2) NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'DISPONIVEL',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE contratos_locacao (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        cliente_id uuid NOT NULL,
        data_inicio date NOT NULL,
        data_fim_prevista date NOT NULL,
        valor_total numeric(12,2) NOT NULL DEFAULT 0,
        condicao_pagamento text,
        status text NOT NULL DEFAULT 'ATIVO',
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CHECK (data_fim_prevista >= data_inicio)
      );
      CREATE TABLE transacoes_financeiras (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        tipo text NOT NULL,
        descricao text NOT NULL,
        valor numeric(12,2) NOT NULL DEFAULT 0,
        data_competencia date NOT NULL,
        data_vencimento date NOT NULL,
        status text NOT NULL DEFAULT 'PENDENTE',
        anexos jsonb,
        deleted_at timestamptz
      );
      INSERT INTO contratos_locacao (id, tenant_id, cliente_id, data_inicio, data_fim_prevista, valor_total, condicao_pagamento)
      VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2026-08-10', '2026-09-10', 450, 'Mensal');
    `);

    const migrationSql = await readFile(new URL('../src/db/migrations/022_artsteel_contratos_equipamentos.sql', import.meta.url), 'utf8');
    // Apply twice to verify full idempotency.
    await pg.exec(migrationSql);
    await pg.exec(migrationSql);

    const colMeta = await pg.query<{ column_name: string; is_nullable: string }>(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'contratos_locacao'
    `);
    const endDateCol = colMeta.rows.find(row => row.column_name === 'data_fim_prevista');
    assert.equal(endDateCol?.is_nullable, 'YES');
    assert.ok(colMeta.rows.some(row => row.column_name === 'renovacao_automatica'));
    assert.ok(colMeta.rows.some(row => row.column_name === 'ciclos_cobrados'));
    assert.ok(colMeta.rows.some(row => row.column_name === 'proximo_vencimento'));

    const equipCols = await pg.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'equipamentos'
    `);
    for (const expected of ['modelo', 'criticidade', 'data_aquisicao', 'localizacao', 'deleted_at']) {
      assert.ok(equipCols.rows.some(row => row.column_name === expected), `Missing equipamentos.${expected}`);
    }

    const [legacy] = (await pg.query<{ proximo_vencimento: string; renovacao_automatica: boolean; ciclos_cobrados: number }>(`
      SELECT proximo_vencimento::text, renovacao_automatica, ciclos_cobrados
      FROM contratos_locacao
      WHERE id = '30000000-0000-4000-8000-000000000001'
    `)).rows;
    assert.equal(legacy.proximo_vencimento.slice(0, 10), '2026-09-10');
    assert.equal(legacy.renovacao_automatica, true);
    assert.equal(legacy.ciclos_cobrados, 1);

    await pg.query(`
      INSERT INTO contratos_locacao (id, tenant_id, cliente_id, data_inicio, data_fim_prevista, valor_total, condicao_pagamento)
      VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2026-09-15', NULL, 600, 'Mensal Contínuo')
    `);

    await assert.rejects(
      pg.query(`
        INSERT INTO contratos_locacao (id, tenant_id, cliente_id, data_inicio, data_fim_prevista, valor_total, condicao_pagamento)
        VALUES ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2026-09-15', '2026-09-10', 600, 'Inválido')
      `),
    );
  } finally {
    await pg.close();
  }
});

test('full migrate.ts chain (v1..v22) executes cleanly and grants nexo_app permissions for Art Steel flows', async () => {
  const pg = new PGlite();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await pg.exec(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
    await pg.exec('CREATE ROLE nexo_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;');
    await pg.exec(await readFile(new URL('../src/db/restrict-data-api.sql', import.meta.url), 'utf8'));
    await pg.exec(
      'GRANT USAGE ON SCHEMA public TO nexo_app; ' +
      'GRANT SELECT ON users,tenants,user_tenants TO nexo_app; ' +
      'GRANT SELECT,INSERT,UPDATE,DELETE ON clientes,equipamentos,contratos_locacao,itens_contrato,ordens_manutencao,materias_primas,orcamentos_projetos,ordens_servico_serralheria,faturas TO nexo_app;'
    );

    const migrationsDirUrl = new URL('../src/db/migrations/', import.meta.url);
    const migrationFiles = (await readdir(migrationsDirUrl))
      .filter((name) => name.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));
    assert.ok(migrationFiles.includes('022_artsteel_contratos_equipamentos.sql'));

    for (const file of migrationFiles.filter((name) => name !== '022_artsteel_contratos_equipamentos.sql')) {
      const sqlContent = await readFile(new URL(file, migrationsDirUrl), 'utf8');
      await pg.exec(sqlContent);
    }
    // Simulate a legacy production DB before migration 022 was applied.
    await pg.exec(`
      ALTER TABLE contratos_locacao
        DROP COLUMN IF EXISTS renovacao_automatica,
        DROP COLUMN IF EXISTS ciclos_cobrados,
        DROP COLUMN IF EXISTS proximo_vencimento;
    `);

    const userId = '10000000-0000-4000-8000-000000000010';
    const tenantLocId = '10000000-0000-4000-8000-000000000011';
    const tenantSerrId = '10000000-0000-4000-8000-000000000012';
    const passwordHash = await hashPassword('ArtSteel-Migracao-2026!');

    await pg.query('INSERT INTO users(id, name, email, password_hash) VALUES($1, $2, $3, $4)', [
      userId,
      'Admin Art Steel',
      'admin@artsteel.local',
      passwordHash,
    ]);
    await pg.query(
      'INSERT INTO tenants(id, razao_social, nome_fantasia, cnpj, segmento) VALUES($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [
        tenantLocId,
        'Filomeno Serviços Ltda.',
        'Art Steel Locações',
        '51972840000157',
        'LOCADORA',
        tenantSerrId,
        'Art Steel Serralheria Ltda.',
        'Art Steel',
        '51972840000238',
        'SERRALHERIA',
      ],
    );
    await pg.query("INSERT INTO user_tenants(user_id, tenant_id, role) VALUES($1, $2, 'ADMIN'), ($1, $3, 'ADMIN')", [
      userId,
      tenantLocId,
      tenantSerrId,
    ]);

    await pg.exec('SET ROLE nexo_app;');

    const adapt = (source: any): any => ({
      execute: async (query: unknown) => (await source.execute(query)).rows,
      transaction: (callback: (tx: unknown) => Promise<unknown>) =>
        source.transaction((tx: unknown) => callback(adapt(tx))),
    });
    app = await buildApp(adapt(drizzle(pg)) as Database, 'artsteel-migration-chain-secret-32chars', false);

    const injectJson = async <T = any>(
      method: 'GET' | 'POST' | 'PUT',
      url: string,
      token?: string,
      payload?: unknown,
    ) => {
      const res = await app!.inject({
        method,
        url,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
      });
      return { statusCode: res.statusCode, body: JSON.parse(res.body) as T, rawBody: res.body };
    };

    const loginRes = await injectJson<{
      success: boolean;
      data: { token: string; userTenants: Array<{ cnpj: string; razao_social: string }> };
    }>('POST', '/auth/login', undefined, {
      email: 'admin@artsteel.local',
      password: 'ArtSteel-Migracao-2026!',
      rememberMe: true,
    });
    assert.equal(loginRes.statusCode, 200, loginRes.rawBody);
    assert.ok(
      loginRes.body.data.userTenants.some(t => t.cnpj === '51972840000157' && t.razao_social === 'Filomeno Serviços Ltda.'),
      loginRes.rawBody,
    );
    const token = loginRes.body.data.token;

    const preMigrationDashRes = await injectJson<{ data: { proximas_renovacoes: number | string } }>(
      'GET',
      '/locacao/contratos/dashboard',
      token,
    );
    assert.equal(preMigrationDashRes.statusCode, 200, preMigrationDashRes.rawBody);
    assert.equal(Number(preMigrationDashRes.body.data.proximas_renovacoes), 0);

    // Apply 022 twice to guarantee idempotency on top of the full migration chain.
    await pg.exec('RESET ROLE;');
    const migration022 = await readFile(new URL('022_artsteel_contratos_equipamentos.sql', migrationsDirUrl), 'utf8');
    await pg.exec(migration022);
    await pg.exec(migration022);
    await pg.exec('SET ROLE nexo_app;');

    const switchRes = await injectJson<{ success: boolean; data: { token: string } }>('POST', '/auth/switch-tenant', token, {
      target_tenant_id: tenantSerrId,
    });
    assert.equal(switchRes.statusCode, 200, switchRes.rawBody);
    const switchedPayload = JSON.parse(Buffer.from(switchRes.body.data.token.split('.')[1]!, 'base64url').toString('utf8')) as {
      remember?: boolean;
    };
    assert.equal(switchedPayload.remember, true);

    const putEmpresaRes = await injectJson('PUT', '/empresa', token, {
      nome_fantasia: 'Art Steel Locações',
      razao_social: 'Filomeno Serviços Ltda.',
      cnpj: '51.972.840/0001-57',
      telefone: '(31) 97341-1767',
      email: 'artsteel56@gmail.com',
    });
    assert.equal(putEmpresaRes.statusCode, 200, putEmpresaRes.rawBody);

    const getEmpresaRes = await injectJson<{ data: { razao_social: string } }>('GET', '/empresa', token);
    assert.equal(getEmpresaRes.statusCode, 200, getEmpresaRes.rawBody);
    assert.equal(getEmpresaRes.body.data.razao_social, 'Filomeno Serviços Ltda.');

    const clienteRes = await injectJson<{ data: { id: string; nome: string } }>('POST', '/clientes', token, {});
    assert.ok([200, 201].includes(clienteRes.statusCode), clienteRes.rawBody);
    assert.equal(clienteRes.body.data.nome, 'Cliente sem nome');

    const equipRes = await injectJson<{ data: { id: string } }>('POST', '/locacao/equipamentos', token, {
      nome: 'Gerador Teste',
      patrimonio: 'PAT-MIG-22',
      valor_locacao: 350,
    });
    assert.equal(equipRes.statusCode, 201, equipRes.rawBody);

    const seventyDaysAgo = new Date(Date.now() - 70 * 86400_000).toISOString().slice(0, 10);
    const contratoRes = await injectJson<{
      data: { id: string; data_fim_prevista: string | null; renovacao_automatica: boolean; ciclos_cobrados: number };
    }>('POST', '/locacao/contratos', token, {
      cliente_id: clienteRes.body.data.id,
      data_inicio: seventyDaysAgo,
      equipamento_ids: [equipRes.body.data.id],
    });
    assert.ok([200, 201].includes(contratoRes.statusCode), contratoRes.rawBody);
    assert.equal(contratoRes.body.data.data_fim_prevista, null);
    assert.equal(contratoRes.body.data.renovacao_automatica, true);
    assert.equal(Number(contratoRes.body.data.ciclos_cobrados), 3);

    const encerrarRes = await injectJson<{ data: { status: string } }>(
      'PUT',
      `/locacao/contratos/${contratoRes.body.data.id}/encerrar`,
      token,
      {},
    );
    assert.equal(encerrarRes.statusCode, 200, encerrarRes.rawBody);
    assert.equal(encerrarRes.body.data.status, 'ENCERRADO');

    const today = new Date().toISOString().slice(0, 10);
    const txRes = await injectJson('POST', '/financeiro/transacoes', token, {
      tipo: 'DESPESA',
      descricao: 'Conta Migracao Teste',
      valor: 250,
      data_competencia: today,
      data_vencimento: today,
      status: 'PENDENTE',
      categoria: 'Fornecedores',
    });
    assert.ok([200, 201].includes(txRes.statusCode), txRes.rawBody);

    const dashRes = await injectJson<{ data: { lembretes_a_pagar: { vence_hoje: { quantidade: number } } } }>(
      'GET',
      '/financeiro/dashboard',
      token,
    );
    assert.equal(dashRes.statusCode, 200, dashRes.rawBody);
    assert.ok(dashRes.body.data.lembretes_a_pagar.vence_hoje.quantidade >= 1);

    const manutRes = await injectJson<{ success: boolean }>('GET', '/locacao/manutencoes', token);
    assert.equal(manutRes.statusCode, 200, manutRes.rawBody);

    const prevCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'artsteel-cron-secret-nexo-app-check';
    try {
      const cronRes = await app!.inject({
        method: 'POST',
        url: '/cron/check-contracts',
        headers: { 'x-cron-secret': 'artsteel-cron-secret-nexo-app-check' },
      });
      assert.equal(cronRes.statusCode, 200, cronRes.body);
      const cronBody = JSON.parse(cronRes.body) as { data: { tenantsProcessed: number } };
      assert.equal(cronBody.data.tenantsProcessed, 2);
    } finally {
      if (prevCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCronSecret;
    }
  } finally {
    await app?.close();
    await pg.close();
  }
});

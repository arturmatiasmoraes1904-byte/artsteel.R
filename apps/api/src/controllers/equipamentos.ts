import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';

const EQUIPMENT_STATUS_VALUES = ['DISPONIVEL', 'LOCADO', 'ALUGADO', 'MANUTENCAO', 'INATIVO'] as const;

const equipamentoInputSchema = z.object({
  nome: z.string().trim().min(1),
  modelo: z.string().optional().nullable(),
  numero_serie: z.string().optional().nullable(),
  patrimonio: z.string().trim().min(1).optional(),
  numero_patrimonio: z.string().trim().min(1).optional(),
  categoria: z.string().trim().min(1).default('Geral'),
  criticidade: z.enum(['Alta', 'Média', 'Baixa']).default('Média'),
  status: z.enum(['DISPONIVEL', 'LOCADO', 'ALUGADO', 'MANUTENCAO', 'INATIVO']).default('DISPONIVEL'),
  valor_locacao: z.preprocess(value => value === undefined || value === null || value === '' ? undefined : Number(value), z.number().finite().positive().optional()),
  valor_diaria: z.preprocess(value => value === undefined || value === null || value === '' ? undefined : Number(value), z.number().finite().positive().optional()),
  valor_reposicao: z.preprocess(value => value === undefined || value === null || value === '' ? undefined : Number(value), z.number().finite().nonnegative().optional()),
  data_aquisicao: z.string().optional().nullable(),
  localizacao: z.string().optional().nullable(),
});

type EquipamentoInput = z.infer<typeof equipamentoInputSchema> & {
  patrimonio: string;
  valor_locacao: number;
};

export function normalizeEquipamentoInput(body: unknown, requireRequiredFields = true): EquipamentoInput {
  const parsed = equipamentoInputSchema.parse(body);
  const patrimonio = parsed.patrimonio ?? parsed.numero_patrimonio;
  const valor_locacao = parsed.valor_locacao ?? parsed.valor_diaria;
  if (requireRequiredFields && !patrimonio) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Campo "patrimonio" é obrigatório.');
  }
  if (requireRequiredFields && (valor_locacao === undefined || valor_locacao <= 0)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Campo "valor_locacao" deve ser um número positivo.');
  }
  if (!requireRequiredFields && valor_locacao !== undefined && valor_locacao <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Campo "valor_locacao" deve ser um número positivo.');
  }
  const dbStatus = parsed.status === 'ALUGADO' ? 'LOCADO' : parsed.status;
  return {
    ...parsed,
    status: dbStatus,
    patrimonio: patrimonio ?? '',
    valor_locacao: valor_locacao ?? 0,
  };
}

export async function equipamentosRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN', 'OPERADOR']);
  });

  // ==========================================
  // DASHBOARD DE EQUIPAMENTOS
  // ==========================================
  app.get('/locacao/equipamentos/dashboard', async req => {
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        SELECT 
          COUNT(*) as total_equipamentos,
          COUNT(CASE WHEN status = 'DISPONIVEL' THEN 1 END) as disponiveis,
          COUNT(CASE WHEN status = 'MANUTENCAO' THEN 1 END) as em_manutencao,
          COUNT(CASE WHEN status IN ('LOCADO', 'ALUGADO') THEN 1 END) as em_uso
        FROM equipamentos
        WHERE deleted_at IS NULL
      `)
    );
    return { success: true, data: rows[0] || { total_equipamentos: 0, disponiveis: 0, em_manutencao: 0, em_uso: 0 }, error: null };
  });

  async function resolveDbEquipmentStatus(tx: { execute: Database['execute'] }, status: string): Promise<string> {
    if (status !== 'LOCADO' && status !== 'ALUGADO') return status;
    const [statusRule] = await tx.execute(sql`
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.equipamentos'::regclass
            AND conname = 'equipamentos_status_check'
            AND pg_get_constraintdef(oid) LIKE '%ALUGADO%'
            AND pg_get_constraintdef(oid) NOT LIKE '%LOCADO%'
        ) THEN 'ALUGADO'
        ELSE 'LOCADO'
      END AS rented_status
    `);
    return String(statusRule?.rented_status || 'ALUGADO');
  }

  // ==========================================
  // EQUIPAMENTOS (CRUD)
  // ==========================================
  app.get('/locacao/equipamentos', async req => {
    const { status } = z.object({
      status: z.enum(EQUIPMENT_STATUS_VALUES).optional(),
    }).parse(req.query);
    const isRentedFilter = status === 'LOCADO' || status === 'ALUGADO';
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        SELECT e.*, e.numero_patrimonio as patrimonio, e.valor_diaria as valor_locacao,
          CASE WHEN e.status = 'ALUGADO' THEN 'LOCADO' ELSE e.status END as status
        FROM equipamentos e
        WHERE deleted_at IS NULL
          AND (
            ${status ?? null}::text IS NULL
            OR (${isRentedFilter} AND e.status IN ('LOCADO', 'ALUGADO'))
            OR (NOT ${isRentedFilter} AND e.status = ${status ?? null})
          )
        ORDER BY nome ASC
      `)
    );
    return { success: true, data: rows, error: null };
  });

  app.post('/locacao/equipamentos', async (req, reply) => {
    const body = normalizeEquipamentoInput(req.body);

    const rows = await withTenant(db, req.user.current_tenant_id, async tx => {
      const dbStatus = await resolveDbEquipmentStatus(tx, body.status);
      return tx.execute(sql`
        INSERT INTO equipamentos (
          tenant_id, nome, modelo, numero_serie, numero_patrimonio, categoria,
          criticidade, status, valor_diaria, valor_reposicao, data_aquisicao, localizacao
        )
        VALUES (
          ${req.user.current_tenant_id}::uuid, ${body.nome}, ${body.modelo ?? null}, 
          ${body.numero_serie ?? null}, ${body.patrimonio}, ${body.categoria},
          ${body.criticidade}, ${dbStatus}, ${body.valor_locacao}, ${body.valor_reposicao ?? 0},
          ${body.data_aquisicao ? sql`${body.data_aquisicao}::date` : null}, ${body.localizacao ?? null}
        )
        RETURNING *, numero_patrimonio as patrimonio, valor_diaria as valor_locacao,
          CASE WHEN status = 'ALUGADO' THEN 'LOCADO' ELSE status END as status
      `);
    });
    return reply.code(201).send({ success: true, data: rows[0], error: null });
  });

  app.put('/locacao/equipamentos/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const rawBody = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const body = normalizeEquipamentoInput({ nome: 'Atualização', ...rawBody }, false);
    const has = (field: string) => Object.prototype.hasOwnProperty.call(rawBody, field);
    const hasPatrimonio = has('patrimonio') || has('numero_patrimonio');
    const hasValorLocacao = has('valor_locacao') || has('valor_diaria');

    const rows = await withTenant(db, req.user.current_tenant_id, async tx => {
      const dbStatus = has('status') ? await resolveDbEquipmentStatus(tx, body.status) : body.status;
      return tx.execute(sql`
        UPDATE equipamentos SET 
          nome = COALESCE(${has('nome') ? body.nome : null}, nome),
          modelo = CASE WHEN ${has('modelo')} THEN ${body.modelo ?? null} ELSE modelo END,
          numero_serie = CASE WHEN ${has('numero_serie')} THEN ${body.numero_serie ?? null} ELSE numero_serie END,
          numero_patrimonio = CASE WHEN ${hasPatrimonio} THEN ${body.patrimonio} ELSE numero_patrimonio END,
          categoria = CASE WHEN ${has('categoria')} THEN ${body.categoria} ELSE categoria END,
          criticidade = CASE WHEN ${has('criticidade')} THEN ${body.criticidade} ELSE criticidade END,
          status = CASE WHEN ${has('status')} THEN ${dbStatus} ELSE status END,
          valor_diaria = CASE WHEN ${hasValorLocacao} THEN ${body.valor_locacao} ELSE valor_diaria END,
          data_aquisicao = CASE WHEN ${has('data_aquisicao')} THEN ${body.data_aquisicao ? sql`${body.data_aquisicao}::date` : null} ELSE data_aquisicao END,
          localizacao = CASE WHEN ${has('localizacao')} THEN ${body.localizacao ?? null} ELSE localizacao END
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING *, numero_patrimonio as patrimonio, valor_diaria as valor_locacao,
          CASE WHEN status = 'ALUGADO' THEN 'LOCADO' ELSE status END as status
      `);
    });
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Equipamento não encontrado.');
    return { success: true, data: rows[0], error: null };
  });

  app.delete('/locacao/equipamentos/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`UPDATE equipamentos SET deleted_at = NOW() WHERE id = ${id} RETURNING id`)
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Equipamento nÃ£o encontrado.');
    return { success: true, data: null, error: null };
  });

  // ==========================================
  // MANUTENÇÕES (ORDENS DE SERVIÇO)
  // ==========================================
  app.get('/locacao/manutencoes', async req => {
    const queryObj = req.query as Record<string, any>;
    const filters = z.object({
      status: z.enum(['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA']).optional(),
      tipo: z.enum(['PREVENTIVA', 'CORRETIVA', 'CALIBRACAO']).optional(),
      tecnico: z.string().trim().min(1).max(120).optional(),
      equipamento_id: z.string().uuid().optional(),
      data_inicio: z.string().optional(),
      data_fim: z.string().optional(),
      search: z.string().optional(),
      page: z.any().optional(),
      limit: z.any().optional(),
    }).parse(queryObj);
    const rows = await withTenant(db, req.user.current_tenant_id, tx => {
      const where = [sql`m.deleted_at IS NULL`];
      if (filters.status && filters.status !== 'CANCELADA') where.push(sql`m.status = ${filters.status}`);
      if (filters.tipo) where.push(sql`m.tipo_manutencao = ${filters.tipo}`);
      if (filters.tecnico) where.push(sql`m.tecnico_responsavel ILIKE ${`%${filters.tecnico}%`}`);
      if (filters.equipamento_id) where.push(sql`m.equipamento_id = ${filters.equipamento_id}::uuid`);
      if (filters.search) where.push(sql`(m.descricao ILIKE ${`%${filters.search}%`} OR e.nome ILIKE ${`%${filters.search}%`} OR e.patrimonio ILIKE ${`%${filters.search}%`})`);
      return tx.execute(sql`
        SELECT m.*, m.descricao as descricao_problema, e.nome as equipamento_nome, coalesce(e.patrimonio, e.numero_patrimonio) as equipamento_patrimonio
        FROM ordens_manutencao m
        JOIN equipamentos e ON e.id = m.equipamento_id
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY m.id DESC
      `);
    });

    if (queryObj.page !== undefined) {
      return { success: true, data: { data: rows, meta: { page: Number(queryObj.page) || 1, limit: Number(queryObj.limit) || 50, total: rows.length, totalPages: 1 } }, error: null };
    }
    return { success: true, data: rows, error: null };
  });

  app.get('/locacao/manutencoes/dashboard', async req => {
    const [data] = await withTenant(db, req.user.current_tenant_id, tx => tx.execute(sql`
      SELECT
        count(*)::int AS total_os,
        count(*) FILTER (WHERE status IN ('ABERTA','EM_ANDAMENTO'))::int AS abertas,
        count(*) FILTER (WHERE status = 'CONCLUIDA')::int AS concluidas,
        0 AS mttr_horas
      FROM ordens_manutencao WHERE deleted_at IS NULL
    `));
    return { success: true, data: data || { total_os: 0, abertas: 0, concluidas: 0, mttr_horas: 0 }, error: null };
  });

  app.post('/locacao/manutencoes', async req => {
    const body = z.object({
      equipamento_id: z.string().uuid(),
      tipo_manutencao: z.enum(['PREVENTIVA', 'CORRETIVA', 'CALIBRACAO']).default('CORRETIVA'),
      descricao_problema: z.string().min(1),
      tecnico_responsavel: z.string().optional().nullable(),
      status: z.enum(['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA']).default('ABERTA')
    }).parse(req.body);

    const rows = await withTenant(db, req.user.current_tenant_id, async tx => {
      // Serialize OS openings for this asset and reject stale or duplicate requests.
      const [equipment] = await tx.execute(sql`
        SELECT id, status
        FROM equipamentos
        WHERE id = ${body.equipamento_id}::uuid
        FOR UPDATE
      `);
      if (!equipment) throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipamento não encontrado nesta empresa.');
      if (equipment.status === 'INATIVO') {
        throw new HttpError(409, 'EQUIPMENT_INACTIVE', 'Não é possível abrir uma ordem de serviço para um equipamento inativo.');
      }

      const [activeOrder] = await tx.execute(sql`
        SELECT id
        FROM ordens_manutencao
        WHERE equipamento_id = ${body.equipamento_id}::uuid
          AND deleted_at IS NULL
          AND status IN ('ABERTA', 'EM_ANDAMENTO')
        LIMIT 1
      `);
      if (activeOrder) {
        throw new HttpError(409, 'ACTIVE_MAINTENANCE_EXISTS', 'Este equipamento já possui uma ordem de serviço em aberto. Atualize a lista de OS.');
      }

      const legacyTipo = body.tipo_manutencao === 'CALIBRACAO' ? 'CORRETIVA' : body.tipo_manutencao;
      const osRows = await tx.execute(sql`
        INSERT INTO ordens_manutencao (
          tenant_id, equipamento_id, tipo, descricao, tipo_manutencao, tecnico_responsavel, status
        ) VALUES (
          ${req.user.current_tenant_id}::uuid, ${body.equipamento_id}, ${legacyTipo}, ${body.descricao_problema}, ${body.tipo_manutencao},
          ${body.tecnico_responsavel ?? null}, ${body.status}
        ) RETURNING *, descricao as descricao_problema
      `);
      // Coloca equipamento em manutenção se a OS for aberta e não for só agendamento longo
      if (body.status === 'ABERTA' || body.status === 'EM_ANDAMENTO') {
        await tx.execute(sql`UPDATE equipamentos SET status = 'MANUTENCAO' WHERE id = ${body.equipamento_id}`);
      }
      return osRows;
    });

    return { success: true, data: rows[0], error: null };
  });

  app.put('/locacao/manutencoes/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({
      tipo_manutencao: z.enum(['PREVENTIVA', 'CORRETIVA', 'CALIBRACAO']).optional(),
      descricao_problema: z.string().trim().min(1).optional(),
      tecnico_responsavel: z.string().trim().min(1).max(120).nullable().optional(),
      status: z.enum(['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA']).optional(),
    }).refine(value => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.').parse(req.body);
    const legacyTipo = body.tipo_manutencao === undefined
      ? null
      : body.tipo_manutencao === 'CALIBRACAO' ? 'CORRETIVA' : body.tipo_manutencao;

    const row = await withTenant(db, req.user.current_tenant_id, async tx => {
      const rows = await tx.execute(sql`
        UPDATE ordens_manutencao SET
          tipo = COALESCE(${legacyTipo}, tipo),
          tipo_manutencao = COALESCE(${body.tipo_manutencao ?? null}, tipo_manutencao),
          descricao = COALESCE(${body.descricao_problema ?? null}, descricao),
          tecnico_responsavel = CASE WHEN ${body.tecnico_responsavel === undefined} THEN tecnico_responsavel ELSE ${body.tecnico_responsavel ?? null} END,
          status = COALESCE(${body.status ?? null}, status)
        WHERE id = ${id}::uuid AND tenant_id = ${req.user.current_tenant_id}::uuid AND deleted_at IS NULL
        RETURNING *, descricao as descricao_problema
      `);
      if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Ordem de serviço não encontrada.');
      if (body.status === 'CONCLUIDA') {
        const active = await tx.execute(sql`
          SELECT 1 FROM ordens_manutencao
          WHERE equipamento_id = ${rows[0].equipamento_id}::uuid
            AND id != ${id}::uuid
            AND deleted_at IS NULL
            AND status IN ('ABERTA', 'EM_ANDAMENTO')
          LIMIT 1
        `);
        if (!active.length) {
          await tx.execute(sql`
            UPDATE equipamentos
            SET status = 'DISPONIVEL'
            WHERE id = ${rows[0].equipamento_id}::uuid AND status = 'MANUTENCAO'
          `);
        }
      } else if (body.status === 'ABERTA' || body.status === 'EM_ANDAMENTO') {
        await tx.execute(sql`
          UPDATE equipamentos
          SET status = 'MANUTENCAO'
          WHERE id = ${rows[0].equipamento_id}::uuid AND status = 'DISPONIVEL'
        `);
      }
      return rows[0];
    });
    return { success: true, data: row, error: null };
  });

}

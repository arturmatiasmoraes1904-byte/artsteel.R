import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';

export async function contratosRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN', 'OPERADOR']);
  });

  app.get('/locacao/contratos/dashboard', async req => {
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        SELECT 
          COUNT(*) as total_contratos,
          COUNT(CASE WHEN status = 'ATIVO' THEN 1 END) as contratos_ativos,
          SUM(CASE WHEN status = 'ATIVO' THEN valor_total ELSE 0 END) as receita_recorrente,
          COUNT(CASE WHEN data_fim_prevista < CURRENT_DATE AND status = 'ATIVO' THEN 1 END) as vencidos
        FROM contratos_locacao
        WHERE deleted_at IS NULL
      `)
    );
    const data = rows[0] || { total_contratos: 0, contratos_ativos: 0, receita_recorrente: 0, vencidos: 0 };
    return { success: true, data, error: null };
  });

  app.get('/locacao/contratos', async req => {
    const {cliente_id}=z.object({cliente_id:z.string().uuid().optional()}).parse(req.query);
    const rows = await withTenant(db, req.user.current_tenant_id, tx => 
      tx.execute(sql`
        SELECT c.*, cl.nome as cliente_nome, cl.documento as cliente_documento,
          COALESCE(
            (
              SELECT json_agg(json_build_object(
                'id', eq.id,
                'nome', eq.nome,
                'patrimonio', eq.numero_patrimonio,
                'valor_unitario', ic.valor_unitario
              ))
              FROM itens_contrato ic
              JOIN equipamentos eq ON eq.id = ic.equipamento_id
              WHERE ic.contrato_id = c.id
            ),
            '[]'::json
          ) as itens
        FROM contratos_locacao c
        JOIN clientes cl ON cl.id = c.cliente_id
        WHERE c.deleted_at IS NULL ${cliente_id ? sql`AND c.cliente_id = ${cliente_id}::uuid` : sql``}
        ORDER BY c.data_inicio DESC
      `)
    );
    return { success: true, data: rows, error: null };
  });

  app.post('/locacao/contratos', async req => {
    const body = z.object({
      cliente_id: z.string().uuid(),
      data_inicio: z.iso.date(),
      data_fim: z.iso.date().optional(),
      data_fim_prevista: z.iso.date().optional(),
      valor_total: z.number().finite().min(0).optional(),
      condicao_pagamento: z.string().trim().max(500).optional(),
      equipamento_ids: z.array(z.string().uuid()).optional(),
      periodicidade: z.enum(['MENSAL', 'SEMANAL', 'DIARIO', 'ANUAL']).default('MENSAL'),
      dia_vencimento: z.number().int().min(1).max(31).default(5),
      indice_reajuste: z.string().default('IGP-M'),
      observacoes: z.string().max(5000).optional().nullable(),
      status: z.enum(['RASCUNHO', 'ATIVO', 'ENCERRADO', 'CANCELADO']).default('ATIVO'),
      equipamentos: z.array(z.object({
        equipamento_id: z.string().uuid(),
        valor_unitario: z.number().finite().min(0),
        quantidade: z.number().int().min(1).default(1)
      })).optional()
    }).superRefine((value, context) => {
      const endDate = value.data_fim_prevista ?? value.data_fim;
      if (!endDate) {
        context.addIssue({ code: 'custom', path: ['data_fim_prevista'], message: 'Informe a data de fim do contrato.' });
      } else if (endDate <= value.data_inicio) {
        context.addIssue({ code: 'custom', path: ['data_fim_prevista'], message: 'A data de fim deve ser posterior à data de início.' });
      }
      const equipmentIds = value.equipamento_ids ?? value.equipamentos?.map(item => item.equipamento_id) ?? [];
      if (new Set(equipmentIds).size !== equipmentIds.length) {
        context.addIssue({ code: 'custom', path: ['equipamento_ids'], message: 'Não é permitido selecionar o mesmo equipamento mais de uma vez.' });
      }
    }).parse(req.body);
    const dataFim = body.data_fim_prevista ?? body.data_fim!;
    const equipamentoIds = body.equipamento_ids ?? body.equipamentos?.map(item => item.equipamento_id) ?? [];
    if (equipamentoIds.length === 0) {
      throw new HttpError(400, 'EQUIPMENT_REQUIRED', 'Selecione pelo menos um equipamento para o contrato.');
    }

    const result = await withTenant(db, req.user.current_tenant_id, async tx => {
      const [cliente] = await tx.execute(sql`SELECT id, nome FROM clientes WHERE id = ${body.cliente_id}::uuid AND status <> 'INATIVO'`);
      if (!cliente) throw new HttpError(400, 'INVALID_CUSTOMER', 'Selecione um cliente ativo desta empresa.');

      // Lock the rows before checking availability so concurrent signatures cannot rent the same asset.
      const equipment = await tx.execute(sql`
        SELECT id, valor_diaria, status FROM equipamentos
        WHERE id IN (${sql.join(equipamentoIds.map(id => sql`${id}::uuid`), sql`,`)})
        ORDER BY id
        FOR UPDATE
      `);
      if (equipment.length !== equipamentoIds.length) {
        throw new HttpError(409, 'EQUIPMENT_UNAVAILABLE', 'Um dos equipamentos não está disponível nesta empresa.');
      }
      if (equipment.some(item => item.status !== 'DISPONIVEL')) {
        throw new HttpError(409, 'EQUIPMENT_UNAVAILABLE', 'Um dos equipamentos selecionados não está disponível. Atualize a lista e tente novamente.');
      }

      const days = Math.max(1, Math.floor((Date.parse(`${dataFim}T00:00:00Z`) - Date.parse(`${body.data_inicio}T00:00:00Z`)) / 86400000));
      const total = body.valor_total ?? equipment.reduce((sum, item) => sum + Number(item.valor_diaria) * days, 0);
      const [contrato] = await tx.execute(sql`
        INSERT INTO contratos_locacao (
          tenant_id, cliente_id, data_inicio, data_fim_prevista, valor_total,
          condicao_pagamento, periodicidade, dia_vencimento, indice_reajuste, observacoes, status
        ) VALUES (
          ${req.user.current_tenant_id}::uuid, ${body.cliente_id}::uuid, ${body.data_inicio}::date,
          ${dataFim}::date, ${total}, ${body.condicao_pagamento?.trim() || 'A definir'},
          ${body.periodicidade}, ${body.dia_vencimento}, ${body.indice_reajuste}, ${body.observacoes ?? null}, ${body.status}
        ) RETURNING *
      `);
      if (!contrato) throw new Error('Não foi possível criar o registro do contrato.');

      for (const item of equipment) {
        await tx.execute(sql`
          INSERT INTO itens_contrato (tenant_id, contrato_id, equipamento_id, valor_unitario, quantidade)
          VALUES (${req.user.current_tenant_id}::uuid, ${contrato.id}::uuid, ${item.id}::uuid, ${item.valor_diaria}, 1)
        `);
      }

      if (body.status === 'ATIVO') {
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
        const rentedStatus = String(statusRule?.rented_status || 'ALUGADO');
        const updated = await tx.execute(sql`
          UPDATE equipamentos SET status = ${rentedStatus}
          WHERE id IN (${sql.join(equipamentoIds.map(id => sql`${id}::uuid`), sql`,`)}) AND status = 'DISPONIVEL'
          RETURNING id
        `);
        if (updated.length !== equipamentoIds.length) {
          throw new HttpError(409, 'EQUIPMENT_UNAVAILABLE', 'Um dos equipamentos acabou de ser reservado. Atualize a lista e tente novamente.');
        }

        if (total > 0) {
          const startDate = new Date(`${body.data_inicio}T00:00:00Z`);
          const dueYear = startDate.getUTCFullYear();
          const dueMonth = startDate.getUTCMonth() + (body.dia_vencimento < startDate.getUTCDate() ? 1 : 0);
          const targetMonth = new Date(Date.UTC(dueYear, dueMonth, 1));
          const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
          const dueDate = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(body.dia_vencimento, lastDay))).toISOString().slice(0, 10);
          const anexos = JSON.stringify({
            contrato_id: contrato.id,
            tipo_origem: 'CONTRATO_LOCACAO',
            periodicidade: body.periodicidade,
            dia_vencimento: body.dia_vencimento
          });

          await tx.execute(sql`
            INSERT INTO transacoes_financeiras (
              tenant_id, tipo, descricao, valor, data_competencia, data_vencimento,
              status, categoria, conta_bancaria, cliente_id, anexos
            ) VALUES (
              ${req.user.current_tenant_id}::uuid, 'RECEITA',
              ${`Locação: Contrato #${String(contrato.id).slice(0, 8)} - ${cliente.nome}`},
              ${total}, ${body.data_inicio}::date, ${dueDate}::date, 'PENDENTE',
              'Locação', 'Conta Principal', ${body.cliente_id}::uuid, ${anexos}::jsonb
            )
          `);
        }
      }

      return contrato;
    });

    return { success: true, data: result, error: null };
  });

  app.put('/locacao/contratos/:id/encerrar', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const rows = await withTenant(db, req.user.current_tenant_id, async tx => {
      const updated = await tx.execute(sql`
        UPDATE contratos_locacao
        SET status = 'ENCERRADO'
        WHERE tenant_id = ${req.user.current_tenant_id}::uuid
          AND id = ${id}::uuid
          AND deleted_at IS NULL
          AND status = 'ATIVO'
        RETURNING *
      `);

      if (updated.length > 0) {
        await tx.execute(sql`
          UPDATE equipamentos
          SET status = 'DISPONIVEL'
          WHERE tenant_id = ${req.user.current_tenant_id}::uuid
            AND status IN ('LOCADO', 'ALUGADO')
            AND id IN (
              SELECT equipamento_id
              FROM itens_contrato
              WHERE tenant_id = ${req.user.current_tenant_id}::uuid
                AND contrato_id = ${id}::uuid
            )
        `);
      }
      return updated;
    });

    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Contrato ativo não encontrado. Atualize a lista e tente novamente.');
    return { success: true, data: rows[0], error: null };
  });

  app.delete('/locacao/contratos/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const rows = await withTenant(db, req.user.current_tenant_id, async tx => {
      const deleted = await tx.execute(sql`
        UPDATE contratos_locacao
        SET deleted_at = now(), status = 'CANCELADO'
        WHERE tenant_id = ${req.user.current_tenant_id}::uuid
          AND id = ${id}::uuid
          AND deleted_at IS NULL
        RETURNING *
      `);
      if (deleted.length > 0) {
        await tx.execute(sql`
          UPDATE equipamentos
          SET status = 'DISPONIVEL'
          WHERE tenant_id = ${req.user.current_tenant_id}::uuid
            AND status IN ('LOCADO', 'ALUGADO')
            AND id IN (
              SELECT equipamento_id
              FROM itens_contrato
              WHERE tenant_id = ${req.user.current_tenant_id}::uuid
                AND contrato_id = ${id}::uuid
            )
        `);
        await tx.execute(sql`
          UPDATE transacoes_financeiras
          SET deleted_at = now(), status = 'CANCELADO'
          WHERE tenant_id = ${req.user.current_tenant_id}::uuid
            AND status = 'PENDENTE'
            AND deleted_at IS NULL
            AND anexos->>'contrato_id' = ${id}
        `);
      }
      return deleted;
    });
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Contrato não encontrado.');
    return { success: true, data: rows[0], error: null };
  });

}

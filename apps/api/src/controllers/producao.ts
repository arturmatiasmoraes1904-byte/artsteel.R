import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '../db/client.js';
import { auth, HttpError, requireRole } from '../middlewares/auth.js';
import { pageQuery, pageResult, safeSort } from '../lib/pagination.js';

type ChecklistItem = {
  id: string;
  descricao: string;
  concluido: boolean;
  concluido_em?: string | null;
  ordem: number;
};

function parseCustomData(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return { ...(raw as Record<string, any>) };
  return {};
}

function enrichCard(row: Record<string, any>) {
  const custom = parseCustomData(row.dados_customizados);
  return {
    ...row,
    dados_customizados: custom,
    prazo_etapa: row.prazo_etapa ?? custom.prazo_etapa ?? null,
  };
}

export async function producaoRoutes(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', auth(db));
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET') await requireRole(db, req, ['ADMIN', 'OPERADOR']);
  });

  // ============================
  // WORKFLOWS
  // ============================
  app.get('/producao/workflows', async req => {
    const page = pageQuery(req.query);
    const tenantId = req.user.current_tenant_id;

    let rows: Record<string, any>[] = await withTenant(db, tenantId, tx =>
      tx.execute(sql`
        SELECT * FROM workflows
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `)
    );

    // Se a empresa ainda não tiver nenhum workflow, cria um fluxo padrão automaticamente
    if (rows.length === 0 && page.page === 1) {
      await withTenant(db, tenantId, async tx => {
        const [wf] = await tx.execute(sql`
          INSERT INTO workflows (tenant_id, nome, descricao)
          VALUES (${tenantId}::uuid, 'Produção Serralheria Padrão', 'Fluxo principal de fabricação, solda, acabamento e entrega')
          RETURNING *
        `);
        const defaultStages = [
          { nome: 'Corte & Preparação', cor: '#ef4444' },
          { nome: 'Solda & Montagem', cor: '#eab308' },
          { nome: 'Acabamento & Pintura', cor: '#3b82f6' },
          { nome: 'Concluído', cor: '#22c55e' },
        ];
        for (let i = 0; i < defaultStages.length; i++) {
          await tx.execute(sql`
            INSERT INTO workflow_stages (tenant_id, workflow_id, nome, cor, ordem, exige_motivo_retorno)
            VALUES (${tenantId}::uuid, ${wf.id}::uuid, ${defaultStages[i].nome}, ${defaultStages[i].cor}, ${i}, false)
          `);
        }
        rows = [wf];
      });
    }

    const total = await withTenant(db, tenantId, async tx =>
      Number((await tx.execute(sql`SELECT count(*)::int total FROM workflows WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`))[0]?.total ?? 0)
    );

    const workflows = await Promise.all(
      rows.map(async w => {
        const stages = await withTenant(db, tenantId, tx =>
          tx.execute(sql`
            SELECT * FROM workflow_stages
            WHERE workflow_id = ${w.id}::uuid AND deleted_at IS NULL
            ORDER BY ordem ASC
          `)
        );
        return { ...w, stages };
      })
    );

    return { success: true, data: pageResult(workflows, page.page, page.limit, total), error: null };
  });

  app.post('/producao/workflows', async req => {
    const body = z.object({
      nome: z.string().min(1),
      descricao: z.string().optional().nullable(),
      stages: z.array(z.object({
        nome: z.string().min(1),
        cor: z.string().default('#6b7280'),
        sla_horas: z.number().optional().nullable(),
        exige_motivo_retorno: z.boolean().default(false)
      })).min(1)
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const result = await withTenant(db, tenantId, async tx => {
      const [workflow] = await tx.execute(sql`
        INSERT INTO workflows (tenant_id, nome, descricao)
        VALUES (${tenantId}::uuid, ${body.nome}, ${body.descricao ?? null})
        RETURNING *
      `);

      const stages = [];
      for (let i = 0; i < body.stages.length; i++) {
        const stage = body.stages[i];
        const [insertedStage] = await tx.execute(sql`
          INSERT INTO workflow_stages (tenant_id, workflow_id, nome, cor, ordem, sla_horas, exige_motivo_retorno)
          VALUES (${tenantId}::uuid, ${workflow.id}::uuid, ${stage.nome}, ${stage.cor}, ${i}, ${stage.sla_horas ?? null}, ${stage.exige_motivo_retorno})
          RETURNING *
        `);
        stages.push(insertedStage);
      }
      return { ...workflow, stages };
    });

    return { success: true, data: result, error: null };
  });

  app.delete('/producao/workflows/:workflowId', async req => {
    const workflowId = z.string().uuid().parse((req.params as { workflowId: string }).workflowId);
    const tenantId = req.user.current_tenant_id;
    await withTenant(db, tenantId, async tx => {
      const [workflow] = await tx.execute(sql`
        SELECT id FROM workflows
        WHERE id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      if (!workflow) throw new HttpError(404, 'NOT_FOUND', 'Processo não encontrado.');
      const [cards] = await tx.execute(sql`
        SELECT count(*)::int AS total FROM producao_cards
        WHERE workflow_id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      `);
      if (Number(cards?.total ?? 0) > 0) {
        throw new HttpError(409, 'PROCESS_HAS_CARDS', 'Arquive os processos ativos deste fluxo antes de excluí-lo.');
      }
      await tx.execute(sql`UPDATE workflows SET deleted_at = now() WHERE id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid`);
      await tx.execute(sql`UPDATE workflow_stages SET deleted_at = now() WHERE workflow_id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`);
    });
    return { success: true, data: { id: workflowId }, error: null };
  });

  app.post('/producao/workflows/:workflowId/stages', async req => {
    const workflowId = z.string().uuid().parse((req.params as { workflowId: string }).workflowId);
    const body = z.object({
      nome: z.string().trim().min(1, 'Informe o nome da etapa'),
      cor: z.string().default('#3b82f6'),
      sla_horas: z.number().optional().nullable(),
      exige_motivo_retorno: z.boolean().default(false)
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const stage = await withTenant(db, tenantId, async tx => {
      const [wf] = await tx.execute(sql`SELECT id FROM workflows WHERE id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`);
      if (!wf) throw new HttpError(404, 'NOT_FOUND', 'Workflow não encontrado.');
      const [maxRow] = await tx.execute(sql`SELECT coalesce(max(ordem), -1)::int as max_ordem FROM workflow_stages WHERE workflow_id = ${workflowId}::uuid AND deleted_at IS NULL`);
      const nextOrdem = Number(maxRow?.max_ordem ?? -1) + 1;
      const [inserted] = await tx.execute(sql`
        INSERT INTO workflow_stages (tenant_id, workflow_id, nome, cor, ordem, sla_horas, exige_motivo_retorno)
        VALUES (${tenantId}::uuid, ${workflowId}::uuid, ${body.nome}, ${body.cor}, ${nextOrdem}, ${body.sla_horas ?? null}, ${body.exige_motivo_retorno})
        RETURNING *
      `);
      return inserted;
    });

    return { success: true, data: stage, error: null };
  });

  app.put('/producao/workflows/:workflowId/stages/:stageId', async req => {
    const { workflowId, stageId } = z.object({ workflowId: z.string().uuid(), stageId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      nome: z.string().trim().min(1).max(120).optional(),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      sla_horas: z.number().int().positive().nullable().optional(),
      exige_motivo_retorno: z.boolean().optional(),
    }).refine(value => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.').parse(req.body);
    const tenantId = req.user.current_tenant_id;
    const stage = await withTenant(db, tenantId, async tx => {
      const [updated] = await tx.execute(sql`
        UPDATE workflow_stages SET
          nome = coalesce(${body.nome ?? null}, nome),
          cor = coalesce(${body.cor ?? null}, cor),
          sla_horas = CASE WHEN ${body.sla_horas !== undefined} THEN ${body.sla_horas ?? null} ELSE sla_horas END,
          exige_motivo_retorno = coalesce(${body.exige_motivo_retorno ?? null}, exige_motivo_retorno)
        WHERE id = ${stageId}::uuid AND workflow_id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING *
      `);
      if (!updated) throw new HttpError(404, 'NOT_FOUND', 'Etapa não encontrada neste processo.');
      return updated;
    });
    return { success: true, data: stage, error: null };
  });

  app.delete('/producao/workflows/:workflowId/stages/:stageId', async req => {
    const { workflowId, stageId } = z.object({ workflowId: z.string().uuid(), stageId: z.string().uuid() }).parse(req.params);
    const tenantId = req.user.current_tenant_id;
    await withTenant(db, tenantId, async tx => {
      const [stage] = await tx.execute(sql`
        SELECT id FROM workflow_stages
        WHERE id = ${stageId}::uuid AND workflow_id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      if (!stage) throw new HttpError(404, 'NOT_FOUND', 'Etapa não encontrada neste processo.');
      const [count] = await tx.execute(sql`SELECT count(*)::int AS total FROM workflow_stages WHERE workflow_id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`);
      if (Number(count?.total ?? 0) <= 1) throw new HttpError(409, 'LAST_STAGE', 'O processo precisa manter ao menos uma etapa.');
      const [cards] = await tx.execute(sql`SELECT count(*)::int AS total FROM producao_cards WHERE stage_id = ${stageId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`);
      if (Number(cards?.total ?? 0) > 0) throw new HttpError(409, 'STAGE_HAS_CARDS', 'Mova ou arquive os processos desta etapa antes de excluí-la.');
      await tx.execute(sql`UPDATE workflow_stages SET deleted_at = now() WHERE id = ${stageId}::uuid AND tenant_id = ${tenantId}::uuid`);
    });
    return { success: true, data: { id: stageId }, error: null };
  });

  app.put('/producao/workflows/:workflowId/stages/order', async req => {
    const workflowId = z.string().uuid().parse((req.params as { workflowId: string }).workflowId);
    const { stage_ids } = z.object({ stage_ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
    if (new Set(stage_ids).size !== stage_ids.length) throw new HttpError(400, 'INVALID_ORDER', 'A lista contém etapas duplicadas.');
    const tenantId = req.user.current_tenant_id;
    await withTenant(db, tenantId, async tx => {
      const stages = await tx.execute(sql`SELECT id FROM workflow_stages WHERE workflow_id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`);
      if (stages.length !== stage_ids.length || stages.some(stage => !stage_ids.includes(String(stage.id)))) {
        throw new HttpError(400, 'INVALID_ORDER', 'A lista deve conter todas as etapas ativas deste processo.');
      }
      for (const [ordem, stageId] of stage_ids.entries()) {
        await tx.execute(sql`UPDATE workflow_stages SET ordem = ${ordem} WHERE id = ${stageId}::uuid AND workflow_id = ${workflowId}::uuid AND tenant_id = ${tenantId}::uuid`);
      }
    });
    return { success: true, data: { stage_ids }, error: null };
  });

  app.get('/producao/dashboard', async req => {
    const { workflow_id } = z.object({ workflow_id: z.string().uuid().optional() }).parse(req.query);
    const tenantId = req.user.current_tenant_id;

    const data = await withTenant(db, tenantId, async tx => {
      const scope = workflow_id ? sql`AND c.workflow_id = ${workflow_id}::uuid` : sql``;
      const [summary] = await tx.execute(sql`
        WITH final_stages AS (
          SELECT workflow_id, max(ordem) final_ordem
          FROM workflow_stages
          WHERE deleted_at IS NULL
          GROUP BY workflow_id
        )
        SELECT
          count(*) FILTER (WHERE s.ordem < fs.final_ordem)::int AS em_andamento,
          coalesce(round(avg(extract(epoch FROM (now() - c.created_at)) / 86400) FILTER (WHERE s.ordem < fs.final_ordem), 1), 0) AS tempo_medio_dias,
          count(*) FILTER (
            WHERE s.ordem < fs.final_ordem
              AND (
                (c.data_entrega IS NOT NULL AND c.data_entrega < current_date)
                OR (
                  c.dados_customizados->>'prazo_etapa' IS NOT NULL
                  AND (c.dados_customizados->>'prazo_etapa')::timestamptz < now()
                )
              )
          )::int AS atrasados
        FROM producao_cards c
        JOIN workflow_stages s ON s.id = c.stage_id
        JOIN final_stages fs ON fs.workflow_id = c.workflow_id
        WHERE c.tenant_id = ${tenantId}::uuid AND c.deleted_at IS NULL ${scope}
      `);

      const [bottleneck] = await tx.execute(sql`
        SELECT s.nome, count(*)::int total
        FROM producao_cards c
        JOIN workflow_stages s ON s.id = c.stage_id
        WHERE c.tenant_id = ${tenantId}::uuid AND c.deleted_at IS NULL ${scope}
        GROUP BY s.id, s.nome, s.ordem
        ORDER BY total DESC, s.ordem ASC
        LIMIT 1
      `);

      return {
        em_andamento: Number(summary?.em_andamento ?? 0),
        tempo_medio_dias: Number(summary?.tempo_medio_dias ?? 0),
        atrasados: Number(summary?.atrasados ?? 0),
        gargalo: bottleneck?.nome ?? 'Sem cards',
        gargalo_total: Number(bottleneck?.total ?? 0),
      };
    });

    return { success: true, data, error: null };
  });

  // ============================
  // CARDS (PROCESSOS)
  // ============================
  app.get('/producao/workflows/:workflowId/cards', async req => {
    const workflowId = z.string().uuid().parse((req.params as { workflowId: string }).workflowId);
    const page = pageQuery(req.query);
    const sort = safeSort(page.sort, { ordem: 'c.ordem', created_at: 'c.created_at', prioridade: 'c.prioridade', data_entrega: 'c.data_entrega' }, 'ordem');
    const tenantId = req.user.current_tenant_id;

    const result = await withTenant(db, tenantId, async tx => {
      const term = page.search ? `%${page.search}%` : null;
      const [count] = await tx.execute(sql`
        SELECT count(*)::int total
        FROM producao_cards
        WHERE tenant_id = ${tenantId}::uuid
          AND workflow_id = ${workflowId}::uuid
          AND deleted_at IS NULL
          AND (${term}::text IS NULL OR titulo ILIKE ${term})
      `);
      const rows = await tx.execute(sql`
        SELECT c.*, cl.nome as cliente_nome
        FROM producao_cards c
        LEFT JOIN clientes cl ON cl.id = c.cliente_id
        WHERE c.tenant_id = ${tenantId}::uuid
          AND c.workflow_id = ${workflowId}::uuid
          AND c.deleted_at IS NULL
          AND (${term}::text IS NULL OR c.titulo ILIKE ${term})
        ORDER BY ${sql.raw(sort.column)} ${sql.raw(sort.direction)}, c.created_at DESC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `);
      return pageResult(rows.map(enrichCard), page.page, page.limit, Number(count?.total ?? 0));
    });

    return { success: true, data: result, error: null };
  });

  app.post('/producao/cards', async req => {
    const body = z.object({
      workflow_id: z.string().uuid(),
      stage_id: z.string().uuid(),
      titulo: z.string().trim().min(1, 'Informe o título do card'),
      descricao: z.string().optional().nullable(),
      cliente_id: z.preprocess(val => (val === '' ? null : val), z.string().uuid().optional().nullable()),
      prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
      valor: z.preprocess(val => (val === '' || val === undefined || val === null ? 0 : Number(val)), z.number().nonnegative().default(0)),
      data_entrega: z.preprocess(val => (val === '' ? null : val), z.string().optional().nullable()),
      dados_customizados: z.record(z.string(), z.unknown()).optional()
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const [card] = await withTenant(db, tenantId, async tx => {
      const [stage] = await tx.execute(sql`
        SELECT id FROM workflow_stages
        WHERE id = ${body.stage_id}::uuid AND workflow_id = ${body.workflow_id}::uuid AND deleted_at IS NULL
      `);
      if (!stage) throw new HttpError(400, 'INVALID_STAGE', 'A etapa informada não pertence ao workflow selecionado.');

      const customData = body.dados_customizados ?? {};

      return tx.execute(sql`
        INSERT INTO producao_cards (
          tenant_id, workflow_id, stage_id, titulo, descricao, cliente_id, prioridade, valor, data_entrega, dados_customizados
        ) VALUES (
          ${tenantId}::uuid,
          ${body.workflow_id}::uuid,
          ${body.stage_id}::uuid,
          ${body.titulo},
          ${body.descricao ?? null},
          ${body.cliente_id ? sql`${body.cliente_id}::uuid` : null},
          ${body.prioridade},
          ${body.valor ?? 0},
          ${body.data_entrega ? sql`${body.data_entrega}::date` : null},
          ${JSON.stringify(customData)}::jsonb
        ) RETURNING *
      `);
    });

    return { success: true, data: enrichCard(card), error: null };
  });

  app.put('/producao/cards/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({
      titulo: z.string().min(1).max(200).optional(),
      descricao: z.string().max(5000).nullable().optional(),
      prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
      valor: z.number().nonnegative().optional(),
      cliente_id: z.string().uuid().nullable().optional(),
      data_entrega: z.string().nullable().optional(),
      prazo_etapa: z.string().nullable().optional(),
      dados_customizados: z.record(z.string(), z.unknown()).optional()
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const card = await withTenant(db, tenantId, async tx => {
      const [before] = await tx.execute(sql`
        SELECT * FROM producao_cards
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      if (!before) throw new HttpError(404, 'NOT_FOUND', 'Card não encontrado.');

      const currentCustom = parseCustomData(before.dados_customizados);
      const nextCustom: Record<string, any> = {
        ...currentCustom,
        ...(body.dados_customizados ?? {}),
      };
      if (body.prazo_etapa !== undefined) {
        nextCustom.prazo_etapa = body.prazo_etapa;
      }

      const hasCliente = body.cliente_id !== undefined;
      const hasDataEntrega = body.data_entrega !== undefined;

      const [updated] = await tx.execute(sql`
        UPDATE producao_cards
        SET
          titulo = coalesce(${body.titulo ?? null}, titulo),
          descricao = CASE WHEN ${body.descricao !== undefined} THEN ${body.descricao ?? null} ELSE descricao END,
          prioridade = coalesce(${body.prioridade ?? null}, prioridade),
          valor = coalesce(${body.valor ?? null}, valor),
          cliente_id = CASE WHEN ${hasCliente} THEN ${body.cliente_id ? sql`${body.cliente_id}::uuid` : null} ELSE cliente_id END,
          data_entrega = CASE WHEN ${hasDataEntrega} THEN ${body.data_entrega ? sql`${body.data_entrega}::date` : null} ELSE data_entrega END,
          dados_customizados = ${JSON.stringify(nextCustom)}::jsonb
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
        RETURNING *
      `);

      return enrichCard(updated);
    });

    return { success: true, data: card, error: null };
  });

  // ============================
  // CHECKLIST (via dados_customizados.checklist)
  // ============================
  app.get('/producao/cards/:id/checklist', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const tenantId = req.user.current_tenant_id;

    const items = await withTenant(db, tenantId, async tx => {
      const [card] = await tx.execute(sql`
        SELECT dados_customizados FROM producao_cards
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      `);
      if (!card) return [];
      const custom = parseCustomData(card.dados_customizados);
      const list = Array.isArray(custom.checklist) ? (custom.checklist as ChecklistItem[]) : [];
      return list.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    });

    return { success: true, data: items, error: null };
  });

  app.post('/producao/cards/:id/checklist', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const { descricao } = z.object({ descricao: z.string().trim().min(1).max(500) }).parse(req.body);
    const tenantId = req.user.current_tenant_id;

    const item = await withTenant(db, tenantId, async tx => {
      const [card] = await tx.execute(sql`
        SELECT dados_customizados FROM producao_cards
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      if (!card) throw new HttpError(404, 'NOT_FOUND', 'Card não encontrado.');

      const custom = parseCustomData(card.dados_customizados);
      const list: ChecklistItem[] = Array.isArray(custom.checklist) ? [...custom.checklist] : [];
      const maxOrdem = list.reduce((max, it) => Math.max(max, it.ordem ?? 0), -1);
      const newItem: ChecklistItem = {
        id: crypto.randomUUID(),
        descricao,
        concluido: false,
        concluido_em: null,
        ordem: maxOrdem + 1,
      };
      list.push(newItem);
      custom.checklist = list;

      await tx.execute(sql`
        UPDATE producao_cards
        SET dados_customizados = ${JSON.stringify(custom)}::jsonb
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      return newItem;
    });

    return { success: true, data: item, error: null };
  });

  app.put('/producao/cards/:id/checklist/:itemId', async req => {
    const { id, itemId } = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).parse(req.params);
    const { concluido } = z.object({ concluido: z.boolean() }).parse(req.body);
    const tenantId = req.user.current_tenant_id;

    const updatedItem = await withTenant(db, tenantId, async tx => {
      const [card] = await tx.execute(sql`
        SELECT dados_customizados FROM producao_cards
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      if (!card) throw new HttpError(404, 'NOT_FOUND', 'Card não encontrado.');

      const custom = parseCustomData(card.dados_customizados);
      const list: ChecklistItem[] = Array.isArray(custom.checklist) ? [...custom.checklist] : [];
      const idx = list.findIndex(it => it.id === itemId);
      if (idx === -1) throw new HttpError(404, 'NOT_FOUND', 'Item não encontrado.');

      list[idx] = {
        ...list[idx],
        concluido,
        concluido_em: concluido ? new Date().toISOString() : null,
      };
      custom.checklist = list;

      await tx.execute(sql`
        UPDATE producao_cards
        SET dados_customizados = ${JSON.stringify(custom)}::jsonb
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      return list[idx];
    });

    return { success: true, data: updatedItem, error: null };
  });

  // ============================
  // MOVER CARD (KANBAN)
  // ============================
  app.put('/producao/cards/:id/mover', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const body = z.object({
      stage_id: z.string().uuid(),
      ordem: z.number().default(0)
    }).parse(req.body);

    const tenantId = req.user.current_tenant_id;
    const result = await withTenant(db, tenantId, async tx => {
      const [card] = await tx.execute(sql`
        SELECT * FROM producao_cards
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      if (!card) throw new HttpError(404, 'NOT_FOUND', 'Card não encontrado.');

      const [stage] = await tx.execute(sql`
        SELECT id, ordem FROM workflow_stages
        WHERE id = ${body.stage_id}::uuid AND workflow_id = ${card.workflow_id}::uuid AND deleted_at IS NULL
      `);
      if (!stage) throw new HttpError(400, 'INVALID_STAGE', 'A etapa informada não pertence ao fluxo deste card.');

      const [updated] = await tx.execute(sql`
        UPDATE producao_cards
        SET stage_id = ${body.stage_id}::uuid, ordem = ${body.ordem}
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
        RETURNING *
      `);

      const [laterStage] = await tx.execute(sql`
        SELECT id FROM workflow_stages
        WHERE workflow_id = ${card.workflow_id}::uuid AND deleted_at IS NULL AND ordem > ${stage.ordem}
        LIMIT 1
      `);

      let contaId: string | null = null;
      if (!laterStage && Number(card.valor ?? 0) > 0) {
        const existing = await tx.execute(sql`
          SELECT id FROM transacoes_financeiras
          WHERE tenant_id = ${tenantId}::uuid
            AND deleted_at IS NULL
            AND anexos->>'producao_card_id' = ${id}
          LIMIT 1
        `);

        if (existing[0]) {
          contaId = String(existing[0].id);
        } else {
          const anexosObj = {
            producao_card_id: id,
            tipo_origem: 'PRODUCAO_CARD',
            workflow_id: card.workflow_id,
          };
          const [conta] = await tx.execute(sql`
            INSERT INTO transacoes_financeiras (
              tenant_id, tipo, descricao, valor, data_competencia, data_vencimento, status, categoria, conta_bancaria, cliente_id, anexos
            ) VALUES (
              ${tenantId}::uuid,
              'RECEITA',
              ${`Produção concluída: ${card.titulo}`},
              ${Number(card.valor ?? 0)},
              current_date,
              current_date,
              'PENDENTE',
              'Produção',
              'Conta Principal',
              ${card.cliente_id ? sql`${card.cliente_id}::uuid` : null},
              ${JSON.stringify(anexosObj)}::jsonb
            ) RETURNING id
          `);
          contaId = String(conta.id);
        }
      }

      return { card: enrichCard(updated), conta_id: contaId, concluido: !laterStage };
    });

    return { success: true, data: result, error: null };
  });

  app.delete('/producao/cards/:id', async req => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const tenantId = req.user.current_tenant_id;
    const [card] = await withTenant(db, tenantId, tx =>
      tx.execute(sql`
        UPDATE producao_cards
        SET deleted_at = now()
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING id
      `)
    );
    if (!card) throw new HttpError(404, 'NOT_FOUND', 'Processo não encontrado.');
    return { success: true, data: card, error: null };
  });
}

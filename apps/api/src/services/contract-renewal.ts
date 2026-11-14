import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

type QueryExecutor = { execute: Database['execute'] };

export function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

/** Add calendar months while clamping to the target month's last day (e.g. Jan 31 + 1m -> Feb 28). */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [year, month, day] = toIsoDate(isoDate).split('-').map(Number);
  const totalMonths = (month - 1) + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay)).toISOString().slice(0, 10);
}

export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = toIsoDate(isoDate).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export async function hasRenewalColumns(tx: QueryExecutor): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contratos_locacao'
      AND column_name IN ('renovacao_automatica', 'ciclos_cobrados', 'proximo_vencimento')
  `);
  return Number(rows[0]?.total ?? 0) === 3;
}

/**
 * Automatically renew active rental contracts whenever more than 1 month has elapsed
 * from the customer's pickup date without closing the contract, issuing one idempotent
 * monthly invoice per elapsed cycle.
 */
export async function processTenantContractRenewals(
  tx: QueryExecutor,
  tenantId: string,
  referenceDate?: string,
): Promise<{ renewedContracts: number; chargesCreated: number }> {
  if (!(await hasRenewalColumns(tx))) {
    return { renewedContracts: 0, chargesCreated: 0 };
  }

  let todayIso = referenceDate?.slice(0, 10);
  if (!todayIso) {
    const [dateRow] = await tx.execute(sql`SELECT CURRENT_DATE::text AS today`);
    todayIso = toIsoDate(dateRow?.today ?? new Date());
  }

  const dueContracts = await tx.execute(sql`
    SELECT c.id, c.cliente_id, c.data_inicio, c.valor_total,
           COALESCE(c.ciclos_cobrados, 1) AS ciclos_cobrados,
           c.proximo_vencimento,
           cl.nome AS cliente_nome
    FROM contratos_locacao c
    LEFT JOIN clientes cl ON cl.tenant_id = c.tenant_id AND cl.id = c.cliente_id
    WHERE c.tenant_id = ${tenantId}::uuid
      AND c.deleted_at IS NULL
      AND c.status = 'ATIVO'
      AND COALESCE(c.renovacao_automatica, true) = true
      AND (
        (c.proximo_vencimento IS NOT NULL AND c.proximo_vencimento < ${todayIso}::date)
        OR (c.proximo_vencimento IS NULL AND (c.data_inicio + INTERVAL '1 month')::date < ${todayIso}::date)
      )
    ORDER BY COALESCE(c.proximo_vencimento, (c.data_inicio + INTERVAL '1 month')::date) ASC
    FOR UPDATE OF c
  `);

  let renewedContracts = 0;
  let chargesCreated = 0;

  for (const contract of dueContracts) {
    const contractId = String(contract.id);
    const startDate = toIsoDate(contract.data_inicio);
    let cycle = Math.max(1, Number(contract.ciclos_cobrados ?? 1));
    let anchor = contract.proximo_vencimento
      ? toIsoDate(contract.proximo_vencimento)
      : addMonthsClamped(startDate, cycle);

    let updatedContract = false;
    let guard = 0;

    while (anchor < todayIso && guard < 120) {
      guard += 1;
      const nextCycle = cycle + 1;
      const existingCharge = await tx.execute(sql`
        SELECT id
        FROM transacoes_financeiras
        WHERE tenant_id = ${tenantId}::uuid
          AND deleted_at IS NULL
          AND anexos->>'contrato_id' = ${contractId}
          AND anexos->>'ciclo' = ${String(nextCycle)}
        LIMIT 1
      `);

      if (!existingCharge.length) {
        const clienteNome = String(contract.cliente_nome ?? '').trim() || 'Cliente';
        const descricao = `Mensalidade Locação (Renovação Ciclo ${nextCycle}) · ${clienteNome}`;
        const anexos = JSON.stringify({
          contrato_id: contractId,
          ciclo: nextCycle,
          tipo_origem: 'CONTRATO_RENOVACAO',
        });

        await tx.execute(sql`
          INSERT INTO transacoes_financeiras(
            tenant_id, tipo, descricao, valor, data_competencia, data_vencimento,
            status, categoria, cliente_id, anexos
          ) VALUES (
            ${tenantId}::uuid, 'RECEITA', ${descricao}, ${Number(contract.valor_total ?? 0)},
            ${anchor}::date, ${anchor}::date, 'PENDENTE', 'Locação',
            ${String(contract.cliente_id)}::uuid, ${anexos}::jsonb
          )
        `);
        chargesCreated += 1;
      }

      cycle = nextCycle;
      anchor = addMonthsClamped(startDate, cycle);
      updatedContract = true;
    }

    if (updatedContract) {
      await tx.execute(sql`
        UPDATE contratos_locacao
        SET ciclos_cobrados = ${cycle}, proximo_vencimento = ${anchor}::date
        WHERE tenant_id = ${tenantId}::uuid AND id = ${contractId}::uuid
      `);
      renewedContracts += 1;
    }
  }

  return { renewedContracts, chargesCreated };
}

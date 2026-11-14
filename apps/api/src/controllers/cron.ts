import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { withTenant, type Database } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { processTenantContractRenewals } from '../services/contract-renewal.js';

export async function cronRoutes(app: FastifyInstance, db: Database) {
  // Rota para ser chamada por rotinas de Cron (ex: Vercel Cron, GitHub Actions, AWS EventBridge)
  app.route({
    method: ['GET', 'POST'],
    url: '/cron/check-contracts',
    handler: async (req, reply) => {
      const configuredSecret = process.env.CRON_SECRET;
      const headerSecret = req.headers['x-cron-secret'];
      const authorization = req.headers.authorization;
      const bearerSecret = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
      const providedSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret ?? bearerSecret;

      if (!configuredSecret) {
        req.log.error('[cron] CRON_SECRET não configurado');
        return reply.code(401).send({ success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      }
      if (!providedSecret) {
        return reply.code(401).send({ success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      }

      const expected = Buffer.from(configuredSecret);
      const provided = Buffer.from(providedSecret);
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        return reply.code(401).send({ success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      }

      const activeTenants = await db.execute<{ tenant_id: string }>(sql`
        SELECT id::text AS tenant_id
        FROM tenants
      `);

      let renewedContracts = 0;
      let chargesCreated = 0;

      for (const row of activeTenants) {
        const tenantId = String(row.tenant_id);
        const summary = await withTenant(db, tenantId, tx => processTenantContractRenewals(tx, tenantId));
        renewedContracts += summary.renewedContracts;
        chargesCreated += summary.chargesCreated;
      }

      return {
        success: true,
        message: `Rotina concluída. Contratos renovados: ${renewedContracts}, cobranças geradas: ${chargesCreated}`,
        data: {
          tenantsProcessed: activeTenants.length,
          renewedContracts,
          chargesCreated,
        },
      };
    },
  });
}

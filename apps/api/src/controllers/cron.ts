import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/client.js';
import { sql } from 'drizzle-orm';

export async function cronRoutes(app: FastifyInstance, db: Database) {
  // Rota para ser chamada por rotinas de Cron (ex: Vercel Cron, GitHub Actions, AWS EventBridge)
  app.post('/cron/check-contracts', async (req, reply) => {
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

    // Busca contratos que expiram em exatamente 3 dias
    const expiringContracts = await db.execute<{
      contrato_id: string;
      data_fim: string;
      cliente_nome: string;
      cliente_email: string;
      tenant_id: string;
    }>(sql`
      SELECT 
        c.id as contrato_id, 
        c.data_fim_prevista as data_fim, 
        cl.nome as cliente_nome, 
        cl.email as cliente_email,
        c.tenant_id
      FROM contratos_locacao c
      JOIN clientes cl ON c.cliente_id = cl.id AND c.tenant_id = cl.tenant_id
      WHERE c.status = 'ATIVO' 
        AND c.data_fim_prevista = current_date + interval '3 days'
    `);

    const emailsSent = [];

    for (const contract of expiringContracts) {
      if (contract.cliente_email) {
        // Simulador de envio de E-mail (substituir por SendGrid, AWS SES, Resend, etc)
        const emailContent = `
Olá ${contract.cliente_nome},

Informamos que o seu contrato de locação (ID: ${contract.contrato_id.split('-')[0]}) está previsto para vencer em 3 dias (na data ${new Date(contract.data_fim).toLocaleDateString('pt-BR')}).

Caso você não entre em contato para solicitar o cancelamento, o contrato será renovado automaticamente para evitar a interrupção do serviço.

Atenciosamente,
Equipe de Operações
        `.trim();
        
        console.log(`\n[EMAIL DISPARADO] ==============================
Para: ${contract.cliente_email}
Assunto: Aviso de Vencimento de Contrato
Mensagem:
${emailContent}
================================================\n`);
        
        emailsSent.push(contract.cliente_email);
      }
    }

    return { 
      success: true, 
      message: `Rotina concluída. Emails disparados: ${emailsSent.length}`,
      data: emailsSent
    };
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { userTenants } from '../repositories/auth.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { auth, HttpError } from '../middlewares/auth.js';
export async function authRoutes(app: FastifyInstance, db: Database) {
  const dummyHash = await hashPassword('dummy-password-for-timing');
  const session = async (user: {id: string; name: string; email: string}, tenantId?: string, rememberMe?: boolean) => {
    const tenants = await userTenants(db, user.id);
    const active = tenantId ? tenants.find(t => t.id === tenantId) : tenants[0];
    if (!active) throw new HttpError(403, 'TENANT_ACCESS_DENIED', 'Empresa não autorizada.');
    return { user, userTenants: tenants, activeTenant: active, token: app.jwt.sign({ sub: user.id, current_tenant_id: String(active.id) }, { expiresIn: rememberMe ? '7d' : '15m' }) };
  };
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const body = z.object({ email: z.email().max(254), password: z.string().min(1).max(200), rememberMe: z.boolean().optional() }).strict().parse(req.body);
    const rows = await db.execute(sql`select id,name,email,password_hash from users where email=${body.email.toLowerCase()}`);
    const user = rows[0];
    const valid = await verifyPassword(body.password, user ? String(user.password_hash) : dummyHash);
    if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    return { success: true, data: await session({ id: String(user.id), name: String(user.name), email: String(user.email) }, undefined, body.rememberMe), error: null };
  });
  app.post('/auth/switch-tenant', { preHandler: auth(db) }, async req => {
    const { target_tenant_id } = z.object({ target_tenant_id: z.uuid() }).strict().parse(req.body);
    const [user] = await db.execute(sql`select id,name,email from users where id=${req.user.sub}::uuid`);
    return { success: true, data: await session({ id: String(user.id), name: String(user.name), email: String(user.email) }, target_tenant_id), error: null };
  });
}

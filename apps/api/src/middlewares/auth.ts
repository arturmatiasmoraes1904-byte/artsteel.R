import type { FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
declare module '@fastify/jwt' { interface FastifyJWT { payload: { sub: string; current_tenant_id: string; remember?: boolean }; user: { sub: string; current_tenant_id: string; remember?: boolean } } }
export class HttpError extends Error { constructor(public statusCode: number, public code: string, message: string) { super(message); } }
export function auth(db: Database) {
  return async (request: FastifyRequest) => {
    await request.jwtVerify();
    const rows = await db.execute(sql`select role from user_tenants where user_id=${request.user.sub}::uuid and tenant_id=${request.user.current_tenant_id}::uuid and is_active=true`);
    if (!rows.length) throw new HttpError(403, 'TENANT_ACCESS_DENIED', 'Acesso à empresa revogado.');
  };
}
export async function requireRole(db: Database, request: FastifyRequest, roles: string[]) {
  const rows = await db.execute(sql`select role from user_tenants where user_id=${request.user.sub}::uuid and tenant_id=${request.user.current_tenant_id}::uuid and is_active=true`);
  if (!rows.length || !roles.includes(String(rows[0].role))) throw new HttpError(403, 'ROLE_DENIED', 'Seu perfil não permite esta operação.');
}

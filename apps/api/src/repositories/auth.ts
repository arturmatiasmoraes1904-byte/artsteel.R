import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { getTenantSettings } from '../services/tenant-settings.js';

export const userTenants = async (db: Database, userId: string) => {
  const rows = await db.execute(sql`
    select 
      t.id,
      t.nome_fantasia,
      t.razao_social,
      t.cnpj,
      t.segmento,
      ut.role 
    from tenants t join user_tenants ut on ut.tenant_id=t.id
    where ut.user_id=${userId}::uuid and ut.is_active=true 
    order by nome_fantasia`);

  return rows.map((r: any) => {
    const s = getTenantSettings(String(r.id), String(r.segmento));
    return {
      id: r.id,
      nome_fantasia: s.nome_fantasia || r.nome_fantasia,
      razao_social: s.razao_social || r.razao_social,
      cnpj: s.cnpj || r.cnpj,
      segmento: r.segmento,
      role: r.role,
      telefone: s.telefone ?? '',
      email: s.email ?? '',
      inscricao_estadual: s.inscricao_estadual ?? '',
      cep: s.cep ?? '',
      logradouro: s.logradouro ?? '',
      numero: s.numero ?? '',
      bairro: s.bairro ?? '',
      cidade: s.cidade ?? '',
      estado: s.estado ?? ''
    };
  });
};

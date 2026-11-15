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
      t.telefone,
      t.email,
      t.inscricao_estadual,
      t.cep,
      t.logradouro,
      t.numero,
      t.bairro,
      t.cidade,
      t.estado,
      ut.role 
    from tenants t join user_tenants ut on ut.tenant_id=t.id
    where ut.user_id=${userId}::uuid and ut.is_active=true 
    order by t.nome_fantasia`);

  return rows.map((r: any) => {
    const s = getTenantSettings(String(r.id), String(r.segmento));
    return {
      id: r.id,
      nome_fantasia: r.nome_fantasia || s.nome_fantasia,
      razao_social: r.razao_social || s.razao_social,
      cnpj: r.cnpj || s.cnpj,
      segmento: r.segmento,
      role: r.role,
      telefone: r.telefone ?? s.telefone ?? '',
      email: r.email ?? s.email ?? '',
      inscricao_estadual: r.inscricao_estadual ?? s.inscricao_estadual ?? '',
      cep: r.cep ?? s.cep ?? '',
      logradouro: r.logradouro ?? s.logradouro ?? '',
      numero: r.numero ?? s.numero ?? '',
      bairro: r.bairro ?? s.bairro ?? '',
      cidade: r.cidade ?? s.cidade ?? '',
      estado: r.estado ?? s.estado ?? ''
    };
  });
};

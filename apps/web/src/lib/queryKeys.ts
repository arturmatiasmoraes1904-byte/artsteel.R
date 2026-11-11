import type { QueryKey } from '@tanstack/react-query';

/** Chaves únicas e hierárquicas. Nunca use uma string solta como query key. */
export const queryKeys = {
  clientes: {
    all: ['clientes'] as const,
    list: (tenantId: string | undefined, params: { search?: string; status?: string; page?: number; limit?: number } = {}) =>
      ['clientes', tenantId, 'lista', params] as const,
    detail: (id: string) => ['clientes', id] as const,
    lancamentos: (id: string) => ['clientes', id, 'lancamentos'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    kpis: (tenantId: string | undefined, mode: string) => ['dashboard', 'kpis', tenantId, mode] as const,
    resumo: ['dashboard', 'resumo'] as const,
    totalClientes: ['dashboard', 'total-clientes'] as const,
  },
  lancamentos: {
    all: ['lancamentos'] as const,
    list: (params: Record<string, unknown> = {}) => ['lancamentos', 'lista', params] as const,
  },
  orcamentos: {
    all: ['orcamentos'] as const,
    list: (params: Record<string, unknown> = {}) => ['orcamentos', 'lista', params] as const,
  },
  relatorios: { all: ['relatorios'] as const },
} satisfies Record<string, unknown>;

export type AppQueryKey = QueryKey;

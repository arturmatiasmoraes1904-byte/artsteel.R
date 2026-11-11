import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

export type InvalidationAction = 'criarCliente' | 'editarCliente' | 'excluirCliente' | 'criarLancamento' | 'orcamentos' | 'financeiro' | 'estoque';

export function invalidationKeys(action: InvalidationAction, variables?: { id?: string }): QueryKey[] {
  switch (action) {
    case 'criarCliente':
    case 'editarCliente':
    case 'excluirCliente':
      return [queryKeys.clientes.all, queryKeys.dashboard.all, queryKeys.dashboard.totalClientes];
    case 'criarLancamento':
      return [
        queryKeys.lancamentos.all,
        ...(variables?.id ? [queryKeys.clientes.lancamentos(variables.id)] : []),
        queryKeys.dashboard.all,
        queryKeys.relatorios.all,
      ];
    case 'orcamentos':
      return [queryKeys.orcamentos.all];
    case 'financeiro':
      return [['financeiro']];
    case 'estoque':
      return [['estoque']];
  }
}

export async function invalidateAction(
  queryClient: QueryClient,
  action: InvalidationAction,
  variables?: { id?: string },
) {
  await Promise.all(invalidationKeys(action, variables).map((queryKey) =>
    queryClient.invalidateQueries({ queryKey }),
  ));
}

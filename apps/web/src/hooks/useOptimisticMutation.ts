'use client';

import { useMutation, useQueryClient, type MutationFunction, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invalidateAction, type InvalidationAction } from '@/lib/invalidation';

type Snapshot = Array<[QueryKey, unknown]>;

type Options<TData, TVariables> = {
  mutationFn: MutationFunction<TData, TVariables>;
  /** Chaves raiz/prefixos cujos dados serão lidos e alterados otimisticamente. */
  queryKeys: QueryKey[];
  apply: (oldData: unknown, variables: TVariables, queryKey: QueryKey) => unknown;
  onMutateData?: (variables: TVariables, snapshot: Snapshot) => void;
  onSuccessData?: (data: TData, variables: TVariables) => void;
  onErrorData?: (error: Error, variables: TVariables) => void;
  invalidate: InvalidationAction;
  invalidateVariables?: (variables: TVariables) => { id?: string };
  errorMessage?: string;
};

/** Fluxo único de snapshot -> optimistic update -> rollback -> invalidação. */
export function useOptimisticMutation<TData, TVariables>({
  mutationFn, queryKeys, apply, onMutateData, onSuccessData, onErrorData, invalidate, invalidateVariables, errorMessage,
}: Options<TData, TVariables>) {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables, { snapshot: Snapshot }>({
    meta: { optimistic: true },
    mutationFn,
    onMutate: async (variables) => {
      await Promise.all(queryKeys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      const snapshot: Snapshot = queryKeys.flatMap((queryKey) => queryClient.getQueriesData({ queryKey }));
      queryKeys.forEach((queryKey) => {
        queryClient.setQueriesData({ queryKey }, (oldData) => apply(oldData, variables, queryKey));
      });
      onMutateData?.(variables, snapshot);
      return { snapshot };
    },
    onSuccess: (data, variables) => onSuccessData?.(data, variables),
    onError: (error, _variables, context) => {
      context?.snapshot.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      onErrorData?.(error, _variables);
      toast.error(error.message || errorMessage || 'Não foi possível concluir a ação.');
    },
    onSettled: (_data, _error, variables) => {
      void invalidateAction(queryClient, invalidate, invalidateVariables?.(variables));
    },
  });
}

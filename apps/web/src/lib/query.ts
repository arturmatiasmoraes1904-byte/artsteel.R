import {MutationCache, QueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
export const queryClient=new QueryClient({
  mutationCache:new MutationCache({onError:(error,variables,_context,mutation)=>{
    if ((mutation.options.meta as {optimistic?: boolean} | undefined)?.optimistic) return;
    const apiError=error as Error & {status?:number};
    if(apiError.status===401){toast.error('Sua sessão expirou. Faça login novamente.');return;}
    if(apiError.status===403){toast.error('Você não tem permissão para esta ação.');return;}
    const retry=mutation as unknown as {execute:(values:unknown)=>Promise<unknown>};
    toast.error(apiError.message||'Não foi possível concluir a ação.',{action:{label:'Tentar novamente',onClick:()=>{void retry.execute(variables);}}});
  }}),
  defaultOptions:{queries:{
    // O TTL é definido por recurso nos hooks; este valor é apenas um fallback seguro.
    // Mantém dados em cache durante navegações e revalida apenas consultas vencidas.
    staleTime:30_000, gcTime:30*60_000, retry:1,
    refetchOnWindowFocus:false, refetchOnMount:true, refetchOnReconnect:true,
  }, mutations:{retry:0}},
});

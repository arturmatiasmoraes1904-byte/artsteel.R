import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {queryKeys} from '@/lib/queryKeys';

export type DashboardActivity={id:string;type:'cliente'|'orcamento'|'producao'|'financeiro';message:string;occurredAt:string};
export type DashboardAlert={id:string;message:string;occurredAt?:string};
export type DashboardContact={id:string;name:string;email?:string|null;phone?:string|null};
export type DashboardMetrics={
  ocupacao?:number; manutencao?:number; faturamento?:number; inadimplencia?:number;
  tempo_medio?:number|null; margem?:number|null; desperdicio?:number|null; otd?:number|null;
  recebiveis?:number; recebido?:number; ebitda?:number|null;
  categories?:Record<string,string|number>[]; stages?:Record<string,string|number>[];
  costs?:Record<string,string|number>[]; companies?:Record<string,string|number>[];
  salesMix?:{name:string;value:number}[]; revenueHistory?:{name:string;value:number}[];
  cashFlowHistory?:{name:string;receitas:number;despesas:number}[];
  finance?:{receitasMes:number;receitasPendentes:number;despesasMes:number};
  stock?:{total:number;baixo:number;valor:number};
  quotes?:{total:number;aprovados:number;pendentes:number;pipeline:number};
  quoteStatuses?:{name:string;quantidade:number}[];
  activities?:DashboardActivity[]; contacts?:DashboardContact[]; alerts?:DashboardAlert[]; nota?:string;
};

function dashboardPath(mode:'locacao'|'serralheria'|'grupo') {
  return mode==='grupo'?'/dashboard/consolidado':`/${mode}/dashboard`;
}

/** KPIs e dados auxiliares são carregados com o tenant ativo como parte da chave do cache. */
export function useDashboardKPIs(tenantId:string|undefined,mode:'locacao'|'serralheria'|'grupo') {
  return useQuery({
    queryKey: queryKeys.dashboard.kpis(tenantId, mode),
    queryFn:()=>api<DashboardMetrics>(dashboardPath(mode)),
    enabled:Boolean(tenantId),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    // KPIs financeiros são críticos: revalidam ao voltar para a janela.
    refetchOnWindowFocus: false,
  });
}

/** Alias semântico para os gráficos, que compartilham a consulta e evitam requisições duplicadas. */
export function useDashboardCharts(tenantId:string|undefined,mode:'locacao'|'serralheria'|'grupo') {
  return useDashboardKPIs(tenantId,mode);
}

'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {useTheme} from 'next-themes';
import {useIsFetching,useQuery} from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Calculator, Columns3, Menu,
  CircleDollarSign, Package, Truck, Wrench, LogOut, Layers3, Settings, FileText,
  Moon, Search, Star, RefreshCw, LoaderCircle, Bell, AlertTriangle
} from 'lucide-react';
import {useTenantStore} from '@/stores/useTenantStore';
import {queryClient} from '@/lib/query';
import {queryKeys} from '@/lib/queryKeys';
import {TenantSelector} from './TenantSelector';
import {api} from '@/lib/api';
import {Switch} from './ui/switch';
import {Label} from './ui/label';

type FinanceReminderSummary = {
  lembretes_a_pagar?: {
    vencidas: { quantidade: number; total: number };
    vence_hoje: { quantidade: number; total: number };
    proximos_7_dias: { quantidade: number; total: number };
    proximas_contas: Array<{
      id: string;
      descricao: string;
      saldo_aberto: number;
      data_vencimento: string;
      dias_para_vencer: number;
    }>;
  };
};

const formatCurrencyBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export function AppShell({children}:{children:React.ReactNode}){
  const {activeTenant,token,user,switching,hasHydrated,setHasHydrated,logout}=useTenantStore();
  const path=usePathname(),router=useRouter();
  const [mounted,setMounted]=useState(false),[open,setOpen]=useState(false),[bellOpen,setBellOpen]=useState(false);
  const bellRef = useRef<HTMLDivElement | null>(null);
  const [search,setSearch]=useState(''),[results,setResults]=useState<{id:string;title:string;type:string;href:string}[]>([]);
  const [searchFocused,setSearchFocused]=useState(false);
  const [isRefreshing,setIsRefreshing]=useState(false);
  const fetchingCount=useIsFetching();
  const {theme,setTheme}=useTheme();

  useEffect(()=>{
    setMounted(true);
    if (!hasHydrated && useTenantStore.persist.hasHydrated()) {
      setHasHydrated(true);
    }
  },[hasHydrated,setHasHydrated]);

  useEffect(()=>{setOpen(false);setBellOpen(false);},[path]);
  useEffect(()=>{
    if(!bellOpen) return;
    const handleOutside = (event: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  },[bellOpen]);
  useEffect(()=>{if(search.trim().length<2){setResults([]);return;}const timer=setTimeout(()=>{api<{id:string;title:string;type:string;href:string}[]>(`/busca?q=${encodeURIComponent(search)}`).then(setResults).catch(()=>setResults([]));},300);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();document.getElementById('global-search')?.focus();}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);

  const { data: financeReminders } = useQuery({
    queryKey: ['financeiro', 'dashboard', activeTenant?.id],
    queryFn: ({ signal }) => api<FinanceReminderSummary>('/financeiro/dashboard', { signal }),
    enabled: mounted && hasHydrated && Boolean(token && activeTenant?.id),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const lembretes = financeReminders?.lembretes_a_pagar;
  const alertCount = (lembretes?.vencidas.quantidade ?? 0) + (lembretes?.vence_hoje.quantidade ?? 0) + (lembretes?.proximos_7_dias.quantidade ?? 0);

  const refreshData=async()=>{setIsRefreshing(true);try{await queryClient.invalidateQueries();router.refresh();}finally{window.setTimeout(()=>setIsRefreshing(false),300);}};
  const prefetchRouteData=(href:string)=>{
    const tenantId=activeTenant?.id;
    if(!tenantId)return;
    if(href==='/clientes'){
      const queryKey=queryKeys.clientes.list(tenantId,{search:'',status:'TODOS',page:1,limit:50});
      void queryClient.prefetchQuery({queryKey,queryFn:({signal})=>api<unknown>('/clientes?page=1&limit=50&search=&status=TODOS',{signal}),staleTime:5*60_000,gcTime:30*60_000});
    }else if(href==='/orcamentos'){
      void queryClient.prefetchQuery({queryKey:['orcamentos','lista',tenantId,1,'',50],queryFn:({signal})=>api<unknown>('/orcamentos?page=1&limit=50&search=',{signal}),staleTime:30_000,gcTime:30*60_000});
      void queryClient.prefetchQuery({queryKey:['clientes',tenantId,'orcamento-dropdown'],queryFn:({signal})=>api<unknown>('/clientes/opcoes',{signal}),staleTime:5*60_000,gcTime:30*60_000});
    }else if(href==='/financeiro'){
      void queryClient.prefetchQuery({queryKey:['financeiro','transacoes',tenantId,1,'',50],queryFn:({signal})=>api<unknown>('/financeiro/transacoes?page=1&limit=50&search=',{signal}),staleTime:30_000,gcTime:30*60_000});
      void queryClient.prefetchQuery({queryKey:['financeiro','dashboard',tenantId],queryFn:({signal})=>api<unknown>('/financeiro/dashboard',{signal}),staleTime:30_000,gcTime:30*60_000});
    }
  };
  useEffect(()=>{if(mounted&&hasHydrated&&!token)router.replace('/login');},[mounted,hasHydrated,token,router]);

  if(!mounted||!hasHydrated)return <div className="boot text-[#F2F3F5] text-center mt-20">Carregando sua operação...</div>;
  if(!token)return <div className="boot text-[#F2F3F5] text-center mt-20">Redirecionando para o login...</div>;

  const rental=activeTenant?.segmento!=='SERRALHERIA',metal=activeTenant?.segmento!=='LOCADORA';
  const links=[
    {href:'/dashboard',name:'Visão geral',Icon:LayoutDashboard},
    {href:'/clientes',name:'Clientes',Icon:Users},
    {href:'/financeiro',name:'Financeiro',Icon:CircleDollarSign},
    {href:'/estoque',name:'Estoque',Icon:Package},
    ...(rental?[
      {href:'/locacao/equipamentos',name:'Equipamentos',Icon:Truck},
      {href:'/locacao/contratos',name:'Contratos',Icon:FileText},
      {href:'/locacao/manutencoes',name:'Manutenções',Icon:Wrench}
    ]:[]),
    {href:'/orcamentos',name:activeTenant?.segmento==='SERRALHERIA'?'Orçamentos e Contratos':'Orçamentos',Icon:Calculator},
    ...(metal?[
      {href:'/producao',name:'Produção',Icon:Columns3}
    ]:[])
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#121316] text-[#F2F3F5] font-sans">
      {open&&<button className="fixed inset-0 bg-black/50 z-40 md:hidden" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>}
      
      <aside className={`shrink-0 fixed inset-y-0 left-0 h-screen w-[260px] bg-[#1A1C20] border-r border-[#2E3238] p-6 flex flex-col z-50 transform transition-transform ${open?'translate-x-0':'-translate-x-full'} md:translate-x-0 md:relative`}>
        
        {/* User / Tenant Info */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#23262B] border-2 border-[#E4E7EC] flex items-center justify-center font-bold text-[#E4E7EC]">
            {user?.name ? user.name.slice(0,2).toUpperCase() : 'AS'}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-semibold text-white truncate">{user?.name || 'Usuário'}</span>
            <span className="text-xs text-[#E4E7EC] truncate">{activeTenant?.nome_fantasia || 'Art Steel'}</span>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" aria-hidden="true" />
          <input 
            id="global-search" value={search} onFocus={()=>setSearchFocused(true)} onBlur={()=>setTimeout(()=>setSearchFocused(false),150)} onChange={e=>setSearch(e.target.value)}
            type="text" 
            placeholder="Buscar..." 
            className="w-full bg-[#23262B] text-sm text-gray-300 rounded-lg pl-12 pr-10 py-2.5 border-none focus:ring-1 focus:ring-[#E4E7EC] outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono bg-[#1A1C20] px-1.5 rounded">⌘K</span>
          {searchFocused&&<div className="absolute top-full mt-1 w-full z-50 bg-[#23262B] border border-[#2E3238] rounded-lg overflow-hidden">{!search&&<><p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500">Ações rápidas</p><button onMouseDown={()=>{router.push('/clientes?novo=1');setSearchFocused(false)}} className="w-full text-left px-3 py-2 hover:bg-[#2E3238] text-sm"><span className="text-[#E4E7EC] text-xs mr-2">Ação</span>Novo cliente</button><button onMouseDown={()=>{router.push('/orcamentos?novo=1');setSearchFocused(false)}} className="w-full text-left px-3 py-2 hover:bg-[#2E3238] text-sm"><span className="text-[#E4E7EC] text-xs mr-2">Ação</span>Novo orçamento</button></>}{search.length>=2&&results.length===0&&<p className="px-3 py-3 text-sm text-gray-500">Nenhum resultado encontrado.</p>}{results.map(result=><button key={`${result.type}-${result.id}`} onMouseDown={()=>{router.push(result.href);setSearch('');setResults([])}} className="w-full text-left px-3 py-2 hover:bg-[#2E3238] text-sm"><span className="text-[#E4E7EC] text-xs mr-2">{result.type}</span>{result.title}</button>)}</div>}
        </div>

        <div className="mb-4">
          <TenantSelector />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
          <div className="mb-6">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3 block px-2">OPERAÇÕES</span>
            <nav className="flex flex-col gap-1">
              {links.map(({href,name,Icon})=>(
                <Link key={href} href={href} onMouseEnter={()=>prefetchRouteData(href)} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${path===href || (path==='/' && href==='/dashboard') ? 'bg-[#E4E7EC] text-[#121316]' : 'text-gray-400 hover:text-white hover:bg-[#23262B]'}`}>
                  <Icon className="w-4 h-4" />
                  {name}
                </Link>
              ))}
            </nav>
          </div>

          <div>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3 block px-2">SISTEMA</span>
            <nav className="flex flex-col gap-1">
              <Link href="/configuracoes/empresa" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${path==='/configuracoes/empresa' ? 'bg-[#E4E7EC] text-[#121316]' : 'text-gray-400 hover:text-white hover:bg-[#23262B]'}`}>
                <Settings className="w-4 h-4" />
                Configurações
              </Link>
              <button onClick={()=>{logout();queryClient.clear();router.replace('/login');}} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-red-400 hover:text-white hover:bg-[#23262B] text-left w-full">
                <LogOut className="w-4 h-4" />
                Sair da conta
              </button>
            </nav>
          </div>
        </div>

        <div className="mt-auto pt-6 flex items-center gap-2.5 text-white font-bold tracking-tight border-t border-[#2E3238]">
          <Layers3 className="w-6 h-6 text-[#E4E7EC] shrink-0" />
          <div className="flex flex-col leading-none">
            <span className="text-white text-base font-bold tracking-tight">Art Steel</span>
            <span className="text-[#9CA1AA] text-[10px] tracking-wider uppercase font-semibold mt-0.5">Gestão de Operação</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-[#121316]">
        <header className="h-16 shrink-0 flex items-center justify-between px-8 border-b border-[#2E3238] bg-[#121316] z-30">
          <div className="flex items-center gap-4 text-gray-400">
            <button className="md:hidden hover:text-white transition-colors" onClick={()=>setOpen(true)}>
              <Menu className="w-4 h-4" />
            </button>
            <Layers3 className="w-4 h-4 cursor-pointer hover:text-white transition-colors hidden md:block" />
            <Star className="w-4 h-4 cursor-pointer hover:text-white transition-colors hidden md:block" />
            <div className="flex items-center gap-2 text-xs font-medium ml-2">
              <span>Workspace</span>
              <span>/</span>
              <span className="text-white">{activeTenant?.nome_fantasia || 'Visão Geral'}</span>
            </div>
          </div>
          <div className="flex items-center gap-5 text-gray-400">
            {fetchingCount>0&&<span role="status" aria-live="polite" className="flex items-center gap-1.5 text-[11px] text-gray-400"><LoaderCircle className="w-3.5 h-3.5 animate-spin"/>Sincronizando...</span>}
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                aria-label="Lembretes de contas a pagar"
                title="Lembretes de contas a pagar"
                onClick={() => setBellOpen(prev => !prev)}
                className="relative p-1.5 rounded-lg hover:text-white hover:bg-[#23262B] transition-colors"
              >
                <Bell className="w-4 h-4" />
                {alertCount > 0 && (
                  <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    (lembretes?.vencidas.quantidade ?? 0) > 0 ? 'bg-red-500 text-white' : 'bg-[#E0A11B] text-[#121316]'
                  }`}>
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-[#1A1C20] border border-[#2E3238] rounded-xl shadow-2xl p-4 z-50 text-left">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#2E3238]">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#E0A11B]" />
                      Lembretes · Contas a Pagar
                    </span>
                    <Link
                      href="/financeiro?tab=a_pagar"
                      onClick={() => setBellOpen(false)}
                      className="text-[11px] font-medium text-[#E4E7EC] hover:underline"
                    >
                      Ver todas
                    </Link>
                  </div>
                  {alertCount === 0 && !(lembretes?.proximas_contas?.length) ? (
                    <p className="text-xs text-gray-400 py-3">Nenhuma conta a pagar vencida ou próxima nos próximos 7 dias.</p>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="bg-[#23262B] rounded-lg p-2">
                          <span className="block text-[10px] text-red-400 font-semibold">Vencidas</span>
                          <strong className="text-sm text-white">{lembretes?.vencidas.quantidade ?? 0}</strong>
                        </div>
                        <div className="bg-[#23262B] rounded-lg p-2">
                          <span className="block text-[10px] text-[#E0A11B] font-semibold">Hoje</span>
                          <strong className="text-sm text-white">{lembretes?.vence_hoje.quantidade ?? 0}</strong>
                        </div>
                        <div className="bg-[#23262B] rounded-lg p-2">
                          <span className="block text-[10px] text-gray-300 font-semibold">7 dias</span>
                          <strong className="text-sm text-white">{lembretes?.proximos_7_dias.quantidade ?? 0}</strong>
                        </div>
                      </div>
                      <div className="space-y-1.5 max-h-52 overflow-y-auto">
                        {(lembretes?.proximas_contas ?? []).map(item => (
                          <Link
                            key={item.id}
                            href="/financeiro?tab=a_pagar"
                            onClick={() => setBellOpen(false)}
                            className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#23262B] hover:bg-[#2E3238] transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-white truncate">{item.descricao}</p>
                              <p className={`text-[10px] ${item.dias_para_vencer < 0 ? 'text-red-400' : item.dias_para_vencer === 0 ? 'text-[#E0A11B]' : 'text-gray-400'}`}>
                                {item.dias_para_vencer < 0
                                  ? `Atrasada há ${Math.abs(item.dias_para_vencer)}d`
                                  : item.dias_para_vencer === 0
                                    ? 'Vence hoje'
                                    : `Vence em ${item.dias_para_vencer}d`} · {new Date(`${item.data_vencimento}T12:00:00`).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                            <span className="text-xs font-semibold text-white shrink-0">
                              {formatCurrencyBRL(item.saldo_aberto)}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5" title="Alternar tema">
              <Switch
                id="workspace-theme-mode"
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
              <Label htmlFor="workspace-theme-mode" className="cursor-pointer text-gray-400 flex items-center">
                <Moon className="w-4 h-4" />
              </Label>
            </div>
            <button type="button" aria-label="Atualizar dados" title="Atualizar dados" disabled={isRefreshing} onClick={()=>void refreshData()} className="hover:text-white transition-colors disabled:opacity-50">
              {isRefreshing?<LoaderCircle className="w-4 h-4 animate-spin"/>:<RefreshCw className="w-4 h-4"/>}
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {switching ? <Loading /> : <div key={activeTenant?.id} className="min-h-full">{children}</div>}
        </main>
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando dados" className="grid grid-cols-4 gap-5 p-8">
      {Array.from({length:4},(_,i)=><div className="h-40 bg-[#1A1C20] border border-[#2E3238] rounded-xl animate-pulse" key={i}/>)}
      <div className="col-span-4 h-72 bg-[#1A1C20] border border-[#2E3238] rounded-xl animate-pulse"/>
    </div>
  );
}

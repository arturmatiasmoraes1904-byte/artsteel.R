'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Plus, Truck, Wrench, Activity, AlertTriangle, AlertCircle, X, MapPin, Settings, FileText, CheckCircle2 } from 'lucide-react';
import { useTenantStore } from '@/stores/useTenantStore';
import { useFormDraft } from '@/hooks/useFormDraft';
import { toast } from 'sonner';
import {useRouter, useSearchParams} from 'next/navigation';

type Equipamento = {
  id: string;
  nome: string;
  modelo: string | null;
  numero_serie: string | null;
  patrimonio: string | null;
  categoria: string;
  criticidade?: 'Alta' | 'Média' | 'Baixa';
  status: 'DISPONIVEL' | 'LOCADO' | 'MANUTENCAO' | 'INATIVO';
  valor_locacao: string;
  data_aquisicao: string | null;
  localizacao: string | null;
};

type Manutencao = {
  id?: string;
  equipamento_id: string;
  tipo_manutencao: 'PREVENTIVA' | 'CORRETIVA' | 'CALIBRACAO';
  descricao_problema: string;
  tecnico_responsavel?: string;
  status: 'ABERTA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
  equipamento_nome?: string;
  equipamento_patrimonio?: string;
  data_abertura?: string;
  data_conclusao?: string | null;
};
type MaintenanceDashboard = {total_os:number; abertas:number; concluidas:number; mttr_horas:number};

export default function EquipamentosPage() {
  const queryClient = useQueryClient();
  const params=useSearchParams(),router=useRouter();
  const { activeTenant } = useTenantStore();
  const [activeTab, setActiveTab] = useState<'visao_geral' | 'equipamentos' | 'manutencoes'>(() => params.get('tab') === 'manutencoes' ? 'manutencoes' : 'visao_geral');
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [maintenanceStatus, setMaintenanceStatus] = useState(() => params.get('status') ?? '');
  const [maintenanceType, setMaintenanceType] = useState(() => params.get('tipo') ?? '');
  const [maintenanceTechnician, setMaintenanceTechnician] = useState(() => params.get('tecnico') ?? '');
  const [maintenanceStart, setMaintenanceStart] = useState(() => params.get('data_inicio') ?? '');
  const [maintenanceEnd, setMaintenanceEnd] = useState(() => params.get('data_fim') ?? '');
  const setMaintenanceFilter = (key: 'status'|'tipo'|'tecnico'|'data_inicio'|'data_fim', value: string) => {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    next.set('tab', 'manutencoes');
    router.replace(`/locacao/equipamentos?${next}`);
    if (key === 'status') setMaintenanceStatus(value);
    if (key === 'tipo') setMaintenanceType(value);
    if (key === 'tecnico') setMaintenanceTechnician(value);
    if (key === 'data_inicio') setMaintenanceStart(value);
    if (key === 'data_fim') setMaintenanceEnd(value);
  };
  
  // Modals / Drawers
  const [equipAberto, setEquipAberto] = useState<Equipamento | null>(null);
  const [isCreatingEquip, setIsCreatingEquip] = useState(false);
  const equipFormRef = useRef<HTMLFormElement>(null);
  const { loadDraft, saveDraft, clearDraft, hasDraft } = useFormDraft<Record<string, string>>(`equipamento:${activeTenant?.id ?? 'default'}`, isCreatingEquip && !equipAberto);
  const EQUIP_DRAFT_FIELDS = ['nome', 'modelo', 'numero_serie', 'patrimonio', 'categoria', 'data_aquisicao', 'localizacao', 'valor_locacao', 'status'] as const;
  const syncEquipDraft = () => {
    if (!isCreatingEquip || equipAberto || !equipFormRef.current) return;
    const fd = new FormData(equipFormRef.current);
    const next: Record<string, string> = {};
    for (const field of EQUIP_DRAFT_FIELDS) next[field] = String(fd.get(field) ?? '');
    saveDraft(next);
  };
  const resetEquipDraft = () => {
    clearDraft();
    equipFormRef.current?.reset();
  };
  useEffect(() => {
    if (!isCreatingEquip || equipAberto) return;
    const draft = loadDraft();
    requestAnimationFrame(() => {
      if (!equipFormRef.current) return;
      equipFormRef.current.reset();
      if (!draft) return;
      for (const field of EQUIP_DRAFT_FIELDS) {
        const el = equipFormRef.current.elements.namedItem(field) as HTMLInputElement | HTMLSelectElement | null;
        if (el && draft[field] !== undefined) el.value = draft[field];
      }
    });
  }, [isCreatingEquip, equipAberto, activeTenant?.id]);
  const [abrirOsPara, setAbrirOsPara] = useState<Equipamento | null>(null);
  const [osAberta, setOsAberta] = useState<Manutencao | null>(null);

  // Queries
  const { data: dashboard, isLoading: isLoadingDash } = useQuery({
    queryKey: ['equipamentos', 'dashboard'],
    queryFn: () => api<any>('/locacao/equipamentos/dashboard')
  });

  const { data: equipamentos = [], isLoading: isLoadingEquips } = useQuery({
    queryKey: ['equipamentos', 'lista'],
    queryFn: () => api<Equipamento[]>('/locacao/equipamentos')
  });
  const maintenanceQuery = new URLSearchParams();
  if (maintenanceStatus) maintenanceQuery.set('status', maintenanceStatus);
  if (maintenanceType) maintenanceQuery.set('tipo', maintenanceType);
  if (maintenanceTechnician) maintenanceQuery.set('tecnico', maintenanceTechnician);
  if (maintenanceStart) maintenanceQuery.set('data_inicio', maintenanceStart);
  if (maintenanceEnd) maintenanceQuery.set('data_fim', maintenanceEnd);
  const {data: manutencoes=[],isLoading:isLoadingManutencoes,isError:isMaintenanceError}=useQuery({queryKey:['manutencoes',maintenanceStatus,maintenanceType,maintenanceTechnician,maintenanceStart,maintenanceEnd],queryFn:({signal})=>api<Manutencao[]>(`/locacao/manutencoes?${maintenanceQuery}`,{signal}),staleTime:30_000});
  const {data: equipmentHistory=[]} = useQuery({queryKey:['manutencoes','equipamento',equipAberto?.id],queryFn:({signal})=>api<Manutencao[]>(`/locacao/manutencoes?equipamento_id=${equipAberto?.id}`,{signal}),enabled:Boolean(equipAberto?.id)});
  const {data: maintenanceDashboard, isLoading:isLoadingMaintenanceDashboard}=useQuery({queryKey:['manutencoes','dashboard'],queryFn:({signal})=>api<MaintenanceDashboard>('/locacao/manutencoes/dashboard',{signal}),staleTime:30_000});

  // Filtro de Busca e Categorias
  const equipamentosFiltrados = useMemo(() => {
    return equipamentos.filter(e => {
      const matchBusca = !busca || 
        e.nome.toLowerCase().includes(busca.toLowerCase()) || 
        (e.patrimonio && e.patrimonio.toLowerCase().includes(busca.toLowerCase())) ||
        (e.numero_serie && e.numero_serie.toLowerCase().includes(busca.toLowerCase()));
      const matchStatus = !filtroStatus || e.status === filtroStatus;
      const matchCategoria = !filtroCategoria || e.categoria === filtroCategoria;
      return matchBusca && matchStatus && matchCategoria;
    });
  }, [equipamentos, busca, filtroStatus, filtroCategoria]);

  // Mutações
  const createEquipMut = useMutation({
    mutationFn: (data: Partial<Equipamento>) => api('/locacao/equipamentos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
      clearDraft();
      setIsCreatingEquip(false);
      toast.success('Equipamento cadastrado com sucesso!');
    },
    onError: (error) => toast.error((error as Error).message || 'Não foi possível cadastrar o equipamento.')
  });

  const updateEquipMut = useMutation({
    mutationFn: (data: { id: string; payload: Partial<Equipamento> }) => api<Equipamento>(`/locacao/equipamentos/${data.id}`, {
      method: 'PUT',
      body: JSON.stringify(data.payload),
    }),
    onSuccess: (updatedData) => {
      queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
      setEquipAberto(updatedData);
      toast.success('Equipamento atualizado!');
    },
    onError: (error) => toast.error((error as Error).message || 'Não foi possível atualizar o equipamento.')
  });

  const abrirOsMut = useMutation({
    mutationFn: (data: Manutencao) => api('/locacao/manutencoes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
      void queryClient.invalidateQueries({ queryKey: ['manutencoes'] });
      void queryClient.invalidateQueries({ queryKey: ['manutencoes', 'dashboard'] });
      setAbrirOsPara(null);
      setActiveTab('manutencoes');
      const next = new URLSearchParams(params.toString());
      next.set('tab', 'manutencoes');
      next.delete('status');
      next.delete('tipo');
      next.delete('tecnico');
      next.delete('data_inicio');
      next.delete('data_fim');
      router.replace(`/locacao/equipamentos?${next}`);
      toast.success('Ordem de Serviço (OS) Aberta!');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível abrir a ordem de serviço.')
  });

  const concluirOsMut = useMutation({
    mutationFn: (id: string) => api<Manutencao>(`/locacao/manutencoes/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'CONCLUIDA' }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manutencoes'] });
      void queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
      void queryClient.invalidateQueries({ queryKey: ['manutencoes', 'dashboard'] });
      toast.success('Ordem de serviço concluída e equipamento liberado quando não há outra OS aberta.');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível concluir a ordem de serviço.')
  });
  const editarOsMut = useMutation({
    mutationFn: ({id,payload}:{id:string;payload:Partial<Manutencao>}) => api<Manutencao>(`/locacao/manutencoes/${id}`, {method:'PUT',body:JSON.stringify(payload)}),
    onSuccess: () => {void queryClient.invalidateQueries({queryKey:['manutencoes']});void queryClient.invalidateQueries({queryKey:['equipamentos']});void queryClient.invalidateQueries({queryKey:['manutencoes','dashboard']});setOsAberta(null);toast.success('Ordem de serviço atualizada.');},
    onError: error => toast.error((error as Error).message || 'Não foi possível atualizar a ordem de serviço.')
  });

  const handleSalvarEquip = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const patrimonioRaw = String(formData.get('patrimonio') ?? '').trim();
    const valorRaw = String(formData.get('valor_locacao') ?? '').trim().replace(',', '.');
    const valorNum = Number(valorRaw);
    const payload = {
      nome: String(formData.get('nome') ?? '').trim(),
      modelo: String(formData.get('modelo') ?? '').trim(),
      numero_serie: String(formData.get('numero_serie') ?? '').trim(),
      patrimonio: patrimonioRaw || (isCreatingEquip ? `PAT-${crypto.randomUUID().slice(0, 6).toUpperCase()}` : equipAberto?.patrimonio || undefined),
      categoria: String(formData.get('categoria') ?? 'Geral'),
      criticidade: isCreatingEquip ? 'Média' : (equipAberto?.criticidade ?? 'Média'),
      valor_locacao: valorRaw !== '' && Number.isFinite(valorNum) && valorNum >= 0 ? String(valorNum) : '0',
      status: formData.get('status') as Equipamento['status'],
      data_aquisicao: String(formData.get('data_aquisicao') ?? ''),
      localizacao: String(formData.get('localizacao') ?? '').trim(),
    };

    if (isCreatingEquip) {
      createEquipMut.mutate(payload);
    } else if (equipAberto) {
      updateEquipMut.mutate({ id: equipAberto.id, payload });
    }
  };

  const handleAbrirOS = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!abrirOsPara) return;
    const formData = new FormData(e.currentTarget);
    const equipamentoId = abrirOsPara.id || (formData.get('equipamento_id') as string);
    if (!equipamentoId) {
      toast.error('Selecione um equipamento.');
      return;
    }
    const payload: Manutencao = {
      equipamento_id: equipamentoId,
      tipo_manutencao: formData.get('tipo_manutencao') as any,
      descricao_problema: formData.get('descricao_problema') as string,
      tecnico_responsavel: (formData.get('tecnico_responsavel') as string) || undefined,
      status: 'ABERTA'
    };
    abrirOsMut.mutate(payload);
  };

  return (
    <div className="flex flex-col h-full bg-[#121316] text-white p-8 animate-in fade-in duration-300 relative">
      {/* HEADER & ABAS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Truck className="text-[#E4E7EC]" size={28} />
            Equipamentos e Manutenções
          </h1>
          <div className="flex gap-6 mt-3 border-b border-[#2E3238] overflow-x-auto no-scrollbar">
            {[
              { id: 'visao_geral', label: 'Resumo' },
              { id: 'equipamentos', label: 'Equipamentos' },
              { id: 'manutencoes', label: 'Ordens de Serviço (OS)' }
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => { setActiveTab(tab.id as any); const next=new URLSearchParams(params.toString());tab.id==='manutencoes'?next.set('tab','manutencoes'):next.delete('tab');router.replace(`/locacao/equipamentos?${next}`); }}
                className={`pb-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === tab.id ? 'border-[#E4E7EC] text-[#E4E7EC]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => { setEquipAberto(null); setIsCreatingEquip(true); }}
            className="flex items-center gap-2 text-sm px-5 py-2.5 bg-[#E4E7EC] text-[#121316] font-bold rounded-lg shadow-[0_0_15px_rgba(228,231,236,0.14)] hover:bg-[#D4D8DF] transition-all"
          >
            <Plus size={16}/> Novo Equipamento
          </button>
        </div>
      </div>

      {activeTab === 'visao_geral' && (
        <div className="space-y-6">
          {/* KPIs DASHBOARD */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Total de Equipamentos</span>
              <div className="text-2xl font-bold mt-2 text-white">
                {isLoadingDash ? '...' : dashboard?.total_equipamentos || 0}
              </div>
            </div>
            <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl border-t-2 border-t-[#E4E7EC]">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Disponíveis na Base</span>
              <div className="text-2xl font-bold mt-2 text-[#E4E7EC]">
                {isLoadingDash ? '...' : dashboard?.disponiveis || 0}
              </div>
            </div>
            <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl border-t-2 border-t-blue-500">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Locados / Em Campo</span>
              <div className="text-2xl font-bold mt-2 text-blue-400">
                {isLoadingDash ? '...' : dashboard?.em_uso || 0}
              </div>
            </div>
            <div className="bg-yellow-500/5 border border-yellow-500/20 p-5 rounded-xl border-t-2 border-t-yellow-500">
              <span className="text-yellow-500 text-xs font-semibold uppercase tracking-wider flex items-center gap-2"><Wrench size={14}/> Em Manutenção</span>
              <div className="text-2xl font-bold mt-2 text-yellow-500">
                {isLoadingDash ? '...' : dashboard?.em_manutencao || 0}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl"><span className="text-gray-400 text-xs font-semibold uppercase">Total de OS</span><div className="text-2xl font-bold mt-2">{isLoadingMaintenanceDashboard?'…':maintenanceDashboard?.total_os??0}</div></div><div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl"><span className="text-gray-400 text-xs font-semibold uppercase">OS abertas</span><div className="text-2xl font-bold mt-2 text-yellow-400">{isLoadingMaintenanceDashboard?'…':maintenanceDashboard?.abertas??0}</div></div><div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl"><span className="text-gray-400 text-xs font-semibold uppercase">OS concluídas</span><div className="text-2xl font-bold mt-2 text-green-400">{isLoadingMaintenanceDashboard?'…':maintenanceDashboard?.concluidas??0}</div></div><div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl"><span className="text-gray-400 text-xs font-semibold uppercase">Disponibilidade da frota</span><div className="text-2xl font-bold mt-2 text-[#E4E7EC]">{isLoadingDash?'…':`${dashboard?.total_equipamentos ? Math.round(((dashboard.total_equipamentos - (dashboard.em_manutencao || 0)) / dashboard.total_equipamentos) * 100) : 100}%`}</div></div></div>
          <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl p-6"><h3 className="text-sm font-semibold mb-4 text-[#E4E7EC]">Ordens de serviço ativas</h3><div className="space-y-3">{manutencoes.filter(os=>os.status==='ABERTA'||os.status==='EM_ANDAMENTO').slice(0,5).map(os=><div key={os.id} className="flex gap-3 bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20"><AlertTriangle className="text-yellow-400 shrink-0" size={16}/><div><div className="text-xs font-bold text-white">{os.equipamento_nome}</div><div className="text-[10px] text-yellow-300">{os.tipo_manutencao} · {os.status} · {os.tecnico_responsavel??'Sem técnico definido'}</div></div></div>)}{!manutencoes.some(os=>os.status==='ABERTA'||os.status==='EM_ANDAMENTO')&&<p className="text-sm text-gray-500">Não há OS ativas.</p>}</div></div>
        </div>
      )}

      {activeTab === 'equipamentos' && (
        <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-[#2E3238] flex flex-wrap items-center justify-between gap-4 bg-[#121316]/50">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[240px] max-w-sm">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
                <input 
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg pl-10 pr-4 py-2 text-sm focus:ring-1 focus:ring-[#E4E7EC] outline-none transition-all placeholder:text-gray-600 text-white"
                  placeholder="Buscar por nome, série, patrimônio..."
                />
              </div>
              <select 
                value={filtroStatus} 
                onChange={e => setFiltroStatus(e.target.value)}
                className="bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:ring-1 focus:ring-[#E4E7EC]"
              >
                <option value="">Todos os status</option>
                <option value="DISPONIVEL">Disponível</option>
                <option value="LOCADO">Locado / Em Uso</option>
                <option value="MANUTENCAO">Em Manutenção</option>
                <option value="INATIVO">Inativo</option>
              </select>
              <select 
                value={filtroCategoria} 
                onChange={e => setFiltroCategoria(e.target.value)}
                className="bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:ring-1 focus:ring-[#E4E7EC]"
              >
                <option value="">Todas as categorias</option>
                <option value="Construção">Construção Civil</option>
                <option value="Solda">Maquinário de Solda</option>
                <option value="Medição">Equip. de Medição</option>
                <option value="Veículos">Frota / Veículos</option>
                <option value="Geral">Geral</option>
              </select>
            </div>
            <div className="text-xs text-gray-400 font-medium">
              {equipamentosFiltrados.length} de {equipamentos.length} ativos
            </div>
          </div>
          
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#23262B] text-gray-400 sticky top-0 z-10 shadow-sm border-b border-[#2E3238]">
                <tr>
                  <th className="p-4 font-medium">Equipamento / Modelo</th>
                  <th className="p-4 font-medium">TAG / Patrimônio</th>
                  <th className="p-4 font-medium">Localização</th>
                  <th className="p-4 font-medium text-center">Status</th>
                  <th className="p-4 font-medium w-[150px] text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2E3238]">
                {isLoadingEquips ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-500">Carregando equipamentos...</td></tr>
                ) : equipamentosFiltrados.length === 0 ? (
                  <tr><td colSpan={5} className="p-12 text-center text-gray-500">Nenhum equipamento encontrado com os filtros atuais.</td></tr>
                ) : (
                  equipamentosFiltrados.map(e => (
                    <tr key={e.id} className="hover:bg-[#23262B] transition-colors group">
                      <td className="p-4 cursor-pointer" onClick={() => { setIsCreatingEquip(false); setEquipAberto(e); }}>
                        <div className="font-semibold text-white group-hover:text-[#E4E7EC] transition-colors">{e.nome}</div>
                        <div className="text-xs text-gray-500 mt-0.5">S/N: {e.numero_serie || '-'} {e.modelo ? `| Mod: ${e.modelo}` : ''} {Number(e.valor_locacao) > 0 ? `| ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(e.valor_locacao))}/mês` : ''}</div>
                      </td>
                      <td className="p-4 text-xs font-mono text-gray-300">{e.patrimonio || 'Sem patrimônio'}</td>
                      <td className="p-4 text-xs text-gray-400 flex items-center gap-1.5"><MapPin size={12}/> {e.localizacao || 'Matriz'}</td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs border font-medium ${e.status === 'DISPONIVEL' ? 'bg-green-500/10 text-green-500 border-green-500/20' : e.status === 'LOCADO' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : e.status === 'MANUTENCAO' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                          {e.status === 'MANUTENCAO' ? 'EM MANUTENÇÃO' : e.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        {e.status === 'MANUTENCAO' ? (
                          <button 
                            onClick={(ev) => { 
                              ev.stopPropagation(); 
                              setMaintenanceFilter('tecnico', '');
                              const next = new URLSearchParams(params.toString());
                              next.set('tab', 'manutencoes');
                              router.replace(`/locacao/equipamentos?${next}`);
                              setActiveTab('manutencoes');
                            }}
                            className="text-xs bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded font-medium transition-all inline-flex items-center gap-1.5"
                          >
                            <Wrench size={12}/> Ver OS Ativa
                          </button>
                        ) : (
                          <button 
                            onClick={(ev) => { ev.stopPropagation(); setAbrirOsPara(e); }}
                            className="text-xs bg-[#2E3238] hover:bg-yellow-500/20 hover:text-yellow-400 hover:border-yellow-500/30 text-white px-3 py-1.5 rounded font-sans transition-all border border-[#2E3238] inline-flex items-center gap-1.5"
                          >
                            <Wrench size={12}/> Abrir OS
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'manutencoes' && (
        <div className="space-y-4">
          <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <select 
                value={maintenanceStatus} 
                onChange={event => setMaintenanceFilter('status', event.target.value)} 
                className="bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:ring-1 focus:ring-[#E4E7EC]"
              >
                <option value="">Todos os status</option>
                <option value="ABERTA">Aberta</option>
                <option value="EM_ANDAMENTO">Em andamento</option>
                <option value="CONCLUIDA">Concluída</option>
              </select>
              <select 
                value={maintenanceType} 
                onChange={event => setMaintenanceFilter('tipo', event.target.value)} 
                className="bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:ring-1 focus:ring-[#E4E7EC]"
              >
                <option value="">Todos os tipos</option>
                <option value="PREVENTIVA">Preventiva</option>
                <option value="CORRETIVA">Corretiva</option>
                <option value="CALIBRACAO">Calibração</option>
              </select>
              <input 
                value={maintenanceTechnician} 
                onChange={event => setMaintenanceFilter('tecnico', event.target.value)} 
                placeholder="Filtrar por técnico" 
                className="bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:ring-1 focus:ring-[#E4E7EC]"
              />
            </div>
            <button 
              onClick={() => setAbrirOsPara({ id: '', nome: 'Selecionar Equipamento', modelo: null, numero_serie: null, patrimonio: null, categoria: 'Geral', criticidade: 'Média', status: 'DISPONIVEL', valor_locacao: '0', data_aquisicao: null, localizacao: null })}
              className="bg-[#E4E7EC] text-[#121316] font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-[#D4D8DF] transition-all shadow-[0_0_15px_rgba(228,231,236,0.14)]"
            >
              <Plus size={16}/> Nova Ordem de Serviço
            </button>
          </div>

          <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl overflow-hidden">
            {isMaintenanceError ? (
              <p className="p-8 text-center text-red-400">Não foi possível carregar as ordens de serviço. Verifique a conexão e tente novamente.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#23262B] text-gray-400">
                    <tr>
                      <th className="p-4 text-left font-medium">Equipamento</th>
                      <th className="p-4 text-left font-medium">Tipo</th>
                      <th className="p-4 text-left font-medium">Status</th>
                      <th className="p-4 text-left font-medium">Técnico</th>
                      <th className="p-4 text-left font-medium">Descrição / Sintoma</th>
                      <th className="p-4 text-right font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2E3238]">
                    {isLoadingManutencoes ? (
                      <tr><td colSpan={6} className="p-8 text-center text-gray-500">Carregando ordens de serviço...</td></tr>
                    ) : manutencoes.length ? (
                      manutencoes.map(os => (
                        <tr key={os.id} className="hover:bg-[#23262B]/60 transition-colors">
                          <td className="p-4">
                            <div className="font-semibold text-white">{os.equipamento_nome}</div>
                            {os.equipamento_patrimonio && <div className="text-xs font-mono text-gray-400">TAG: {os.equipamento_patrimonio}</div>}
                          </td>
                          <td className="p-4">
                            <span className="text-xs px-2.5 py-1 rounded bg-[#23262B] text-gray-300 border border-[#2E3238]">
                              {os.tipo_manutencao}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`text-xs px-2.5 py-1 rounded border font-medium ${
                              os.status === 'ABERTA' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                              os.status === 'EM_ANDAMENTO' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                              'bg-green-500/10 text-green-400 border-green-500/30'
                            }`}>
                              {os.status}
                            </span>
                          </td>
                          <td className="p-4 text-gray-300">{os.tecnico_responsavel || '—'}</td>
                          <td className="p-4 text-gray-300 max-w-xs truncate">{os.descricao_problema}</td>
                          <td className="p-4 text-right space-x-2">
                            <button 
                              onClick={() => setOsAberta(os)} 
                              className="text-xs px-3 py-1.5 rounded border border-[#2E3238] hover:bg-[#2E3238] text-gray-300 hover:text-white transition-colors"
                            >
                              Editar
                            </button>
                            {os.status !== 'CONCLUIDA' && (
                              <button 
                                disabled={concluirOsMut.isPending} 
                                onClick={() => concluirOsMut.mutate(os.id!)} 
                                className="text-xs px-3 py-1.5 rounded bg-[#E4E7EC] text-[#121316] font-bold hover:bg-[#D4D8DF] disabled:opacity-50 transition-colors"
                              >
                                Concluir OS
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={6} className="p-12 text-center text-gray-500">Nenhuma ordem de serviço encontrada com os filtros selecionados.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {osAberta && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <form 
            onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              editarOsMut.mutate({
                id: osAberta.id!,
                payload: {
                  tipo_manutencao: data.get('tipo_manutencao') as Manutencao['tipo_manutencao'],
                  status: data.get('status') as Manutencao['status'],
                  tecnico_responsavel: String(data.get('tecnico_responsavel') || ''),
                  descricao_problema: String(data.get('descricao_problema') || '')
                }
              });
            }} 
            className="w-full max-w-lg rounded-xl bg-[#1A1C20] border border-[#2E3238] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex justify-between items-center pb-2 border-b border-[#2E3238]">
              <h2 className="font-bold text-white flex items-center gap-2">
                <Wrench className="text-[#E4E7EC]" size={18} /> Editar OS — {osAberta.equipamento_nome}
              </h2>
              <button type="button" onClick={() => setOsAberta(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Tipo de Manutenção</label>
                <select name="tipo_manutencao" defaultValue={osAberta.tipo_manutencao} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg p-2.5 text-sm text-white">
                  <option value="PREVENTIVA">Preventiva</option>
                  <option value="CORRETIVA">Corretiva</option>
                  <option value="CALIBRACAO">Calibração</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Status da OS</label>
                <select name="status" defaultValue={osAberta.status} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg p-2.5 text-sm text-white font-medium">
                  <option value="ABERTA">Aberta</option>
                  <option value="EM_ANDAMENTO">Em andamento</option>
                  <option value="CONCLUIDA">Concluída (Libera Equipamento)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Técnico Responsável</label>
              <input name="tecnico_responsavel" defaultValue={osAberta.tecnico_responsavel ?? ''} placeholder="Nome do técnico" className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg p-2.5 text-sm text-white" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Descrição / Diagnóstico do Problema</label>
              <textarea required name="descricao_problema" defaultValue={osAberta.descricao_problema} className="w-full min-h-24 bg-[#23262B] border border-[#2E3238] rounded-lg p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-[#E4E7EC]" />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#2E3238]">
              <button type="button" onClick={() => setOsAberta(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
              <button disabled={editarOsMut.isPending} className="bg-[#E4E7EC] text-[#121316] font-bold px-5 py-2 rounded-lg text-sm hover:bg-[#D4D8DF] disabled:opacity-50">
                {editarOsMut.isPending ? 'Salvando…' : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DRAWER DO EQUIPAMENTO (Ficha Completa) */}
      {(equipAberto || isCreatingEquip) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => { setEquipAberto(null); setIsCreatingEquip(false); }} />
          <div className="relative w-full max-w-2xl bg-[#1A1C20] border-l border-[#2E3238] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            <div className="flex items-center justify-between p-6 border-b border-[#2E3238] bg-[#121316]">
              <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                {isCreatingEquip ? <><Settings className="text-[#E4E7EC]"/> Novo Equipamento</> : <><Settings className="text-[#E4E7EC]"/> Ficha do Equipamento</>}
              </h2>
              <button onClick={() => { setEquipAberto(null); setIsCreatingEquip(false); }} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
              <form id="equip-form" ref={equipFormRef} onInput={syncEquipDraft} onChange={syncEquipDraft} onSubmit={handleSalvarEquip} className="space-y-6">
                
                <section>
                  <h3 className="text-xs font-bold text-[#E4E7EC] uppercase tracking-wider mb-3">Identificação e Especificações</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome do Equipamento *</label>
                      <input name="nome" defaultValue={equipAberto?.nome} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" placeholder="Ex: Betoneira 400L Motor Trifásico" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Modelo</label>
                        <input name="modelo" defaultValue={equipAberto?.modelo || ''} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Número de Série (S/N)</label>
                        <input name="numero_serie" defaultValue={equipAberto?.numero_serie || ''} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Patrimônio / TAG Interna</label>
                        <input name="patrimonio" defaultValue={equipAberto?.patrimonio || ''} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none font-mono text-[#E4E7EC]" placeholder="Opcional (gerado automaticamente)" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Categoria</label>
                        <select name="categoria" defaultValue={equipAberto?.categoria || 'Geral'} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none">
                          <option value="Construção">Construção Civil</option>
                          <option value="Solda">Maquinário de Solda</option>
                          <option value="Medição">Equip. de Medição</option>
                          <option value="Veículos">Frota / Veículos</option>
                          <option value="Geral">Geral</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-[#E4E7EC] uppercase tracking-wider mb-3">Operação e Valores</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Data de Aquisição</label>
                      <input name="data_aquisicao" type="date" defaultValue={equipAberto?.data_aquisicao || ''} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none [color-scheme:dark]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Localização / Unidade</label>
                      <input name="localizacao" defaultValue={equipAberto?.localizacao || 'Matriz'} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Valor Mensal de Locação (R$)</label>
                      <input name="valor_locacao" type="number" step="0.01" min="0" defaultValue={equipAberto?.valor_locacao ?? ''} placeholder="0,00" className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Status Atual</label>
                      <select name="status" defaultValue={equipAberto?.status || 'DISPONIVEL'} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none font-bold">
                        <option value="DISPONIVEL">✔ Disponível (Pátio)</option>
                        <option value="LOCADO">▶ Em Uso / Locado</option>
                        <option value="MANUTENCAO">⚠ Em Manutenção</option>
                        <option value="INATIVO">✖ Inativo / Sucateado</option>
                      </select>
                    </div>
                  </div>
                </section>

                {equipAberto && (
                  <section className="bg-[#23262B] border border-[#2E3238] rounded-lg p-5 mt-4">
                    <h4 className="text-xs font-semibold text-gray-400 flex items-center gap-2 mb-4"><Activity size={14}/> Linha do Tempo (Resumo)</h4>
                    <div className="border-l-2 border-[#2E3238] ml-2 pl-4 space-y-4">
                       <div className="relative">
                         <div className="absolute w-3 h-3 bg-[#E4E7EC] rounded-full -left-[23px] top-1"></div>
                         <p className="text-sm text-white font-medium">Equipamento Adquirido</p>
                         <p className="text-xs text-gray-500">O início do ciclo de vida.</p>
                       </div>
                       {equipmentHistory.map(os=><div className="relative" key={os.id}><div className={`absolute w-3 h-3 rounded-full -left-[23px] top-1 ${os.status==='CONCLUIDA'?'bg-green-500':'bg-yellow-500'}`}></div><p className="text-sm text-white font-medium">OS {os.tipo_manutencao} · {os.status}</p><p className="text-xs text-gray-500">{os.descricao_problema} · {os.data_abertura?new Date(os.data_abertura).toLocaleDateString('pt-BR'):''}</p></div>)}
                       {!equipmentHistory.length&&<p className="text-xs text-gray-500">Nenhuma ordem de serviço registrada para este equipamento.</p>}
                    </div>
                  </section>
                )}

              </form>
            </div>
            
            <div className="p-6 border-t border-[#2E3238] bg-[#121316] flex justify-between items-center">
              {isCreatingEquip && hasDraft ? (
                <button type="button" onClick={resetEquipDraft} className="text-xs font-medium text-[#9CA1AA] hover:text-[#F2F3F5] px-3 py-2 rounded-lg border border-[#2E3238]">
                  Limpar rascunho
                </button>
              ) : <div />}
              <div className="flex gap-3">
                <button onClick={() => { setEquipAberto(null); setIsCreatingEquip(false); }} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
                <button type="submit" form="equip-form" disabled={createEquipMut.isPending || updateEquipMut.isPending} className="bg-[#E4E7EC] text-[#121316] px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#D4D8DF] disabled:opacity-50">
                  {createEquipMut.isPending || updateEquipMut.isPending ? 'Salvando...' : 'Salvar Equipamento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ABERTURA DE OS (ORDEM DE SERVIÇO) */}
      {abrirOsPara && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setAbrirOsPara(null)} />
          <div className="relative w-full max-w-lg bg-[#1A1C20] border border-[#2E3238] rounded-xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[#2E3238] bg-yellow-500/10">
              <h2 className="text-lg font-bold flex items-center gap-2 text-yellow-500"><Wrench size={20}/> Abrir Ordem de Serviço (OS)</h2>
              {abrirOsPara.id ? (
                <p className="text-sm text-gray-400 mt-1">Equipamento: <span className="text-white font-mono">{abrirOsPara.patrimonio || abrirOsPara.numero_serie || 'Sem patrimônio'} - {abrirOsPara.nome}</span></p>
              ) : (
                <p className="text-sm text-gray-400 mt-1">Selecione o ativo que passará por manutenção preventiva ou corretiva.</p>
              )}
            </div>
            <div className="p-6">
              <form id="os-form" onSubmit={handleAbrirOS} className="space-y-4">
                {!abrirOsPara.id && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Equipamento *</label>
                    <select name="equipamento_id" required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none font-medium">
                      <option value="">Selecione o equipamento...</option>
                      {equipamentos.filter(e => e.status !== 'INATIVO').map(e => (
                        <option key={e.id} value={e.id}>
                          {e.patrimonio ? `[${e.patrimonio}] ` : ''}{e.nome} {e.numero_serie ? `(S/N: ${e.numero_serie})` : ''} — {e.status === 'MANUTENCAO' ? 'Em Manutenção' : e.status}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Tipo de Manutenção *</label>
                  <select name="tipo_manutencao" required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none font-medium">
                    <option value="PREVENTIVA">Preventiva (Revisão Periódica)</option>
                    <option value="CORRETIVA">Corretiva (Falha/Quebra detectada)</option>
                    <option value="CALIBRACAO">Calibração (Ajuste de Precisão)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Descrição do Sintoma / Problema *</label>
                  <textarea name="descricao_problema" required rows={3} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" placeholder="Relato detalhado do motivo da parada..." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Técnico Responsável (Opcional)</label>
                  <input name="tecnico_responsavel" className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" placeholder="Nome do técnico acionado" />
                </div>
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 flex gap-2 mt-4">
                   <AlertTriangle size={14} className="shrink-0"/>
                   Ao abrir a O.S., o status deste equipamento será alterado automaticamente para "Em Manutenção" e bloqueado para novas locações.
                </div>
              </form>
            </div>
            <div className="p-4 border-t border-[#2E3238] bg-[#121316] rounded-b-xl flex justify-end gap-3">
              <button onClick={() => setAbrirOsPara(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
              <button type="submit" form="os-form" disabled={abrirOsMut.isPending} className="bg-yellow-500 text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-yellow-400 disabled:opacity-50 flex items-center gap-2">
                <CheckCircle2 size={16}/> {abrirOsMut.isPending ? 'Abrindo...' : 'Abrir OS'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

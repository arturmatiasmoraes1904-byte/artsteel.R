'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Settings, X, Activity, AlignLeft, Calendar, GripVertical, CheckSquare, Zap, Target, Trash2, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pagination } from '@/components/Pagination';
import { useTenantStore } from '@/stores/useTenantStore';

type Stage = { id: string; nome: string; cor: string; ordem: number; exige_motivo_retorno: boolean };
type Workflow = { id: string; nome: string; descricao: string; stages: Stage[] };
type Card = {
  id: string;
  titulo: string;
  descricao?: string | null;
  prioridade: string;
  stage_id: string;
  ordem: number;
  valor?: string | number | null;
  cliente_id?: string | null;
  cliente_nome?: string;
  data_entrega?: string | null;
  prazo_etapa?: string | null;
  dados_customizados?: Record<string, any>;
};
type Cliente = { id: string; nome: string };
type PageResponse<T> = { data: T[]; meta: { page: number; limit: number; total: number; totalPages: number } };
type ProductionDashboard = { em_andamento: number; tempo_medio_dias: number; atrasados: number; gargalo: string; gargalo_total: number };

export default function ProducaoPage() {
  const queryClient = useQueryClient();
  const activeTenant = useTenantStore(s => s.activeTenant);
  const params = useSearchParams(), router = useRouter();
  const [activeTab, setActiveTab] = useState<'kanban' | 'dashboard' | 'modelos'>(() =>
    (['kanban', 'dashboard', 'modelos'].includes(params.get('tab') ?? '') ? params.get('tab') : 'kanban') as 'kanban' | 'dashboard' | 'modelos'
  );
  const [workflowId, setWorkflowId] = useState(() => params.get('workflow') ?? '');
  const cardsPage = Number(params.get('page') ?? '1'), cardsLimit = Number(params.get('limit') ?? '50');
  const setCardsPage = (page: number) => { const next = new URLSearchParams(params.toString()); next.set('page', String(page)); router.replace(`/producao?${next}`); };
  const setCardsLimit = (limit: number) => { const next = new URLSearchParams(params.toString()); next.set('limit', String(limit)); next.set('page', '1'); router.replace(`/producao?${next}`); };

  const { data: workflowsResponse, isLoading: loadingWorkflows, isError: workflowsError } = useQuery({
    queryKey: ['producao', 'workflows', activeTenant?.id],
    queryFn: ({ signal }) => api<PageResponse<Workflow>>('/producao/workflows?page=1&limit=50', { signal }),
    staleTime: 30_000,
  });
  const workflows = workflowsResponse?.data ?? [];

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes', activeTenant?.id],
    queryFn: () => api<Cliente[]>('/clientes'),
  });

  useEffect(() => {
    if ((!workflowId || !workflows.some(w => w.id === workflowId)) && workflows[0]) {
      setWorkflowId(workflows[0].id);
    }
  }, [workflowId, workflows]);

  const currentWorkflow = workflows.find(workflow => workflow.id === workflowId) ?? workflows[0];

  const { data: cardsResponse } = useQuery({
    queryKey: ['producao', 'cards', activeTenant?.id, currentWorkflow?.id, cardsPage, cardsLimit],
    queryFn: () => api<PageResponse<Card>>(`/producao/workflows/${currentWorkflow?.id}/cards?page=${cardsPage}&limit=${cardsLimit}`),
    enabled: !!currentWorkflow
  });
  const cards = cardsResponse?.data ?? [];

  const productionDashboard = useQuery({
    queryKey: ['producao', 'dashboard', activeTenant?.id, currentWorkflow?.id],
    queryFn: () => api<ProductionDashboard>(`/producao/dashboard${currentWorkflow ? `?workflow_id=${currentWorkflow.id}` : ''}`),
    enabled: Boolean(currentWorkflow)
  });

  const [draggedCard, setDraggedCard] = useState<Card | null>(null);
  const [draggedOverStage, setDraggedOverStage] = useState<string | null>(null);

  const moverCardMut = useMutation({
    mutationFn: (data: { id: string; stage_id: string; ordem: number }) => api<{ card: Card; concluido: boolean; conta_id: string | null }>(`/producao/cards/${data.id}/mover`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    onSuccess: (res) => {
      setDraggedCard(null);
      setDraggedOverStage(null);
      void queryClient.invalidateQueries({ queryKey: ['producao', 'cards'] });
      void queryClient.invalidateQueries({ queryKey: ['producao', 'dashboard'] });
      if (res?.concluido) {
        void queryClient.invalidateQueries({ queryKey: ['financeiro'] });
        toast.success('Processo concluído!');
      }
    },
    onError: error => {
      setDraggedCard(null);
      setDraggedOverStage(null);
      void queryClient.invalidateQueries({ queryKey: ['producao', 'cards'] });
      toast.error((error as Error).message || 'Não foi possível mover o processo.');
    },
  });

  const createWorkflowMut = useMutation({
    mutationFn: (data: any) => api<Workflow>('/producao/workflows', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'workflows'] });
      if (created?.id) setWorkflowId(created.id);
      toast.success('Novo Processo Criado!');
      setBuilderOpen(false);
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível criar o workflow.'),
  });

  const [novaColunaModal, setNovaColunaModal] = useState(false);
  const [novaColuna, setNovaColuna] = useState({ nome: '', cor: '#3b82f6' });
  const [editingStage, setEditingStage] = useState<Stage | null>(null);

  const createStageMut = useMutation({
    mutationFn: (data: { nome: string; cor: string }) => {
      if (!currentWorkflow?.id) throw new Error('Nenhum workflow selecionado.');
      return api(`/producao/workflows/${currentWorkflow.id}/stages`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'workflows'] });
      setNovaColuna({ nome: '', cor: '#3b82f6' });
      setNovaColunaModal(false);
      toast.success('Nova etapa adicionada ao quadro!');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível criar a etapa.'),
  });

  const updateStageMut = useMutation({
    mutationFn: (data: { id: string; nome: string; cor: string }) => api(`/producao/workflows/${currentWorkflow?.id}/stages/${data.id}`, {
      method: 'PUT', body: JSON.stringify({ nome: data.nome, cor: data.cor }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'workflows'] });
      setEditingStage(null);
      toast.success('Etapa atualizada.');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível atualizar a etapa.'),
  });

  const deleteStageMut = useMutation({
    mutationFn: (stageId: string) => api(`/producao/workflows/${currentWorkflow?.id}/stages/${stageId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'workflows'] });
      toast.success('Etapa excluída.');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível excluir a etapa.'),
  });

  const reorderStagesMut = useMutation({
    mutationFn: (stageIds: string[]) => api(`/producao/workflows/${currentWorkflow?.id}/stages/order`, {
      method: 'PUT', body: JSON.stringify({ stage_ids: stageIds }),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['producao', 'workflows'] }),
    onError: error => toast.error((error as Error).message || 'Não foi possível reordenar as etapas.'),
  });

  const deleteWorkflowMut = useMutation({
    mutationFn: (id: string) => api(`/producao/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'workflows'] });
      setWorkflowId('');
      toast.success('Processo excluído.');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível excluir o processo.'),
  });

  const [builderOpen, setBuilderOpen] = useState(false);
  const [novaEtapaId, setNovaEtapaId] = useState<string | null>(null);
  const [novoCard, setNovoCard] = useState({
    titulo: '',
    descricao: '',
    prioridade: 'NORMAL',
    cliente_id: '',
    valor: '',
    data_entrega: ''
  });
  const [cardAberto, setCardAberto] = useState<Card | null>(null);
  const [novoChecklist, setNovoChecklist] = useState('');

  const createCardMut = useMutation({
    mutationFn: (data: typeof novoCard & { stage_id: string }) => {
      const workflow = currentWorkflow;
      if (!workflow?.id) throw new Error('Selecione ou crie um workflow antes de adicionar um processo.');
      if (!workflow.stages.some(stage => stage.id === data.stage_id)) throw new Error('A etapa selecionada não pertence ao workflow atual.');
      const titulo = data.titulo.trim();
      if (!titulo) throw new Error('Informe um título para o card.');
      return api<Card>('/producao/cards', {
        method: 'POST',
        body: JSON.stringify({
          workflow_id: workflow.id,
          stage_id: data.stage_id,
          titulo,
          descricao: data.descricao.trim() || null,
          prioridade: data.prioridade,
          cliente_id: data.cliente_id || null,
          valor: data.valor ? Number(data.valor) : 0,
          data_entrega: data.data_entrega || null,
        })
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'cards'] });
      void queryClient.invalidateQueries({ queryKey: ['producao', 'dashboard'] });
      setNovoCard({ titulo: '', descricao: '', prioridade: 'NORMAL', cliente_id: '', valor: '', data_entrega: '' });
      setNovaEtapaId(null);
      toast.success('Processo criado no quadro.');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível criar o processo.')
  });

  const checklist = useQuery({
    queryKey: ['producao', 'checklist', cardAberto?.id],
    queryFn: () => api<{ id: string; descricao: string; concluido: boolean }[]>(`/producao/cards/${cardAberto?.id}/checklist`),
    enabled: Boolean(cardAberto)
  });

  const editCard = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, any> }) =>
      api<Card>(`/producao/cards/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'cards'] });
      void queryClient.invalidateQueries({ queryKey: ['producao', 'dashboard'] });
      if (updated) setCardAberto(prev => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
      toast.success('Card atualizado.');
    },
    onError: e => toast.error((e as Error).message)
  });

  const archiveCard = useMutation({
    mutationFn: (id: string) => api(`/producao/cards/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['producao', 'cards'] });
      void queryClient.invalidateQueries({ queryKey: ['producao', 'dashboard'] });
      setCardAberto(null);
      toast.success('Processo excluído do quadro e preservado no histórico.');
    },
    onError: e => toast.error((e as Error).message || 'Não foi possível arquivar o processo.')
  });

  const toggleChecklist = useMutation({
    mutationFn: ({ id, concluido }: { id: string; concluido: boolean }) =>
      api(`/producao/cards/${cardAberto?.id}/checklist/${id}`, { method: 'PUT', body: JSON.stringify({ concluido }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['producao', 'checklist', cardAberto?.id] })
  });

  const addChecklist = useMutation({
    mutationFn: (descricao: string) =>
      api(`/producao/cards/${cardAberto?.id}/checklist`, { method: 'POST', body: JSON.stringify({ descricao }) }),
    onSuccess: () => {
      setNovoChecklist('');
      void queryClient.invalidateQueries({ queryKey: ['producao', 'checklist', cardAberto?.id] });
    }
  });

  const handleDragStart = (card: Card) => setDraggedCard(card);
  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDraggedOverStage(stageId);
  };
  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDraggedOverStage(null);
    if (!draggedCard || draggedCard.stage_id === stageId || moverCardMut.isPending) return;
    moverCardMut.mutate({ id: draggedCard.id, stage_id: stageId, ordem: 0 });
  };

  const handleCriarWorkflow = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createWorkflowMut.mutate({
      nome: formData.get('nome'),
      descricao: formData.get('descricao'),
      stages: [
        { nome: 'A Fazer', cor: '#ef4444' },
        { nome: 'Em Andamento', cor: '#eab308' },
        { nome: 'Aguardando Aprovação', cor: '#3b82f6' },
        { nome: 'Concluído', cor: '#22c55e' }
      ]
    });
  };

  const handleCriarCard = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!novaEtapaId || createCardMut.isPending) return;
    createCardMut.mutate({ stage_id: novaEtapaId, ...novoCard });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white animate-in fade-in duration-300 overflow-hidden relative">
      {/* HEADER */}
      <div className="flex justify-between items-center px-6 py-4 border-b border-[#2a2a2a] bg-[#141414]">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Target className="text-[#b0fb5d]" size={24} /> Workflows de Produção
          </h1>
          <div className="flex gap-4 mt-2">
            {[
              { id: 'dashboard', label: 'Métricas' },
              { id: 'kanban', label: 'Quadro Kanban' },
              { id: 'modelos', label: 'Construtor de Processos' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { const next = new URLSearchParams(params.toString()); next.set('tab', tab.id); router.replace(`/producao?${next}`); setActiveTab(tab.id as any); }}
                className={`text-xs font-semibold uppercase tracking-wider pb-1 border-b-2 transition-all ${activeTab === tab.id ? 'border-[#b0fb5d] text-[#b0fb5d]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <select
            value={currentWorkflow?.id ?? ''}
            onChange={event => { const next = new URLSearchParams(params.toString()); next.set('workflow', event.target.value); next.set('page', '1'); router.replace(`/producao?${next}`); setWorkflowId(event.target.value); }}
            className="bg-[#1a1a1a] border border-[#2a2a2a] text-sm rounded-md px-3 py-1.5 outline-none focus:ring-1 focus:ring-[#b0fb5d]"
          >
            {workflows.map(w => <option key={w.id} value={w.id}>{w.nome}</option>)}
          </select>
          <button
            onClick={() => setBuilderOpen(true)}
            className="flex items-center gap-2 text-sm px-4 py-2 bg-[#b0fb5d] text-black font-bold rounded-md hover:bg-[#9de44f] transition-all"
          >
            <Settings size={16} /> Configurar Processo
          </button>
        </div>
      </div>

      {activeTab === 'kanban' && <>
        <div className="flex-1 overflow-x-auto no-scrollbar p-6 bg-[#0a0a0a] flex gap-4 items-start">
          {loadingWorkflows && <div className="text-gray-500 text-sm">Carregando processos...</div>}
          {workflowsError && <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">Não foi possível carregar os workflows. Recarregue a página e tente novamente.</div>}

          {!currentWorkflow && !loadingWorkflows && (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-500">
              <Activity size={48} className="mb-4 opacity-30" />
              <p>Você ainda não criou nenhum Workflow de Produção.</p>
              <button onClick={() => setBuilderOpen(true)} className="mt-4 px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-white hover:border-[#b0fb5d]">Criar Primeiro Processo</button>
            </div>
          )}

          {currentWorkflow?.stages.map((stage) => {
            const stageCards = cards.filter(c => c.stage_id === stage.id);
            const isHovered = draggedOverStage === stage.id;

            return (
              <div
                key={stage.id}
                className={`flex-shrink-0 w-80 bg-[#141414] rounded-xl border-2 transition-colors flex flex-col max-h-full ${isHovered ? 'border-[#b0fb5d]/50 bg-[#b0fb5d]/5' : 'border-[#2a2a2a]'}`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {/* Stage Header */}
                <div className="p-4 flex justify-between items-center border-b border-[#2a2a2a] group hover:bg-[#1a1a1a] rounded-t-xl transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.cor }}></div>
                    <h3 className="font-bold text-sm text-gray-200">{stage.nome}</h3>
                    <span className="text-[10px] bg-[#2a2a2a] text-gray-400 px-2 py-0.5 rounded-full">{stageCards.length}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" title="Editar etapa" onClick={() => setEditingStage(stage)} className="p-1 text-gray-500 hover:text-[#b0fb5d]" aria-label={`Editar etapa ${stage.nome}`}><Pencil size={14} /></button>
                    <button type="button" title="Mover etapa para a esquerda" disabled={stage.ordem === 0 || reorderStagesMut.isPending} onClick={() => {
                      const ordered = [...currentWorkflow.stages].sort((a, b) => a.ordem - b.ordem);
                      const index = ordered.findIndex(item => item.id === stage.id);
                      [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
                      reorderStagesMut.mutate(ordered.map(item => item.id));
                    }} className="p-1 text-gray-500 hover:text-white disabled:opacity-30" aria-label="Mover etapa para a esquerda"><ChevronLeft size={15} /></button>
                    <button type="button" title="Mover etapa para a direita" disabled={stage.ordem === currentWorkflow.stages.length - 1 || reorderStagesMut.isPending} onClick={() => {
                      const ordered = [...currentWorkflow.stages].sort((a, b) => a.ordem - b.ordem);
                      const index = ordered.findIndex(item => item.id === stage.id);
                      [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
                      reorderStagesMut.mutate(ordered.map(item => item.id));
                    }} className="p-1 text-gray-500 hover:text-white disabled:opacity-30" aria-label="Mover etapa para a direita"><ChevronRight size={15} /></button>
                    <button type="button" title="Excluir etapa" disabled={deleteStageMut.isPending} onClick={() => {
                      if (window.confirm(`Excluir a etapa “${stage.nome}”? Ela só pode ser removida se estiver vazia.`)) deleteStageMut.mutate(stage.id);
                    }} className="p-1 text-gray-500 hover:text-red-400 disabled:opacity-30" aria-label={`Excluir etapa ${stage.nome}`}><Trash2 size={14} /></button>
                  </div>
                </div>

                {/* Cards Container */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 no-scrollbar min-h-[150px]">
                  {stageCards.map(card => (
                    <div
                      key={card.id}
                      draggable
                      onDragStart={() => handleDragStart(card)}
                      onClick={() => setCardAberto(card)}
                      className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-[#4a4a4a] transition-all hover:shadow-lg relative group"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${card.prioridade === 'URGENTE' ? 'bg-red-500/20 text-red-500' : card.prioridade === 'ALTA' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-gray-500/20 text-gray-400'}`}>
                          {card.prioridade}
                        </span>
                        {card.data_entrega && <span className="text-[10px] text-gray-500 flex items-center gap-1"><Calendar size={10} /> {new Date(card.data_entrega).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>}
                      </div>
                      <h4 className="text-sm font-semibold text-white leading-tight mb-2">{card.titulo}</h4>
                      {card.cliente_nome && <p className="text-xs text-gray-400 mb-2 line-clamp-1">{card.cliente_nome}</p>}
                      {Number(card.valor ?? 0) > 0 && (
                        <p className="text-xs font-mono text-[#b0fb5d] mb-2">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(card.valor))}
                        </p>
                      )}
                      <div className="flex items-center justify-between pt-2 border-t border-[#2a2a2a]">
                        <div className="flex gap-2 text-gray-500">
                          <AlignLeft size={14} className="hover:text-white transition-colors" />
                          <CheckSquare size={14} className="hover:text-[#b0fb5d] transition-colors" />
                        </div>
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 border-2 border-[#1e1e1e]"></div>
                      </div>
                    </div>
                  ))}
                  {stageCards.length === 0 && <div className="text-center p-4 border-2 border-dashed border-[#2a2a2a] rounded-lg text-xs text-gray-600">Arraste cards para cá</div>}
                </div>

                {/* Add Card Button */}
                <div className="p-3 border-t border-[#2a2a2a]">
                  <button
                    type="button"
                    onClick={() => {
                      setNovoCard({ titulo: '', descricao: '', prioridade: 'NORMAL', cliente_id: '', valor: '', data_entrega: '' });
                      setNovaEtapaId(stage.id);
                    }}
                    className="flex items-center gap-2 text-sm text-gray-500 hover:text-white hover:bg-[#2a2a2a] w-full py-2 px-3 rounded-lg transition-colors"
                  >
                    <Plus size={16} /> Adicionar Processo
                  </button>
                </div>
              </div>
            );
          })}

          {currentWorkflow && (
            <button
              type="button"
              onClick={() => setNovaColunaModal(true)}
              className="flex-shrink-0 w-80 h-16 bg-transparent border-2 border-dashed border-[#2a2a2a] hover:border-[#b0fb5d] rounded-xl flex items-center justify-center cursor-pointer transition-colors opacity-60 hover:opacity-100 group"
            >
              <span className="text-gray-400 font-bold text-sm flex items-center gap-2 group-hover:text-[#b0fb5d]"><Plus size={18} /> Nova Etapa</span>
            </button>
          )}
        </div>
        <Pagination meta={cardsResponse?.meta} onPage={setCardsPage} onLimit={setCardsLimit} />
      </>}

      {activeTab === 'dashboard' && (
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#141414] border border-[#2a2a2a] p-5 rounded-xl">
              <span className="text-xs text-gray-500 uppercase font-bold">Processos em Andamento</span>
              <div className="text-3xl font-black mt-2 text-white">{productionDashboard.isLoading ? '…' : productionDashboard.data?.em_andamento ?? 0}</div>
            </div>
            <div className="bg-[#141414] border border-[#2a2a2a] p-5 rounded-xl">
              <span className="text-xs text-gray-500 uppercase font-bold">Tempo médio em produção</span>
              <div className="text-3xl font-black mt-2 text-[#b0fb5d]">{productionDashboard.isLoading ? '…' : `${productionDashboard.data?.tempo_medio_dias ?? 0} dias`}</div>
            </div>
            <div className="bg-[#141414] border border-[#2a2a2a] p-5 rounded-xl border-t-2 border-t-red-500">
              <span className="text-xs text-red-500 uppercase font-bold">Gargalo Atual</span>
              <div className="text-lg font-bold mt-2 text-white">{productionDashboard.isLoading ? '…' : `${productionDashboard.data?.gargalo ?? 'Sem cards'} (${productionDashboard.data?.gargalo_total ?? 0})`}</div>
            </div>
            <div className="bg-[#141414] border border-[#2a2a2a] p-5 rounded-xl">
              <span className="text-xs text-gray-500 uppercase font-bold">Atrasados</span>
              <div className="text-3xl font-black mt-2 text-yellow-500">{productionDashboard.isLoading ? '…' : productionDashboard.data?.atrasados ?? 0}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'modelos' && (
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Pipelines & Fluxos de Produção</h2>
              <p className="text-xs text-gray-400">Gerencie os modelos de etapas utilizados pela sua equipe.</p>
            </div>
            <button
              onClick={() => setBuilderOpen(true)}
              className="flex items-center gap-2 text-sm px-4 py-2 bg-[#b0fb5d] text-black font-bold rounded-md hover:bg-[#9de44f] transition-all"
            >
              <Plus size={16} /> Novo Workflow
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workflows.map(wf => (
              <div key={wf.id} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-5 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-white">{wf.nome}</h3>
                    <p className="text-xs text-gray-400 mt-1">{wf.descricao || 'Sem descrição'}</p>
                  </div>
                  <button
                    onClick={() => { setWorkflowId(wf.id); setActiveTab('kanban'); }}
                    className="text-xs text-[#b0fb5d] hover:underline font-semibold"
                  >
                    Abrir Quadro →
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {wf.stages.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1.5 text-xs bg-[#1e1e1e] border border-[#2a2a2a] px-2.5 py-1 rounded-full">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.cor }} />
                      {s.nome}
                    </span>
                  ))}
                </div>
                <div className="flex justify-end border-t border-[#2a2a2a] pt-3">
                  <button
                    type="button"
                    disabled={deleteWorkflowMut.isPending}
                    onClick={() => {
                      if (window.confirm(`Excluir o processo “${wf.nome}”? Os cards ativos precisam ser arquivados primeiro.`)) deleteWorkflowMut.mutate(wf.id);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  ><Trash2 size={13} /> Excluir processo</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL NOVO CARD */}
      {novaEtapaId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <form onSubmit={handleCriarCard} className="w-full max-w-lg rounded-xl bg-[#141414] border border-[#2a2a2a] p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-white">Novo card de produção</h2>
              <button type="button" onClick={() => setNovaEtapaId(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Título do processo *</label>
              <input
                required
                autoFocus
                value={novoCard.titulo}
                onChange={event => setNovoCard(card => ({ ...card, titulo: event.target.value }))}
                placeholder="Ex: Portão basculante 4x2,5m"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded p-3 text-sm text-white outline-none focus:border-[#b0fb5d]"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Descrição / Especificações</label>
              <textarea
                value={novoCard.descricao}
                onChange={event => setNovoCard(card => ({ ...card, descricao: event.target.value }))}
                placeholder="Medidas, especificações de material, pintura..."
                className="w-full min-h-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded p-3 text-sm text-white outline-none focus:border-[#b0fb5d]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cliente (Opcional)</label>
                <select
                  value={novoCard.cliente_id}
                  onChange={event => setNovoCard(card => ({ ...card, cliente_id: event.target.value }))}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded p-2.5 text-sm text-white outline-none focus:border-[#b0fb5d]"
                >
                  <option value="">-- Sem cliente vinculado --</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Prioridade</label>
                <select
                  value={novoCard.prioridade}
                  onChange={event => setNovoCard(card => ({ ...card, prioridade: event.target.value }))}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded p-2.5 text-sm text-white outline-none focus:border-[#b0fb5d]"
                >
                  <option value="BAIXA">Baixa</option>
                  <option value="NORMAL">Normal</option>
                  <option value="ALTA">Alta</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Valor do Serviço (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={novoCard.valor}
                  onChange={event => setNovoCard(card => ({ ...card, valor: event.target.value }))}
                  placeholder="0,00"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded p-2.5 text-sm text-white outline-none focus:border-[#b0fb5d]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Previsão de Entrega</label>
                <input
                  type="date"
                  value={novoCard.data_entrega}
                  onChange={event => setNovoCard(card => ({ ...card, data_entrega: event.target.value }))}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded p-2.5 text-sm text-white outline-none focus:border-[#b0fb5d] [color-scheme:dark]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setNovaEtapaId(null)} className="bg-[#2a2a2a] text-white font-bold px-4 py-2 rounded text-sm">Cancelar</button>
              <button type="submit" disabled={createCardMut.isPending || !novoCard.titulo.trim()} className="bg-[#b0fb5d] text-black font-bold px-5 py-2 rounded text-sm disabled:opacity-50">
                {createCardMut.isPending ? 'Criando…' : 'Criar card'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL NOVA ETAPA */}
      {novaColunaModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <form
            onSubmit={e => {
              e.preventDefault();
              if (!novaColuna.nome.trim() || createStageMut.isPending) return;
              createStageMut.mutate(novaColuna);
            }}
            className="w-full max-w-md rounded-xl bg-[#141414] border border-[#2a2a2a] p-6 space-y-4"
          >
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-white">Nova Etapa do Quadro</h2>
              <button type="button" onClick={() => setNovaColunaModal(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome da Etapa *</label>
              <input
                required
                autoFocus
                value={novaColuna.nome}
                onChange={e => setNovaColuna(s => ({ ...s, nome: e.target.value }))}
                placeholder="Ex: Galvanização / Instalação"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded p-3 text-sm text-white outline-none focus:border-[#b0fb5d]"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cor de Identificação</label>
              <input
                type="color"
                value={novaColuna.cor}
                onChange={e => setNovaColuna(s => ({ ...s, cor: e.target.value }))}
                className="w-full h-10 bg-[#1a1a1a] border border-[#2a2a2a] rounded p-1 cursor-pointer"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setNovaColunaModal(false)} className="bg-[#2a2a2a] text-white font-bold px-4 py-2 rounded text-sm">Cancelar</button>
              <button type="submit" disabled={createStageMut.isPending || !novaColuna.nome.trim()} className="bg-[#b0fb5d] text-black font-bold px-5 py-2 rounded text-sm disabled:opacity-50">
                {createStageMut.isPending ? 'Adicionando…' : 'Adicionar Etapa'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingStage && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <form onSubmit={event => {
            event.preventDefault();
            if (editingStage.nome.trim()) updateStageMut.mutate({ id: editingStage.id, nome: editingStage.nome.trim(), cor: editingStage.cor });
          }} className="w-full max-w-md rounded-xl bg-[#141414] border border-[#2a2a2a] p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-white">Personalizar etapa</h2>
              <button type="button" onClick={() => setEditingStage(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome da etapa *</label>
              <input required maxLength={120} value={editingStage.nome} onChange={event => setEditingStage({ ...editingStage, nome: event.target.value })} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded p-3 text-sm text-white outline-none focus:border-[#b0fb5d]" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cor</label>
              <input type="color" value={editingStage.cor || '#3b82f6'} onChange={event => setEditingStage({ ...editingStage, cor: event.target.value })} className="w-full h-10 bg-[#1a1a1a] border border-[#2a2a2a] rounded p-1 cursor-pointer" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditingStage(null)} className="bg-[#2a2a2a] text-white px-4 py-2 rounded text-sm">Cancelar</button>
              <button type="submit" disabled={updateStageMut.isPending || !editingStage.nome.trim()} className="bg-[#b0fb5d] text-black font-bold px-5 py-2 rounded text-sm disabled:opacity-50">{updateStageMut.isPending ? 'Salvando…' : 'Salvar etapa'}</button>
            </div>
          </form>
        </div>
      )}

      {/* WORKFLOW BUILDER DRAWER */}
      {builderOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in" onClick={() => setBuilderOpen(false)} />
          <div className="relative w-full max-w-md bg-[#141414] border-l border-[#2a2a2a] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            <div className="p-6 border-b border-[#2a2a2a] flex justify-between items-center bg-[#0a0a0a]">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Settings size={18} className="text-[#b0fb5d]" /> Setup do Workflow</h2>
              <button onClick={() => setBuilderOpen(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <form id="workflow-form" onSubmit={handleCriarWorkflow}>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Nome do Processo *</label>
                  <input name="nome" required className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" placeholder="Ex: Produção de Estruturas Metálicas" />
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Descrição / Regras</label>
                  <textarea name="descricao" rows={3} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" placeholder="Este processo rege a entrada de material bruto..." />
                </div>
                <div className="mt-8 border-t border-[#2a2a2a] pt-6">
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><AlignLeft size={16} className="text-blue-500" /> Etapas (Colunas) Iniciais</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 bg-[#1a1a1a] p-3 rounded border border-[#2a2a2a]">
                      <GripVertical size={16} className="text-gray-600 cursor-grab" />
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span className="text-sm font-medium">A Fazer (Inbox)</span>
                    </div>
                    <div className="flex items-center gap-3 bg-[#1a1a1a] p-3 rounded border border-[#2a2a2a]">
                      <GripVertical size={16} className="text-gray-600 cursor-grab" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                      <span className="text-sm font-medium">Em Andamento</span>
                    </div>
                    <div className="flex items-center gap-3 bg-[#1a1a1a] p-3 rounded border border-[#2a2a2a]">
                      <GripVertical size={16} className="text-gray-600 cursor-grab" />
                      <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                      <span className="text-sm font-medium">Aguardando Aprovação</span>
                    </div>
                    <div className="flex items-center gap-3 bg-[#1a1a1a] p-3 rounded border border-[#2a2a2a]">
                      <GripVertical size={16} className="text-gray-600 cursor-grab" />
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <span className="text-sm font-medium">Concluído</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-4">Você poderá adicionar mais colunas diretamente no quadro após a criação inicial.</p>
                </div>
              </form>
            </div>
            <div className="p-6 border-t border-[#2a2a2a] bg-[#0a0a0a]">
              <button type="submit" form="workflow-form" disabled={createWorkflowMut.isPending} className="w-full bg-[#b0fb5d] text-black font-bold py-3 rounded hover:bg-[#9de44f] transition-colors disabled:opacity-50">
                {createWorkflowMut.isPending ? 'Criando...' : 'Criar Pipeline Kanban'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CARD DETAIL DRAWER */}
      {cardAberto && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setCardAberto(null)} />
          <div className="relative w-full max-w-3xl bg-[#141414] border-l border-[#2a2a2a] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a] bg-[#0a0a0a]">
              <div className="flex items-center gap-3 flex-1">
                <span className="text-xs font-mono bg-[#2a2a2a] text-gray-400 px-2 py-1 rounded">#{cardAberto.id.split('-')[0].toUpperCase()}</span>
                <input
                  key={cardAberto.id}
                  defaultValue={cardAberto.titulo}
                  onBlur={e => {
                    const nextTitle = e.target.value.trim();
                    if (nextTitle && nextTitle !== cardAberto.titulo) {
                      editCard.mutate({ id: cardAberto.id, payload: { titulo: nextTitle } });
                    }
                  }}
                  className="text-lg font-bold text-white bg-transparent outline-none border-b border-transparent focus:border-[#b0fb5d] flex-1"
                />
              </div>
              <button onClick={() => setCardAberto(null)} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col md:flex-row">
              <div className="flex-1 p-8 space-y-8">
                <div>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Descrição da Tarefa</h3>
                  <textarea
                    key={`desc-${cardAberto.id}`}
                    defaultValue={cardAberto.descricao ?? ''}
                    onBlur={e => {
                      if (e.target.value !== (cardAberto.descricao ?? '')) {
                        editCard.mutate({ id: cardAberto.id, payload: { descricao: e.target.value } });
                      }
                    }}
                    className="w-full min-h-28 bg-[#1a1a1a] border border-[#2a2a2a] p-4 rounded text-sm text-gray-300 outline-none focus:border-[#b0fb5d]"
                    placeholder="Sem descrição"
                  />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2"><Zap size={14} className="text-yellow-500" /> Checklist de Execução (SLA)</h3>
                  <div className="space-y-2">
                    {checklist.data?.map(item => (
                      <label key={item.id} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={item.concluido}
                          onChange={e => toggleChecklist.mutate({ id: item.id, concluido: e.target.checked })}
                          className="accent-[#b0fb5d] w-4 h-4"
                        />
                        <span className={`text-sm text-gray-300 group-hover:text-white ${item.concluido ? 'line-through opacity-50' : ''}`}>
                          {item.descricao}
                        </span>
                      </label>
                    ))}
                    <form
                      onSubmit={e => {
                        e.preventDefault();
                        if (novoChecklist.trim()) addChecklist.mutate(novoChecklist.trim());
                      }}
                      className="flex gap-2 pt-2"
                    >
                      <input
                        value={novoChecklist}
                        onChange={e => setNovoChecklist(e.target.value)}
                        placeholder="Adicionar item ao checklist..."
                        className="min-w-0 flex-1 bg-[#242424] border border-[#333] rounded px-3 py-1.5 text-xs text-white outline-none focus:border-[#b0fb5d]"
                      />
                      <button type="submit" className="text-xs font-semibold text-[#b0fb5d] px-2">Adicionar</button>
                    </form>
                  </div>
                </div>
              </div>
              <div className="w-full md:w-64 border-t md:border-t-0 md:border-l border-[#2a2a2a] bg-[#1a1a1a] p-6 space-y-6">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Prioridade</span>
                  <select
                    value={cardAberto.prioridade}
                    onChange={e => {
                      const prio = e.target.value;
                      setCardAberto({ ...cardAberto, prioridade: prio });
                      editCard.mutate({ id: cardAberto.id, payload: { prioridade: prio } });
                    }}
                    className="w-full mt-2 bg-[#2a2a2a] text-white text-sm px-3 py-2 rounded outline-none border border-[#3a3a3a] focus:border-[#b0fb5d]"
                  >
                    <option value="BAIXA">BAIXA</option>
                    <option value="NORMAL">NORMAL</option>
                    <option value="ALTA">ALTA</option>
                    <option value="URGENTE">URGENTE</option>
                  </select>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Prazo da etapa</span>
                  <input
                    type="datetime-local"
                    defaultValue={cardAberto.prazo_etapa ? cardAberto.prazo_etapa.slice(0, 16) : ''}
                    onChange={e => {
                      const iso = e.target.value ? new Date(e.target.value).toISOString() : null;
                      setCardAberto({ ...cardAberto, prazo_etapa: iso });
                      editCard.mutate({ id: cardAberto.id, payload: { prazo_etapa: iso } });
                    }}
                    className="w-full mt-2 bg-[#2a2a2a] text-white text-sm px-3 py-2 rounded [color-scheme:dark]"
                  />
                  {cardAberto.prazo_etapa && new Date(cardAberto.prazo_etapa) < new Date() && (
                    <p className="text-xs text-red-400 mt-2">SLA atrasado</p>
                  )}
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Etapa Atual</span>
                  <select
                    value={cardAberto.stage_id}
                    onChange={event => {
                      const stageId = event.target.value;
                      setCardAberto({ ...cardAberto, stage_id: stageId });
                      moverCardMut.mutate({ id: cardAberto.id, stage_id: stageId, ordem: 0 });
                    }}
                    className="w-full mt-2 bg-[#2a2a2a] text-white text-sm px-3 py-2 rounded outline-none border border-[#3a3a3a] focus:border-[#b0fb5d]"
                  >
                    {currentWorkflow?.stages.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </div>
                <button
                  disabled={archiveCard.isPending}
                  onClick={() => {
                    if (window.confirm('Excluir este processo do quadro? Ele será removido da visualização e preservado no histórico.')) {
                      archiveCard.mutate(cardAberto.id);
                    }
                  }}
                  className="w-full bg-[#2a2a2a] hover:bg-red-500/20 hover:text-red-500 text-white text-sm font-medium py-2 rounded transition-colors disabled:opacity-50"
                >
                  {archiveCard.isPending ? 'Excluindo…' : 'Excluir processo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

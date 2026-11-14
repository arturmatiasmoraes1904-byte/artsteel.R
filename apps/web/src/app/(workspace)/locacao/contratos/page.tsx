'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Plus, FileText, RefreshCw, FileSignature, X, CalendarDays, Receipt } from 'lucide-react';
import { useTenantStore } from '@/stores/useTenantStore';
import { useFormDraft } from '@/hooks/useFormDraft';
import { toast } from 'sonner';

type Cliente = { id: string; nome: string; documento: string };
type Equipamento = { id: string; nome: string; valor_locacao: string; patrimonio: string; status: string };

type Contrato = {
  id: string;
  cliente_id: string;
  cliente_nome?: string;
  data_inicio: string;
  data_fim_prevista?: string | null;
  renovacao_automatica?: boolean | null;
  ciclos_cobrados?: number | null;
  proximo_vencimento?: string | null;
  valor_total: string;
  periodicidade: string;
  status: 'RASCUNHO' | 'ATIVO' | 'ENCERRADO' | 'CANCELADO';
  created_at: string;
};

type CreateContratoPayload = {
  cliente_id: string;
  data_inicio: string;
  data_fim_prevista?: string | null;
  renovacao_automatica: boolean;
  valor_total?: number;
  periodicidade: 'MENSAL';
  status: 'ATIVO' | 'RASCUNHO';
  equipamento_ids: string[];
};

type ContratoDraft = {
  cliente_id: string;
  data_inicio: string;
  valor_total: string;
  status: 'ATIVO' | 'RASCUNHO';
  ativosSelecionados: string[];
};

const todayInput = () => new Date().toISOString().split('T')[0];

export default function ContratosPage() {
  const queryClient = useQueryClient();
  const { activeTenant } = useTenantStore();
  const [busca, setBusca] = useState('');
  
  // Modals / Drawers
  const [isCreating, setIsCreating] = useState(false);
  const [contratoAberto, setContratoAberto] = useState<Contrato | null>(null);
  const [buscaAtivo, setBuscaAtivo] = useState('');
  const [ativosSelecionados, setAtivosSelecionados] = useState<string[]>([]);
  const [valorMensal, setValorMensal] = useState('');
  const [valorEditadoManual, setValorEditadoManual] = useState(false);
  const contratoFormRef = useRef<HTMLFormElement>(null);
  const { loadDraft, saveDraft, clearDraft, hasDraft } = useFormDraft<ContratoDraft>(
    `contrato:${activeTenant?.id ?? 'default'}`,
    isCreating && !contratoAberto
  );

  // Queries
  const { data: dashboard, isLoading: isLoadingDash } = useQuery({
    queryKey: ['contratos', 'dashboard'],
    queryFn: () => api<any>('/locacao/contratos/dashboard')
  });

  const { data: contratos = [], isLoading: isLoadingContratos } = useQuery({
    queryKey: ['contratos', 'lista'],
    queryFn: () => api<Contrato[]>('/locacao/contratos')
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => api<Cliente[]>('/clientes')
  });

  const { data: equipamentos = [] } = useQuery({
    queryKey: ['equipamentos'],
    queryFn: () => api<Equipamento[]>('/locacao/equipamentos')
  });

  // Filtros
  const contratosFiltrados = useMemo(() => {
    if (!busca) return contratos;
    const termo = busca.toLowerCase();
    return contratos.filter(c => c.cliente_nome?.toLowerCase().includes(termo));
  }, [contratos, busca]);
  const equipamentosDisponiveis = useMemo(() => equipamentos.filter(eq => eq.status === 'DISPONIVEL'), [equipamentos]);
  const equipamentosVisiveis = useMemo(() => {
    const termo = buscaAtivo.trim().toLowerCase();
    if (!termo) return equipamentosDisponiveis;
    return equipamentosDisponiveis.filter(eq => [eq.nome, eq.patrimonio].some(value => value?.toLowerCase().includes(termo)));
  }, [equipamentosDisponiveis, buscaAtivo]);

  // Utils
  const formatCurrency = (v: number | string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
  const formatDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';

  const somaEquipamentosSelecionados = useMemo(
    () => ativosSelecionados.reduce((sum, id) => {
      const item = equipamentos.find(e => e.id === id);
      return sum + (item ? Number(item.valor_locacao || 0) : 0);
    }, 0),
    [ativosSelecionados, equipamentos]
  );

  useEffect(() => {
    if (!isCreating || contratoAberto || valorEditadoManual) return;
    setValorMensal(ativosSelecionados.length > 0 ? somaEquipamentosSelecionados.toFixed(2) : '');
  }, [ativosSelecionados, somaEquipamentosSelecionados, isCreating, contratoAberto, valorEditadoManual]);

  const syncDraft = (overrides?: Partial<ContratoDraft>) => {
    if (!isCreating || contratoAberto || !contratoFormRef.current) return;
    const fd = new FormData(contratoFormRef.current);
    saveDraft({
      cliente_id: overrides?.cliente_id ?? String(fd.get('cliente_id') ?? ''),
      data_inicio: overrides?.data_inicio ?? String(fd.get('data_inicio') ?? todayInput()),
      valor_total: overrides?.valor_total ?? valorMensal,
      status: (overrides?.status ?? (String(fd.get('status') || 'ATIVO') as 'ATIVO' | 'RASCUNHO')),
      ativosSelecionados: overrides?.ativosSelecionados ?? ativosSelecionados,
    });
  };

  const resetContratoDraft = () => {
    clearDraft();
    setAtivosSelecionados([]);
    setValorEditadoManual(false);
    setValorMensal('');
    if (contratoFormRef.current) {
      contratoFormRef.current.reset();
      const di = contratoFormRef.current.elements.namedItem('data_inicio') as HTMLInputElement | null;
      if (di) di.value = todayInput();
    }
  };

  useEffect(() => {
    if (!isCreating || contratoAberto) return;
    const draft = loadDraft();
    setValorEditadoManual(Boolean(draft?.valor_total));
    setAtivosSelecionados(Array.isArray(draft?.ativosSelecionados) ? draft.ativosSelecionados : []);
    setValorMensal(draft?.valor_total ?? '');
    requestAnimationFrame(() => {
      if (!contratoFormRef.current) return;
      contratoFormRef.current.reset();
      const di = contratoFormRef.current.elements.namedItem('data_inicio') as HTMLInputElement | null;
      const cl = contratoFormRef.current.elements.namedItem('cliente_id') as HTMLSelectElement | null;
      const st = contratoFormRef.current.elements.namedItem('status') as HTMLSelectElement | null;
      if (di) di.value = draft?.data_inicio || todayInput();
      if (cl && draft?.cliente_id) cl.value = draft.cliente_id;
      if (st && draft?.status) st.value = draft.status;
    });
  }, [isCreating, contratoAberto, activeTenant?.id]);

  // Mutações
  const createContratoMut = useMutation({
    mutationFn: (data: CreateContratoPayload) => api('/locacao/contratos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contratos'] });
      queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
      queryClient.invalidateQueries({ queryKey: ['financeiro'] });
      clearDraft();
      setIsCreating(false);
      toast.success('Contrato salvo com renovação mensal automática!');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível salvar o contrato.')
  });

  const encerraContratoMut = useMutation({
    mutationFn: (id: string) => api(`/locacao/contratos/${id}/encerrar`, { method: 'PUT' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contratos'] });
      queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
      setContratoAberto(null);
      toast.success('Contrato encerrado e equipamentos liberados!');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível devolver os itens do contrato.')
  });

  const excluiContratoMut = useMutation({
    mutationFn: (id: string) => api(`/locacao/contratos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contratos'] });
      queryClient.invalidateQueries({ queryKey: ['equipamentos'] });
      queryClient.invalidateQueries({ queryKey: ['financeiro'] });
      setContratoAberto(null);
      toast.success('Contrato excluído e equipamentos liberados.');
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível excluir o contrato.')
  });

  const handleSalvarContrato = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const clienteId = String(formData.get('cliente_id') ?? '');
    const dataInicio = String(formData.get('data_inicio') ?? '') || todayInput();
    const parsedValor = Number(String(valorMensal || somaEquipamentosSelecionados).replace(',', '.'));

    if (!clienteId) {
      toast.error('Selecione o cliente do contrato.');
      return;
    }
    if (ativosSelecionados.length === 0) {
      toast.error('Selecione pelo menos 1 equipamento para locar.');
      return;
    }

    const payload: CreateContratoPayload = {
      cliente_id: clienteId,
      data_inicio: dataInicio,
      data_fim_prevista: null,
      renovacao_automatica: true,
      valor_total: Number.isFinite(parsedValor) && parsedValor >= 0 ? parsedValor : 0,
      periodicidade: 'MENSAL',
      status: (formData.get('status') as CreateContratoPayload['status']) || 'ATIVO',
      equipamento_ids: ativosSelecionados
    };
    createContratoMut.mutate(payload);
  };

  return (
    <div className="flex flex-col h-full bg-[#121316] text-white p-8 animate-in fade-in duration-300 relative">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileSignature className="text-[#E4E7EC]" size={28} />
            Contratos de Locação
          </h1>
          <p className="text-sm text-[#9CA1AA] mt-1">Controle mensal contínuo com renovação automática pela data de retirada</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => { setContratoAberto(null); setBuscaAtivo(''); setIsCreating(true); }}
            className="flex items-center gap-2 text-sm px-5 py-2.5 bg-[#E4E7EC] text-[#121316] font-bold rounded-lg shadow-[0_0_15px_rgba(228,231,236,0.14)] hover:bg-[#D4D8DF] transition-all"
          >
            <Plus size={16}/> Novo Contrato
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl">
          <span className="text-[#9CA1AA] text-xs font-semibold uppercase tracking-wider">Receita Mensal Ativa</span>
          <div className="text-2xl font-bold mt-2 text-[#E4E7EC]">
            {isLoadingDash ? '...' : formatCurrency(dashboard?.receita_recorrente || 0)}
          </div>
        </div>
        <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl border-t-2 border-t-[#E4E7EC]">
          <span className="text-[#9CA1AA] text-xs font-semibold uppercase tracking-wider">Contratos Ativos</span>
          <div className="text-2xl font-bold mt-2 text-[#F2F3F5]">
            {isLoadingDash ? '...' : dashboard?.contratos_ativos || 0}
          </div>
        </div>
        <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl border-t-2 border-t-[#E0A11B]">
          <span className="text-[#9CA1AA] text-xs font-semibold uppercase tracking-wider">Renovações (7 dias)</span>
          <div className="text-2xl font-bold mt-2 text-[#E0A11B]">
            {isLoadingDash ? '...' : dashboard?.proximas_renovacoes || 0}
          </div>
        </div>
        <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl">
          <span className="text-[#9CA1AA] text-xs font-semibold uppercase tracking-wider">Total de Contratos</span>
          <div className="text-2xl font-bold mt-2 text-[#F2F3F5]">
            {isLoadingDash ? '...' : dashboard?.total_contratos || 0}
          </div>
        </div>
      </div>

      <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-[#2E3238] flex gap-4 bg-[#121316]/50">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
              <input 
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg pl-12 pr-4 py-2.5 text-sm focus:ring-1 focus:ring-[#E4E7EC] outline-none transition-all placeholder:text-gray-600"
                placeholder="Buscar por cliente..."
              />
            </div>
          </div>
          
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#23262B] text-gray-400 sticky top-0 z-10 shadow-sm border-b border-[#2E3238]">
                <tr>
                  <th className="p-4 font-medium">Contrato</th>
                  <th className="p-4 font-medium">Cliente</th>
                  <th className="p-4 font-medium">Data de Retirada</th>
                  <th className="p-4 font-medium">Próxima Renovação / Vigência</th>
                  <th className="p-4 font-medium text-right">Valor Mensal</th>
                  <th className="p-4 font-medium text-center">Status</th>
                  <th className="p-4 font-medium w-[100px]">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2E3238]">
                {isLoadingContratos ? (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-500">Buscando contratos...</td></tr>
                ) : contratosFiltrados.length === 0 ? (
                  <tr><td colSpan={7} className="p-12 text-center text-gray-500">Nenhum contrato ativo.</td></tr>
                ) : (
                  contratosFiltrados.map(c => {
                    const isVencido = Boolean(c.data_fim_prevista && new Date(c.data_fim_prevista) < new Date() && c.status === 'ATIVO');
                    return (
                      <tr key={c.id} className="hover:bg-[#23262B] transition-colors group">
                        <td className="p-4 text-xs font-mono text-gray-400">
                          {c.id.split('-')[0].toUpperCase()}
                        </td>
                        <td className="p-4 cursor-pointer" onClick={() => setContratoAberto(c)}>
                          <div className="font-semibold text-white group-hover:text-[#E4E7EC] transition-colors">{c.cliente_nome}</div>
                        </td>
                        <td className="p-4 text-xs text-gray-300">
                          {formatDate(c.data_inicio)}
                        </td>
                        <td className="p-4 text-xs text-gray-300">
                          {c.data_fim_prevista ? (
                            <span>Até {formatDate(c.data_fim_prevista)}</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{c.proximo_vencimento ? formatDate(c.proximo_vencimento) : 'Mensal'}</span>
                              {c.status === 'ATIVO' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#23262B] border border-[#2E3238] text-[#E4E7EC]">
                                  <RefreshCw size={10} /> Renovação automática{Number(c.ciclos_cobrados || 1) > 1 ? ` · Ciclo ${c.ciclos_cobrados}` : ''}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right font-mono font-medium text-[#E4E7EC]">
                          {formatCurrency(c.valor_total)}
                        </td>
                        <td className="p-4 text-center">
                          {isVencido ? (
                             <span className="bg-red-500/10 text-red-500 px-2 py-0.5 rounded text-xs border border-red-500/20 font-medium">FINALIZADO NO PRAZO</span>
                          ) : c.status === 'ATIVO' ? (
                             <span className="bg-green-500/10 text-green-500 px-2 py-0.5 rounded text-xs border border-green-500/20 font-medium">ATIVO</span>
                          ) : (
                             <span className="bg-gray-500/10 text-gray-400 px-2 py-0.5 rounded text-xs border border-gray-500/20 font-medium">{c.status}</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => setContratoAberto(c)}
                            className="text-xs bg-[#2E3238] hover:bg-[#E4E7EC] hover:text-[#121316] text-white px-3 py-1.5 rounded font-sans transition-all border border-[#2E3238]"
                          >
                            Ver Ficha
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
      </div>

      {/* DRAWER DO CONTRATO */}
      {(isCreating || contratoAberto) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => { setIsCreating(false); setContratoAberto(null); }} />
          <div className="relative w-full max-w-2xl bg-[#1A1C20] border-l border-[#2E3238] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            
            <div className="flex items-center justify-between p-6 border-b border-[#2E3238] bg-[#121316]">
              <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                {isCreating ? <><FileSignature className="text-[#E4E7EC]"/> Novo Contrato</> : <><FileText className="text-[#E4E7EC]"/> Detalhes do Contrato</>}
              </h2>
              <button onClick={() => { setIsCreating(false); setContratoAberto(null); }} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
              <form id="contrato-form" ref={contratoFormRef} onInput={() => syncDraft()} onChange={() => syncDraft()} onSubmit={handleSalvarContrato} className="space-y-8">
                
                <section>
                  <h3 className="text-xs font-bold text-[#E4E7EC] uppercase tracking-wider mb-3">1. Partes do Acordo</h3>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Cliente *</label>
                    <select name="cliente_id" disabled={!isCreating} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none disabled:opacity-50">
                      {isCreating && <option value="">-- Selecione o Cliente --</option>}
                      {isCreating ? clientes.map(c => <option key={c.id} value={c.id}>{c.nome}{c.documento ? ` (${c.documento})` : ''}</option>) : (
                         <option>{contratoAberto?.cliente_nome}</option>
                      )}
                    </select>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-[#E4E7EC] uppercase tracking-wider mb-3">2. Retirada e Valor Mensal</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1"><CalendarDays size={12}/> Data de Retirada *</label>
                      <input name="data_inicio" type="date" disabled={!isCreating} defaultValue={contratoAberto?.data_inicio ? new Date(contratoAberto.data_inicio).toISOString().split('T')[0] : todayInput()} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none [color-scheme:dark] disabled:opacity-50" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Valor Mensal (R$)</label>
                      <input
                        name="valor_total"
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={!isCreating}
                        value={isCreating ? valorMensal : Number(contratoAberto?.valor_total || 0).toFixed(2)}
                        onChange={(e) => {
                          setValorEditadoManual(true);
                          setValorMensal(e.target.value);
                          syncDraft({ valor_total: e.target.value });
                        }}
                        placeholder="Calculado pelos equipamentos"
                        className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-[#2E3238] bg-[#23262B]/60 px-4 py-3 text-xs text-[#9CA1AA] flex items-center gap-2">
                    <RefreshCw size={14} className="text-[#E4E7EC] shrink-0" />
                    <span>Sem data de devolução obrigatória: a mensalidade é renovada automaticamente a cada 1 mês a partir da data de retirada até o encerramento.</span>
                  </div>
                </section>

                {isCreating && (
                  <section>
                    <h3 className="text-xs font-bold text-[#E4E7EC] uppercase tracking-wider mb-3 flex items-center gap-2">3. Seleção de Ativos</h3>
                    <p className="text-xs text-gray-500 mb-4">Selecione os equipamentos disponíveis no pátio para vinculá-los a este contrato.</p>
                    <div className="bg-[#23262B] border border-[#2E3238] rounded-lg p-4">
                      <div className="relative mb-3">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={15} aria-hidden="true" />
                        <input value={buscaAtivo} onChange={event => setBuscaAtivo(event.target.value)} placeholder="Pesquisar por nome ou patrimônio..." aria-label="Pesquisar ativos disponíveis" className="w-full bg-[#1A1C20] border border-[#2E3238] rounded-lg pl-10 pr-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#E4E7EC]" />
                      </div>
                      <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
                        <span>{equipamentosVisiveis.length} ativo(s) encontrado(s)</span>
                        <span className="text-[#E4E7EC]">{ativosSelecionados.length} selecionado(s)</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto no-scrollbar space-y-2">
                      {equipamentosVisiveis.map(e => (
                        <label key={e.id} className="flex items-center gap-3 p-2 hover:bg-[#2E3238] rounded cursor-pointer transition-colors border border-transparent hover:border-[#2E3238]">
                          <input type="checkbox" name={`eq_${e.id}`} checked={ativosSelecionados.includes(e.id)} onChange={() => { const next = ativosSelecionados.includes(e.id) ? ativosSelecionados.filter(id => id !== e.id) : [...ativosSelecionados, e.id]; setAtivosSelecionados(next); syncDraft({ ativosSelecionados: next }); }} className="accent-[#E4E7EC] w-4 h-4" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">{e.nome}</p>
                            <p className="text-xs text-gray-500 font-mono">Patrimônio: {e.patrimonio || 'Sem patrimônio'}</p>
                          </div>
                          <span className="text-sm font-mono text-[#E4E7EC]">{formatCurrency(e.valor_locacao)}/mês</span>
                        </label>
                      ))}
                      {equipamentosVisiveis.length === 0 && (
                        <p className="text-xs text-gray-500 text-center py-4">Nenhum equipamento disponível no pátio.</p>
                      )}
                      </div>
                    </div>
                  </section>
                )}

                {contratoAberto && (
                   <section>
                     <h3 className="text-xs font-bold text-[#E4E7EC] uppercase tracking-wider mb-3">Itens e Valores</h3>
                     <div className="bg-[#23262B] border border-[#2E3238] rounded-lg p-5 flex items-center justify-between">
                       <div>
                         <span className="text-gray-400 text-sm block">Valor Mensal:</span>
                         {!contratoAberto.data_fim_prevista && (
                           <span className="text-xs text-[#9CA1AA]">
                             Próxima renovação: {formatDate(contratoAberto.proximo_vencimento)} · Ciclos cobrados: {contratoAberto.ciclos_cobrados ?? 1}
                           </span>
                         )}
                       </div>
                       <span className="text-2xl font-bold font-mono text-[#E4E7EC]">{formatCurrency(contratoAberto.valor_total)}</span>
                     </div>
                   </section>
                )}

                {isCreating && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Status Inicial</label>
                    <select name="status" className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none">
                      <option value="ATIVO">Ativar Imediatamente</option>
                      <option value="RASCUNHO">Salvar como Rascunho</option>
                    </select>
                  </div>
                )}
              </form>
            </div>

            <div className="p-6 border-t border-[#2E3238] bg-[#121316] flex justify-between items-center">
              {contratoAberto && contratoAberto.status === 'ATIVO' ? (
                <button 
                  onClick={() => {
                    if(confirm('Tem certeza? Isso encerrará a renovação mensal e fará a devolução dos equipamentos para o pátio.')) {
                      encerraContratoMut.mutate(contratoAberto.id);
                    }
                  }}
                  disabled={encerraContratoMut.isPending}
                  className="text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {encerraContratoMut.isPending ? 'Devolvendo…' : 'Encerrar Contrato / Devolver Itens'}
                </button>
              ) : isCreating && hasDraft ? (<button type="button" onClick={resetContratoDraft} className="text-xs font-medium text-[#9CA1AA] hover:text-[#F2F3F5] px-3 py-2 rounded-lg border border-[#2E3238]">Limpar rascunho</button>) : <div/>}

              {contratoAberto ? (
                <button
                  onClick={() => {
                    if (confirm('Tem certeza que deseja excluir este contrato?')) {
                      excluiContratoMut.mutate(contratoAberto.id);
                    }
                  }}
                  disabled={excluiContratoMut.isPending || encerraContratoMut.isPending}
                  className="text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {excluiContratoMut.isPending ? 'Excluindo…' : 'Excluir Contrato'}
                </button>
              ) : null}

              <div className="flex gap-3">
                <button onClick={() => { setIsCreating(false); setContratoAberto(null); }} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                  Cancelar
                </button>
                {isCreating && (
                  <button type="submit" form="contrato-form" disabled={createContratoMut.isPending} className="bg-[#E4E7EC] text-[#121316] px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#D4D8DF] disabled:opacity-50">
                    {createContratoMut.isPending ? 'Salvando…' : 'Salvar Contrato'}
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

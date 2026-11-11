'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Plus, FileText, CheckCircle2, AlertTriangle, FileSignature, X, CalendarDays, Receipt, Clock } from 'lucide-react';
import { toast } from 'sonner';

type Cliente = { id: string; nome: string; documento: string };
type Equipamento = { id: string; nome: string; valor_locacao: string; patrimonio: string; status: string };

type Contrato = {
  id: string;
  cliente_id: string;
  cliente_nome?: string;
  data_inicio: string;
  data_fim_prevista: string;
  valor_total: string;
  periodicidade: string;
  status: 'RASCUNHO' | 'ATIVO' | 'ENCERRADO' | 'CANCELADO';
  created_at: string;
};

type CreateContratoPayload = {
  cliente_id: string;
  data_inicio: string;
  data_fim_prevista: string;
  periodicidade: 'MENSAL' | 'SEMANAL' | 'DIARIO';
  dia_vencimento: number;
  status: 'ATIVO' | 'RASCUNHO';
  equipamento_ids: string[];
};

export default function ContratosPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'visao_geral' | 'contratos' | 'faturamento'>('visao_geral');
  const [busca, setBusca] = useState('');
  
  // Modals / Drawers
  const [isCreating, setIsCreating] = useState(false);
  const [contratoAberto, setContratoAberto] = useState<Contrato | null>(null);
  const [buscaAtivo, setBuscaAtivo] = useState('');
  const [ativosSelecionados, setAtivosSelecionados] = useState<string[]>([]);

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
  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

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
      setIsCreating(false);
      toast.success('Contrato salvo com sucesso!');
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
    
    const dataInicio = formData.get('data_inicio') as string;
    const dataFimPrevista = formData.get('data_fim_prevista') as string;
    if (dataFimPrevista <= dataInicio) {
      toast.error('A data de fim deve ser posterior à data de início.');
      return;
    }

    const payload = {
      cliente_id: formData.get('cliente_id') as string,
      data_inicio: dataInicio,
      data_fim_prevista: dataFimPrevista,
      periodicidade: formData.get('periodicidade') as CreateContratoPayload['periodicidade'],
      dia_vencimento: Number(formData.get('dia_vencimento')),
      status: (formData.get('status') as CreateContratoPayload['status']) || 'ATIVO',
      equipamento_ids: ativosSelecionados
    };

    if(payload.equipamento_ids.length === 0) {
      toast.error('Selecione pelo menos 1 equipamento para locar.');
      return;
    }
    createContratoMut.mutate(payload);
  };

  return (
    <div className="flex flex-col h-full bg-[#141414] text-white p-8 animate-in fade-in duration-300 relative">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileSignature className="text-[#b0fb5d]" size={28} />
            Contratos de Locação
          </h1>
          <div className="flex gap-6 mt-3 border-b border-[#2a2a2a] overflow-x-auto no-scrollbar">
            {[
              { id: 'visao_geral', label: 'Dashboard' },
              { id: 'contratos', label: 'Meus Contratos' },
              { id: 'faturamento', label: 'Faturamento Automático' }
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${activeTab === tab.id ? 'border-[#b0fb5d] text-[#b0fb5d]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => { setContratoAberto(null); setAtivosSelecionados([]); setBuscaAtivo(''); setIsCreating(true); }}
            className="flex items-center gap-2 text-sm px-5 py-2.5 bg-[#b0fb5d] text-black font-bold rounded-lg shadow-[0_0_15px_rgba(176,251,93,0.2)] hover:bg-[#9de44f] transition-all"
          >
            <Plus size={16}/> Novo Contrato
          </button>
        </div>
      </div>

      {activeTab === 'visao_geral' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] p-5 rounded-xl">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">MRR (Receita Mensal)</span>
              <div className="text-2xl font-bold mt-2 text-[#b0fb5d]">
                {isLoadingDash ? '...' : formatCurrency(dashboard?.receita_recorrente || 0)}
              </div>
            </div>
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] p-5 rounded-xl border-t-2 border-t-[#b0fb5d]">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Contratos Ativos</span>
              <div className="text-2xl font-bold mt-2 text-white">
                {isLoadingDash ? '...' : dashboard?.contratos_ativos || 0}
              </div>
            </div>
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] p-5 rounded-xl border-t-2 border-t-yellow-500">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">Vencendo (30 dias)</span>
              <div className="text-2xl font-bold mt-2 text-yellow-500">Em breve</div>
            </div>
            <div className="bg-red-500/5 border border-red-500/20 p-5 rounded-xl">
              <span className="text-red-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2"><AlertTriangle size={14}/> Vencidos (Ativos)</span>
              <div className="text-2xl font-bold mt-2 text-red-400">
                {isLoadingDash ? '...' : dashboard?.vencidos || 0}
              </div>
            </div>
          </div>
          
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 h-64 flex flex-col items-center justify-center text-gray-500">
            <FileText size={40} className="mb-4 opacity-50"/>
            <p>O Gráfico de Churn Rate (Cancelamentos) será exibido aqui.</p>
          </div>
        </div>
      )}

      {activeTab === 'contratos' && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-[#2a2a2a] flex gap-4 bg-[#141414]/50">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
              <input 
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg pl-12 pr-4 py-2.5 text-sm focus:ring-1 focus:ring-[#b0fb5d] outline-none transition-all placeholder:text-gray-600"
                placeholder="Buscar por cliente..."
              />
            </div>
          </div>
          
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#242424] text-gray-400 sticky top-0 z-10 shadow-sm border-b border-[#2a2a2a]">
                <tr>
                  <th className="p-4 font-medium">Contrato (ID)</th>
                  <th className="p-4 font-medium">Cliente</th>
                  <th className="p-4 font-medium">Vigência</th>
                  <th className="p-4 font-medium">Período</th>
                  <th className="p-4 font-medium text-right">Valor Recorrente</th>
                  <th className="p-4 font-medium text-center">Status</th>
                  <th className="p-4 font-medium w-[100px]">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {isLoadingContratos ? (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-500">Buscando contratos...</td></tr>
                ) : contratosFiltrados.length === 0 ? (
                  <tr><td colSpan={7} className="p-12 text-center text-gray-500">Nenhum contrato ativo.</td></tr>
                ) : (
                  contratosFiltrados.map(c => {
                    const isVencido = new Date(c.data_fim_prevista) < new Date() && c.status === 'ATIVO';
                    return (
                      <tr key={c.id} className="hover:bg-[#242424] transition-colors group">
                        <td className="p-4 text-xs font-mono text-gray-400">
                          {c.id.split('-')[0].toUpperCase()}
                        </td>
                        <td className="p-4 cursor-pointer" onClick={() => setContratoAberto(c)}>
                          <div className="font-semibold text-white group-hover:text-[#b0fb5d] transition-colors">{c.cliente_nome}</div>
                        </td>
                        <td className="p-4 text-xs text-gray-300">
                          {formatDate(c.data_inicio)} até {formatDate(c.data_fim_prevista)}
                        </td>
                        <td className="p-4 text-xs text-gray-400">{c.periodicidade}</td>
                        <td className="p-4 text-right font-mono font-medium text-[#b0fb5d]">
                          {formatCurrency(c.valor_total)}
                        </td>
                        <td className="p-4 text-center">
                          {isVencido ? (
                             <span className="bg-red-500/10 text-red-500 px-2 py-0.5 rounded text-xs border border-red-500/20 font-medium">VENCIDO</span>
                          ) : c.status === 'ATIVO' ? (
                             <span className="bg-green-500/10 text-green-500 px-2 py-0.5 rounded text-xs border border-green-500/20 font-medium">ATIVO</span>
                          ) : (
                             <span className="bg-gray-500/10 text-gray-400 px-2 py-0.5 rounded text-xs border border-gray-500/20 font-medium">{c.status}</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => setContratoAberto(c)}
                            className="text-xs bg-[#2a2a2a] hover:bg-[#b0fb5d] hover:text-black text-white px-3 py-1.5 rounded font-sans transition-all border border-[#2a2a2a]"
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
      )}

      {/* DRAWER DO CONTRATO */}
      {(isCreating || contratoAberto) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => { setIsCreating(false); setContratoAberto(null); }} />
          <div className="relative w-full max-w-2xl bg-[#1a1a1a] border-l border-[#2a2a2a] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            
            <div className="flex items-center justify-between p-6 border-b border-[#2a2a2a] bg-[#141414]">
              <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                {isCreating ? <><FileSignature className="text-[#b0fb5d]"/> Novo Contrato</> : <><FileText className="text-[#b0fb5d]"/> Detalhes do Contrato</>}
              </h2>
              <button onClick={() => { setIsCreating(false); setContratoAberto(null); }} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
              <form id="contrato-form" onSubmit={handleSalvarContrato} className="space-y-8">
                
                <section>
                  <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider mb-3">1. Partes do Acordo</h3>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Selecione o Cliente (Locatário) *</label>
                    <select name="cliente_id" disabled={!isCreating} required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none disabled:opacity-50">
                      {isCreating && <option value="">-- Selecione o Cliente --</option>}
                      {isCreating ? clientes.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.documento})</option>) : (
                         <option>{contratoAberto?.cliente_nome}</option>
                      )}
                    </select>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider mb-3">2. Prazos e Faturamento</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1"><CalendarDays size={12}/> Data de Início *</label>
                      <input name="data_inicio" type="date" disabled={!isCreating} defaultValue={contratoAberto?.data_inicio ? new Date(contratoAberto.data_inicio).toISOString().split('T')[0] : ''} required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none [color-scheme:dark] disabled:opacity-50" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1"><CalendarDays size={12}/> Data de Fim *</label>
                      <input name="data_fim_prevista" type="date" disabled={!isCreating} defaultValue={contratoAberto?.data_fim_prevista ? new Date(contratoAberto.data_fim_prevista).toISOString().split('T')[0] : ''} required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none [color-scheme:dark] disabled:opacity-50" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Periodicidade da Fatura *</label>
                      <select name="periodicidade" disabled={!isCreating} defaultValue={contratoAberto?.periodicidade || 'MENSAL'} required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none disabled:opacity-50">
                        <option value="MENSAL">Mensal (MRR)</option>
                        <option value="SEMANAL">Semanal</option>
                        <option value="DIARIO">Diário</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Dia de Vencimento</label>
                      <input name="dia_vencimento" type="number" min="1" max="31" disabled={!isCreating} defaultValue="5" required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none disabled:opacity-50" />
                    </div>
                  </div>
                </section>

                {isCreating && (
                  <section>
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider mb-3 flex items-center gap-2">3. Seleção de Ativos</h3>
                    <p className="text-xs text-gray-500 mb-4">Selecione os equipamentos disponíveis no pátio para vinculá-los a este contrato.</p>
                    <div className="bg-[#242424] border border-[#2a2a2a] rounded-lg p-4">
                      <div className="relative mb-3">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={15} aria-hidden="true" />
                        <input value={buscaAtivo} onChange={event => setBuscaAtivo(event.target.value)} placeholder="Pesquisar por nome ou patrimônio..." aria-label="Pesquisar ativos disponíveis" className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg pl-10 pr-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]" />
                      </div>
                      <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
                        <span>{equipamentosVisiveis.length} ativo(s) encontrado(s)</span>
                        <span className="text-[#b0fb5d]">{ativosSelecionados.length} selecionado(s)</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto no-scrollbar space-y-2">
                      {equipamentosVisiveis.map(e => (
                        <label key={e.id} className="flex items-center gap-3 p-2 hover:bg-[#2a2a2a] rounded cursor-pointer transition-colors border border-transparent hover:border-[#3a3a3a]">
                          <input type="checkbox" name={`eq_${e.id}`} checked={ativosSelecionados.includes(e.id)} onChange={() => setAtivosSelecionados(current => current.includes(e.id) ? current.filter(id => id !== e.id) : [...current, e.id])} className="accent-[#b0fb5d] w-4 h-4" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">{e.nome}</p>
                            <p className="text-xs text-gray-500 font-mono">TAG: {e.patrimonio}</p>
                          </div>
                          <span className="text-sm font-mono text-[#b0fb5d]">{formatCurrency(e.valor_locacao)}/per.</span>
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
                     <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider mb-3">Itens e Valores</h3>
                     <div className="bg-[#242424] border border-[#2a2a2a] rounded-lg p-5 flex items-center justify-between">
                       <span className="text-gray-400 text-sm">Valor Base Configurado:</span>
                       <span className="text-2xl font-bold font-mono text-[#b0fb5d]">{formatCurrency(contratoAberto.valor_total)}</span>
                     </div>
                   </section>
                )}

                {isCreating && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Status Inicial</label>
                    <select name="status" className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none">
                      <option value="ATIVO">Ativar Imediatamente</option>
                      <option value="RASCUNHO">Salvar como Rascunho</option>
                    </select>
                  </div>
                )}
              </form>
            </div>

            <div className="p-6 border-t border-[#2a2a2a] bg-[#141414] flex justify-between items-center">
              {contratoAberto && contratoAberto.status === 'ATIVO' ? (
                <button 
                  onClick={() => {
                    if(confirm('Tem certeza? Isso fará a DEVOLUÇÃO de todos os ativos deste contrato para o pátio.')) {
                      encerraContratoMut.mutate(contratoAberto.id);
                    }
                  }}
                  disabled={encerraContratoMut.isPending}
                  className="text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {encerraContratoMut.isPending ? 'Devolvendo…' : 'Encerrar Contrato / Devolver Itens'}
                </button>
              ) : <div/>}

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
                  <button type="submit" form="contrato-form" disabled={createContratoMut.isPending} className="bg-[#b0fb5d] text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#9de44f] disabled:opacity-50">
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

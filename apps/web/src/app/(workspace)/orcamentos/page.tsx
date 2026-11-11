'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Search, FileText, Send, CheckCircle2, XCircle, Clock, X, Trash2, Smartphone, Download, User, FileSignature, Edit3, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {Pagination} from '@/components/Pagination';
import {useRouter,useSearchParams} from 'next/navigation';
import {
  downloadQuotePdf,
  downloadContractPdf,
  buildDefaultContractData,
  buildClause4Text,
  buildContratanteQualification,
  numeroPorExtensoReais,
  type QuotePdfData,
  type ContractData,
} from '@/lib/pdf';
import {useTenantStore} from '@/stores/useTenantStore';
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation';

type Orcamento = {
  id: string;
  cliente_nome: string;
  numero: number;
  tipo: 'SERVICO'|'LOCACAO';
  status: 'RASCUNHO'|'ENVIADO'|'VISUALIZADO'|'APROVADO'|'REPROVADO'|'VENCIDO';
  valor_total: string;
  validade: string;
  condicoes_pagamento?: string | null;
  prazo_entrega?: string | null;
  aprovado_em?: string | null;
  created_at: string;
};
type ClienteOpcao = { id: string; nome: string; documento: string | null };
type QuoteListResponse = { data: Orcamento[]; meta: { page: number; limit: number; total: number; totalPages: number } };
type QuoteDashboard = { total_orcamentos: number; aprovados: number; aguardando_resposta: number; receita_aprovada: number; vencidos: number };
type QuoteItemUnit = 'UN' | 'KG' | 'M';
type QuoteMeasure = { unidade: QuoteItemUnit; quantidade: number; valor_unitario: number };
type QuoteItemInput = {
  produto_nome: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  desconto: number;
  medidas?: QuoteMeasure[];
};
type WizardQuoteItem = {
  id: number;
  produto_nome: string;
  desconto: number;
  unidades_ativas: QuoteItemUnit[];
  medidas_valores: Record<QuoteItemUnit, { quantidade: number; valor_unitario: number }>;
};
type QuoteCreatePayload = { cliente_id: string; tipo: 'SERVICO' | 'LOCACAO'; validade: string; condicoes_pagamento: string; prazo_entrega: string; observacoes: string; itens: QuoteItemInput[] };

const UNIT_ORDER: QuoteItemUnit[] = ['UN', 'KG', 'M'];
const UNIT_SHORT_LABEL: Record<QuoteItemUnit, string> = { UN: 'un', KG: 'kg', M: 'm' };
const UNIT_FULL_LABEL: Record<QuoteItemUnit, string> = { UN: 'Unidade (un)', KG: 'Quilo (kg)', M: 'Metro (m)' };

const createEmptyWizardItem = (id = Date.now()): WizardQuoteItem => ({
  id,
  produto_nome: '',
  desconto: 0,
  unidades_ativas: ['UN', 'KG', 'M'],
  medidas_valores: {
    UN: { quantidade: 1, valor_unitario: 0 },
    KG: { quantidade: 0, valor_unitario: 0 },
    M: { quantidade: 0, valor_unitario: 0 },
  },
});

const getFilledMeasures = (item: WizardQuoteItem): QuoteMeasure[] =>
  UNIT_ORDER
    .filter(unit => item.unidades_ativas.includes(unit))
    .map(unit => ({
      unidade: unit,
      quantidade: Number(item.medidas_valores[unit]?.quantidade) || 0,
      valor_unitario: Number(item.medidas_valores[unit]?.valor_unitario) || 0,
    }))
    .filter(m => m.quantidade > 0 && m.valor_unitario > 0);

const calcMeasuresSubtotal = (measures: QuoteMeasure[]) =>
  Math.round(measures.reduce((sum, m) => sum + Number(m.quantidade) * Number(m.valor_unitario), 0) * 100) / 100;

const calcWizardItemTotal = (item: WizardQuoteItem) => {
  const subtotal = calcMeasuresSubtotal(getFilledMeasures(item));
  const discountPct = Math.min(100, Math.max(0, Number(item.desconto) || 0));
  return Math.round(subtotal * (1 - discountPct / 100) * 100) / 100;
};

const calcItemTotal = (item: QuoteItemInput) => {
  const subtotal = item.medidas && item.medidas.length > 0
    ? calcMeasuresSubtotal(item.medidas)
    : Number(item.quantidade) * Number(item.valor_unitario);
  const discountPct = Math.min(100, Math.max(0, Number(item.desconto) || 0));
  return Math.round(subtotal * (1 - discountPct / 100) * 100) / 100;
};

const dateInputValue = (date: Date) => {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
};

export default function OrcamentosPage() {
  const queryClient = useQueryClient();
  const activeTenant = useTenantStore(state => state.activeTenant);
  const isSerralheria = activeTenant?.segmento === 'SERRALHERIA';
  const canCreateRentalQuote = activeTenant?.segmento === 'LOCADORA' || activeTenant?.segmento === 'MISTO';
  const params=useSearchParams(),router=useRouter();
  const rawTab = params.get('tab');
  const activeTab: 'lista' | 'contratos' | 'dashboard' =
    rawTab === 'dashboard'
      ? 'dashboard'
      : rawTab === 'contratos' && isSerralheria
        ? 'contratos'
        : 'lista';
  const busca=params.get('q')??'',page=Number(params.get('page')??'1'),limit=Number(params.get('limit')??'50');
  const [isCreating, setIsCreating] = useState(false);
  const [buscaInput, setBuscaInput] = useState(busca);
  const quoteListPrefix = ['orcamentos', 'lista', activeTenant?.id] as const;
  const quoteListKey = [...quoteListPrefix, page, busca, limit] as const;
  const quoteDashboardKey = ['orcamentos', 'dashboard', activeTenant?.id] as const;
  const quoteDropdownKey = ['clientes', activeTenant?.id, 'orcamento-dropdown'] as const;

  useEffect(() => setBuscaInput(busca), [busca]);
  useEffect(() => {
    if (buscaInput === busca) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      const normalized = buscaInput.trim();
      normalized ? next.set('q', normalized) : next.delete('q');
      next.set('page', '1');
      router.replace(`/orcamentos?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [buscaInput, busca, params, router]);
  const setActiveTab=(value:'lista'|'contratos'|'dashboard')=>{const next=new URLSearchParams(params.toString());next.set('tab',value);router.replace(`/orcamentos?${next}`)};
  const setPage=(value:number)=>{const next=new URLSearchParams(params.toString());next.set('page',String(value));router.replace(`/orcamentos?${next}`)};
  const setLimit=(value:number)=>{const next=new URLSearchParams(params.toString());next.set('limit',String(value));next.set('page','1');router.replace(`/orcamentos?${next}`)};
  
  const { data: dashboard, isLoading: isLoadingDash } = useQuery({
    queryKey: quoteDashboardKey,
    queryFn: () => api<QuoteDashboard>('/orcamentos/dashboard'),
    enabled: Boolean(activeTenant?.id) && activeTab === 'dashboard',
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnMount: true,
  });

  const { data: orcamentosResponse, isLoading: isLoadingOrcs } = useQuery({
    queryKey: quoteListKey,
    queryFn: ({ signal }) => api<QuoteListResponse>(`/orcamentos?page=${page}&limit=${limit}&search=${encodeURIComponent(busca)}`, { signal }),
    enabled: Boolean(activeTenant?.id) && (activeTab === 'lista' || activeTab === 'contratos'),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnMount: true,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === activeTenant?.id ? previous : undefined,
  });
  const orcamentos=orcamentosResponse?.data??[];

  const { data: clientes = [], isLoading: isLoadingClientes, isError: isErrorClientes } = useQuery({
    queryKey: quoteDropdownKey,
    queryFn: () => api<ClienteOpcao[]>('/clientes/opcoes'),
    enabled: Boolean(activeTenant?.id) && isCreating,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: true,
  });

  const filteredOrcs = orcamentos.filter(o => 
    o.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) || 
    String(o.numero).includes(busca)
  );
  const contratosAprovados = filteredOrcs.filter(o => o.status === 'APROVADO');

  const [wizardStep, setWizardStep] = useState(1);
  const [itens, setItens] = useState<WizardQuoteItem[]>(() => [createEmptyWizardItem()]);
  const [formData, setFormData] = useState<any>({ cliente_id: '', tipo: 'SERVICO', validade: '', condicoes_pagamento: '', prazo_entrega: '', observacoes: '' });
  const [orcamentoParaAprovar, setOrcamentoParaAprovar] = useState<Orcamento | null>(null);
  const [orcamentoParaApagar, setOrcamentoParaApagar] = useState<Orcamento | null>(null);
  const [periodoLocacao, setPeriodoLocacao] = useState({ data_inicio: '', data_fim_prevista: '' });

  useEffect(() => {
    if (!canCreateRentalQuote && formData.tipo === 'LOCACAO') {
      setFormData((current: typeof formData) => ({ ...current, tipo: 'SERVICO' }));
    }
  }, [canCreateRentalQuote, formData]);

  useEffect(() => {
    if (params.get('novo') !== '1') return;
    setIsCreating(true);
    const next = new URLSearchParams(params.toString());
    next.delete('novo');
    router.replace(`/orcamentos?${next}`);
  }, [params, router]);

  const formatCurrency = (v: number | string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
  
  const totalWizard = itens.reduce((acc, i) => acc + calcWizardItemTotal(i), 0);

  const updateQuoteLists = (oldData: unknown, update: (items: Orcamento[]) => Orcamento[]) => {
    if (!oldData || typeof oldData !== 'object') return oldData;
    const cached = oldData as QuoteListResponse;
    return Array.isArray(cached.data) ? { ...cached, data: update(cached.data) } : oldData;
  };

  const createMut = useOptimisticMutation<Partial<Orcamento> & Pick<Orcamento, 'id'>, { tempId: string; payload: QuoteCreatePayload }>({
    mutationFn: ({ payload }) => api<Partial<Orcamento> & Pick<Orcamento, 'id'>>('/orcamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    queryKeys: [quoteListKey, quoteDashboardKey],
    apply: (oldData, variables) => {
      const optimistic: Orcamento = {
        id: variables.tempId,
        cliente_nome: clientes.find(client => client.id === variables.payload.cliente_id)?.nome ?? 'Novo orçamento',
        numero: 0,
        tipo: variables.payload.tipo,
        status: 'RASCUNHO',
        valor_total: String(variables.payload.itens.reduce((sum, item) => sum + calcItemTotal(item), 0)),
        validade: variables.payload.validade,
        condicoes_pagamento: variables.payload.condicoes_pagamento || null,
        prazo_entrega: variables.payload.prazo_entrega || null,
        aprovado_em: null,
        created_at: new Date().toISOString(),
      };
      if (oldData && typeof oldData === 'object' && Array.isArray((oldData as QuoteListResponse).data)) {
        const currentPage = page === 1;
        const searchMatches = !busca || optimistic.cliente_nome.toLocaleLowerCase().includes(busca.toLocaleLowerCase());
        if (!currentPage || !searchMatches) return oldData;
        const cache = oldData as QuoteListResponse;
        return { ...cache, data: [optimistic, ...cache.data], meta: { ...cache.meta, total: cache.meta.total + 1, totalPages: Math.ceil((cache.meta.total + 1) / cache.meta.limit) } };
      }
      if (oldData && typeof oldData === 'object' && 'total_orcamentos' in oldData) {
        const summary = oldData as QuoteDashboard;
        return { ...summary, total_orcamentos: summary.total_orcamentos + 1 };
      }
      return oldData;
    },
    onSuccessData: (saved, variables) => {
      queryClient.setQueriesData<QuoteListResponse>({ queryKey: quoteListPrefix }, cached => cached && ({
        ...cached,
        data: cached.data.map(item => item.id === variables.tempId ? { ...item, ...saved } : item),
      }));
      setIsCreating(false);
      setWizardStep(1);
      toast.success('Orçamento salvo como Rascunho!');
    },
    onMutateData: () => setIsCreating(false),
    onErrorData: () => setIsCreating(true),
    invalidate: 'orcamentos',
  });

  const aprovarMut = useOptimisticMutation<{conta_id:string;contrato_id:string|null;card_id:string|null;alreadyApproved:boolean}, {id:string;locacao?:{data_inicio:string;data_fim_prevista:string}}>({
    mutationFn: ({id,locacao}) => api<{conta_id:string;contrato_id:string|null;card_id:string|null;alreadyApproved:boolean}>(`/orcamentos/${id}/aprovar`, { method: 'PUT', body: JSON.stringify(locacao?{locacao}:{}) }),
    queryKeys: [quoteListPrefix],
    apply: (oldData, variables) => updateQuoteLists(oldData, items => items.map(item => item.id === variables.id ? { ...item, status: 'APROVADO', aprovado_em: item.aprovado_em ?? new Date().toISOString() } : item)),
    onSuccessData: result => {
      void queryClient.invalidateQueries({ queryKey: ['financeiro'] });
      void queryClient.invalidateQueries({ queryKey: ['contratos'] });
      void queryClient.invalidateQueries({ queryKey: ['producao'] });
      setOrcamentoParaAprovar(null);
      toast.success(result.alreadyApproved ? 'Este orçamento já estava aprovado.' : 'Orçamento aprovado e fluxo criado.', {description:`Financeiro: ${result.conta_id}${result.contrato_id ? ' · contrato criado' : ''}${result.card_id ? ' · card de produção criado' : ''}`});
    },
    invalidate: 'orcamentos',
  });

  const approveQuote=(orcamento:Orcamento)=>{
    if(canCreateRentalQuote && orcamento.tipo==='LOCACAO') {
      const data_inicio = dateInputValue(new Date());
      const data_fim_prevista = dateInputValue(new Date(Date.now() + 30 * 86_400_000));
      setPeriodoLocacao({ data_inicio, data_fim_prevista });
      setOrcamentoParaAprovar(orcamento);
      return;
    }
    aprovarMut.mutate({id:orcamento.id});
  };

  const confirmarAprovacaoLocacao = () => {
    if (!orcamentoParaAprovar) return;
    if (!periodoLocacao.data_inicio || !periodoLocacao.data_fim_prevista) {
      toast.error('Informe o início e o fim da locação.');
      return;
    }
    if (periodoLocacao.data_fim_prevista <= periodoLocacao.data_inicio) {
      toast.error('O fim da locação deve ser posterior ao início.');
      return;
    }
    aprovarMut.mutate({ id: orcamentoParaAprovar.id, locacao: periodoLocacao });
  };

  const reprovarMut = useOptimisticMutation<unknown, {id:string;motivo:string}>({
    mutationFn: ({id,motivo}:{id:string;motivo:string}) => api(`/orcamentos/${id}/reprovar`, { method: 'PUT', body: JSON.stringify({motivo}) }),
    queryKeys: [quoteListPrefix],
    apply: (oldData, variables) => updateQuoteLists(oldData, items => items.map(item => item.id === variables.id ? { ...item, status: 'REPROVADO' } : item)),
    onSuccessData: () => toast.success('Orçamento reprovado.'),
    invalidate: 'orcamentos',
  });

  const pdfMut = useMutation({
    mutationFn: (id: string) => api<QuotePdfData>(`/orcamentos/${id}`),
    onSuccess: async (quote) => {
      await downloadQuotePdf(quote);
      toast.success(`PDF do orçamento #${quote.numero} baixado com sucesso!`);
    },
    onError: error => toast.error((error as Error).message || 'Não foi possível baixar o PDF do orçamento.'),
  });

  const apagarMut = useOptimisticMutation<unknown, string>({
    mutationFn: (id: string) => api(`/orcamentos/${id}`, { method: 'DELETE' }),
    queryKeys: [quoteListPrefix],
    apply: (oldData, id) => {
      if (!oldData || typeof oldData !== 'object' || !Array.isArray((oldData as QuoteListResponse).data)) return oldData;
      const cache = oldData as QuoteListResponse;
      const removed = cache.data.some(item => item.id === id);
      const total = Math.max(0, cache.meta.total - (removed ? 1 : 0));
      return { ...cache, data: cache.data.filter(item => item.id !== id), meta: { ...cache.meta, total, totalPages: Math.ceil(total / cache.meta.limit) } };
    },
    onSuccessData: () => {
      void queryClient.invalidateQueries({ queryKey: ['financeiro'] });
      void queryClient.invalidateQueries({ queryKey: ['contratos'] });
      void queryClient.invalidateQueries({ queryKey: ['producao'] });
      setOrcamentoParaApagar(null);
      toast.success('Orçamento apagado.');
    },
    invalidate: 'orcamentos',
  });

  const [contratoEditando, setContratoEditando] = useState<Orcamento | null>(null);
  const [contratoForm, setContratoForm] = useState<ContractData>(() => buildDefaultContractData());
  const [contratoTab, setContratoTab] = useState<'partes' | 'objeto_prazos' | 'valores_pagamento' | 'clausulas'>('partes');
  const [loadingContratoId, setLoadingContratoId] = useState<string | null>(null);
  const [savingContrato, setSavingContrato] = useState(false);

  const loadContractDataForQuote = async (orcamento: Orcamento): Promise<ContractData> => {
    let quoteDetail: (QuotePdfData & { contrato_dados?: Partial<ContractData> | null; aprovado_em?: string | null }) | null = null;
    try {
      quoteDetail = await api<QuotePdfData & { contrato_dados?: Partial<ContractData> | null; aprovado_em?: string | null }>(`/orcamentos/${orcamento.id}`);
    } catch {
      quoteDetail = null;
    }
    const defaults = buildDefaultContractData(quoteDetail ?? {
      numero: orcamento.numero,
      status: orcamento.status,
      valor_total: orcamento.valor_total,
      validade: orcamento.validade,
      condicoes_pagamento: orcamento.condicoes_pagamento,
      prazo_entrega: orcamento.prazo_entrega,
      aprovado_em: orcamento.aprovado_em,
      created_at: orcamento.created_at,
      cliente_nome: orcamento.cliente_nome,
      itens: [],
    });

    let localSaved: Partial<ContractData> | null = null;
    try {
      const raw = window.localStorage.getItem(`nexo:contrato:${orcamento.id}`);
      if (raw) localSaved = JSON.parse(raw) as Partial<ContractData>;
    } catch {
      localSaved = null;
    }

    const saved = quoteDetail?.contrato_dados ?? localSaved;
    if (!saved) return defaults;

    return {
      ...defaults,
      ...saved,
      clausulas: Array.isArray(saved.clausulas) && saved.clausulas.length > 0 ? saved.clausulas : defaults.clausulas,
    };
  };

  const openContractEditor = async (orcamento: Orcamento) => {
    setLoadingContratoId(orcamento.id);
    try {
      const data = await loadContractDataForQuote(orcamento);
      setContratoForm(data);
      setContratoTab('partes');
      setContratoEditando(orcamento);
    } catch (error) {
      toast.error((error as Error).message || 'Não foi possível carregar os dados do contrato.');
    } finally {
      setLoadingContratoId(null);
    }
  };

  const handleDownloadContractPdf = async (orcamento: Orcamento) => {
    setLoadingContratoId(orcamento.id);
    try {
      const data = await loadContractDataForQuote(orcamento);
      downloadContractPdf(data, orcamento.numero);
      toast.success(`PDF do contrato #${String(orcamento.numero).padStart(4, '0')} baixado com sucesso!`);
    } catch (error) {
      toast.error((error as Error).message || 'Não foi possível baixar o PDF do contrato.');
    } finally {
      setLoadingContratoId(null);
    }
  };

  const handleSaveContract = async (andDownload = false) => {
    if (!contratoEditando) return;
    setSavingContrato(true);
    try {
      try {
        window.localStorage.setItem(`nexo:contrato:${contratoEditando.id}`, JSON.stringify(contratoForm));
      } catch {
        // Ignore storage quota errors
      }
      await api(`/orcamentos/${contratoEditando.id}/contrato`, {
        method: 'PUT',
        body: JSON.stringify(contratoForm),
      }).catch(() => null);

      if (andDownload) {
        downloadContractPdf(contratoForm, contratoEditando.numero);
        toast.success(`Contrato #${String(contratoEditando.numero).padStart(4, '0')} salvo e PDF baixado!`);
      } else {
        toast.success(`Informações do contrato #${String(contratoEditando.numero).padStart(4, '0')} salvas!`);
      }
      setContratoEditando(null);
    } finally {
      setSavingContrato(false);
    }
  };

  const updateObjetoResumo = (novoObjeto: string) => {
    setContratoForm(prev => ({
      ...prev,
      objeto_resumo: novoObjeto,
      clausulas: prev.clausulas.map((c, idx) =>
        c.id === 'clausula-1' || idx === 0 ? { ...c, conteudo: novoObjeto } : c
      ),
    }));
  };

  const updatePrazoExecucao = (novoPrazo: string) => {
    setContratoForm(prev => ({
      ...prev,
      prazo_execucao: novoPrazo,
      clausulas: prev.clausulas.map(c => {
        if (c.id !== 'clausula-3') return c;
        const linhas = c.conteudo.split('\n');
        const temItemE = linhas.some(l => l.trim().toLowerCase().startsWith('e)'));
        const novoConteudo = temItemE
          ? linhas.map(l => l.trim().toLowerCase().startsWith('e)') ? `e) Executar o serviço até ${novoPrazo};` : l).join('\n')
          : `${c.conteudo.trim()}\n\ne) Executar o serviço até ${novoPrazo};`;
        return { ...c, conteudo: novoConteudo };
      }),
    }));
  };

  const updateValoresClausula4 = (patch: Partial<Pick<ContractData, 'valor_total' | 'valor_extenso' | 'parcelas_texto' | 'dados_bancarios'>>) => {
    setContratoForm(prev => {
      const next = { ...prev, ...patch };
      if ('valor_total' in patch && !('valor_extenso' in patch)) {
        next.valor_extenso = numeroPorExtensoReais(next.valor_total);
      }
      const novoTextoClausula4 = buildClause4Text({
        valor_total: next.valor_total,
        valor_extenso: next.valor_extenso,
        parcelas_texto: next.parcelas_texto,
        dados_bancarios: next.dados_bancarios,
      });
      return {
        ...next,
        clausulas: prev.clausulas.map(c => c.id === 'clausula-4' ? { ...c, conteudo: novoTextoClausula4 } : c),
      };
    });
  };

  const recalcularParcelas50 = () => {
    const val = Number(contratoForm.valor_total) || 0;
    const metade = formatCurrency(val / 2);
    const novasParcelas = [
      `**1ª parcela (entrada, 50%):** ${metade}, pagos no ato da assinatura do contrato;`,
      `**2ª parcela (50%):** ${metade}, pagos na conclusão do serviço;`,
    ].join('\n\n');
    updateValoresClausula4({
      valor_extenso: numeroPorExtensoReais(val),
      parcelas_texto: novasParcelas,
    });
  };

  const handleCreate = () => {
    if (!formData.cliente_id) return toast.error('Selecione um cliente.');
    for (const item of itens) {
      if (!item.produto_nome.trim()) {
        return toast.error('Informe o nome do produto/serviço em todos os itens.');
      }
      if (Number(item.desconto) < 0 || Number(item.desconto) > 100) {
        return toast.error('O desconto deve estar entre 0% e 100%.');
      }
      const measures = getFilledMeasures(item);
      if (measures.length === 0) {
        return toast.error(`Preencha quantidade e valor unitário em pelo menos uma medida (Unidade, Kg ou Metro) para "${item.produto_nome}".`);
      }
    }

    createMut.mutate({
      tempId: crypto.randomUUID(),
      payload: {
        ...formData,
        itens: itens.map(i => {
          const measures = getFilledMeasures(i);
          const subtotal = calcMeasuresSubtotal(measures);
          return {
            produto_nome: i.produto_nome,
            unidade: measures.map(m => m.unidade).join('+'),
            quantidade: measures.length === 1 ? measures[0].quantidade : 1,
            valor_unitario: measures.length === 1 ? measures[0].valor_unitario : subtotal,
            desconto: Number(i.desconto) || 0,
            medidas: measures,
          };
        })
      } as QuoteCreatePayload
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#141414] text-white p-8 animate-in fade-in duration-300 relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileText className="text-[#b0fb5d]" size={28} /> {isSerralheria ? 'Orçamentos & Contratos' : 'Propostas & Orçamentos'}
          </h1>
          <div className="flex gap-6 mt-3 border-b border-[#2a2a2a] overflow-x-auto no-scrollbar">
            <button onClick={() => setActiveTab('lista')} className={`pb-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'lista' ? 'border-[#b0fb5d] text-[#b0fb5d]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>Meus Orçamentos</button>
            {isSerralheria && (
              <button onClick={() => setActiveTab('contratos')} className={`pb-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'contratos' ? 'border-[#b0fb5d] text-[#b0fb5d]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>Contratos</button>
            )}
            <button onClick={() => setActiveTab('dashboard')} className={`pb-2 text-sm font-medium transition-colors border-b-2 ${activeTab === 'dashboard' ? 'border-[#b0fb5d] text-[#b0fb5d]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>Métricas & Funil</button>
          </div>
        </div>
        <button onClick={() => { setIsCreating(true); setItens([createEmptyWizardItem()]); }} className="flex items-center gap-2 text-sm px-5 py-2.5 bg-[#b0fb5d] text-black font-bold rounded-lg hover:bg-[#9de44f] transition-all">
          <Plus size={16}/> Novo Orçamento
        </button>
      </div>

      {activeTab === 'dashboard' && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-[#1a1a1a] p-5 rounded-xl border border-[#2a2a2a]">
            <span className="text-gray-400 text-xs font-semibold uppercase">Total Emitido</span>
            <div className="text-2xl font-bold mt-2 text-white">{dashboard?.total_orcamentos || 0}</div>
          </div>
          <div className="bg-[#1a1a1a] p-5 rounded-xl border-t-2 border-t-[#b0fb5d] border-[#2a2a2a] border-l border-r border-b">
            <span className="text-gray-400 text-xs font-semibold uppercase">Receita Aprovada (MRR)</span>
            <div className="text-2xl font-bold mt-2 text-[#b0fb5d]">{formatCurrency(dashboard?.receita_aprovada || 0)}</div>
          </div>
          <div className="bg-[#1a1a1a] p-5 rounded-xl border-t-2 border-t-blue-500 border-[#2a2a2a] border-l border-r border-b">
            <span className="text-gray-400 text-xs font-semibold uppercase">Aguardando Resposta</span>
            <div className="text-2xl font-bold mt-2 text-blue-400">{dashboard?.aguardando_resposta || 0} pendentes</div>
          </div>
          <div className="bg-[#1a1a1a] p-5 rounded-xl border-t-2 border-t-red-500 border-[#2a2a2a] border-l border-r border-b">
            <span className="text-gray-400 text-xs font-semibold uppercase">Vencidos (Follow-up)</span>
            <div className="text-2xl font-bold mt-2 text-red-500">{dashboard?.vencidos || 0} leads frios</div>
          </div>
        </div>
      )}

      {activeTab === 'contratos' && isSerralheria && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-[#2a2a2a] flex gap-4 bg-[#141414]/50">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
              <input value={buscaInput} onChange={e => setBuscaInput(e.target.value)} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg pl-12 pr-4 py-2 text-sm focus:ring-[#b0fb5d] outline-none" placeholder="Buscar contratos..." />
            </div>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#242424] text-gray-400">
                <tr>
                  <th className="p-4 font-medium">Nº do Contrato/Orçamento</th>
                  <th className="p-4 font-medium">Cliente (Razão Social)</th>
                  <th className="p-4 font-medium">Data de Aprovação</th>
                  <th className="p-4 font-medium">Prazo de Entrega</th>
                  <th className="p-4 font-medium">Condições de Pagamento</th>
                  <th className="p-4 font-medium text-right">Valor Total</th>
                  <th className="p-4 font-medium text-center">Status</th>
                  <th className="p-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {isLoadingOrcs ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={`skeleton-contrato-${index}`} aria-hidden="true">
                    {Array.from({ length: 8 }, (_, cell) => <td key={cell} className="p-4"><div className="h-4 rounded bg-[#2a2a2a] animate-pulse" /></td>)}
                  </tr>
                )) : contratosAprovados.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-gray-500">
                      Nenhum contrato gerado a partir de orçamentos aprovados.
                    </td>
                  </tr>
                ) : contratosAprovados.map(o => (
                  <tr key={o.id} className="hover:bg-[#242424] transition-colors group">
                    <td className="p-4 font-mono text-gray-500">#{String(o.numero).padStart(4, '0')}</td>
                    <td onClick={() => void openContractEditor(o)} className="p-4 font-bold text-white group-hover:text-[#b0fb5d] cursor-pointer transition-colors">{o.cliente_nome}</td>
                    <td className="p-4 text-gray-400">{new Date(o.aprovado_em || o.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="p-4 text-gray-400">{o.prazo_entrega || '-'}</td>
                    <td className="p-4 text-gray-400">{o.condicoes_pagamento || '-'}</td>
                    <td className="p-4 text-right font-mono font-medium text-[#b0fb5d]">{formatCurrency(o.valor_total)}</td>
                    <td className="p-4 text-center">
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-green-500/10 text-green-500 border border-green-500/20">
                        {o.status}
                      </span>
                    </td>
                    <td className="p-4 text-right flex justify-end gap-2">
                      <button
                        disabled={loadingContratoId === o.id}
                        onClick={() => void openContractEditor(o)}
                        title="Preencher / Editar Contrato e Cláusulas"
                        className="px-2.5 py-1.5 text-xs font-medium text-[#b0fb5d] bg-[#b0fb5d]/10 hover:bg-[#b0fb5d]/20 border border-[#b0fb5d]/30 rounded transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Edit3 size={14} /> Editar Contrato
                      </button>
                      <button
                        disabled={loadingContratoId === o.id}
                        onClick={() => void handleDownloadContractPdf(o)}
                        title="Baixar PDF do Contrato"
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded transition-colors disabled:opacity-50"
                      >
                        <Download size={16} />
                      </button>
                      <button
                        disabled={apagarMut.isPending}
                        onClick={() => setOrcamentoParaApagar(o)}
                        title="Apagar contrato/orçamento"
                        className="p-1.5 text-red-400 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination meta={orcamentosResponse?.meta ? { ...orcamentosResponse.meta, total: contratosAprovados.length, totalPages: Math.max(1, Math.ceil(contratosAprovados.length / (orcamentosResponse.meta.limit || 50))) } : undefined} onPage={setPage} onLimit={setLimit}/>
          </div>
        </div>
      )}

      {activeTab === 'lista' && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-[#2a2a2a] flex gap-4 bg-[#141414]/50">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
              <input value={buscaInput} onChange={e => setBuscaInput(e.target.value)} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg pl-12 pr-4 py-2 text-sm focus:ring-[#b0fb5d] outline-none" placeholder="Buscar orçamentos..." />
            </div>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#242424] text-gray-400">
                <tr>
                  <th className="p-4 font-medium">Cód.</th>
                  <th className="p-4 font-medium">Cliente (Razão Social)</th>
                  <th className="p-4 font-medium">Data Emissão</th>
                  <th className="p-4 font-medium">Validade</th>
                  <th className="p-4 font-medium text-right">Valor Final</th>
                  <th className="p-4 font-medium text-center">Status</th>
                  <th className="p-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {isLoadingOrcs ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={`skeleton-${index}`} aria-hidden="true">
                    {Array.from({ length: 7 }, (_, cell) => <td key={cell} className="p-4"><div className="h-4 rounded bg-[#2a2a2a] animate-pulse" /></td>)}
                  </tr>
                )) : filteredOrcs.map(o => (
                  <tr key={o.id} className="hover:bg-[#242424] transition-colors group">
                    <td className="p-4 font-mono text-gray-500">#{String(o.numero).padStart(4, '0')}</td>
                    <td className="p-4 font-bold text-white group-hover:text-[#b0fb5d] cursor-pointer transition-colors">{o.cliente_nome}</td>
                    <td className="p-4 text-gray-400">{new Date(o.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="p-4 text-gray-400 flex items-center gap-1.5">{o.validade ? new Date(o.validade).toLocaleDateString('pt-BR') : '-'}</td>
                    <td className="p-4 text-right font-mono font-medium text-[#b0fb5d]">{formatCurrency(o.valor_total)}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${o.status === 'APROVADO' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : o.status === 'ENVIADO' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : o.status === 'RASCUNHO' ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20' : o.status === 'REPROVADO' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="p-4 text-right flex justify-end gap-2">
                      {['RASCUNHO', 'ENVIADO', 'VISUALIZADO'].includes(o.status) && <>
                        <button disabled={aprovarMut.isPending} onClick={() => approveQuote(o)} title="Aprovar orçamento" className="p-1.5 text-green-400 hover:bg-green-500/20 rounded transition-colors disabled:opacity-50"><CheckCircle2 size={16}/></button>
                        <button disabled={reprovarMut.isPending} onClick={() => { const motivo=window.prompt('Motivo da reprovação:'); if(motivo) reprovarMut.mutate({id:o.id,motivo}); }} title="Reprovar orçamento" className="p-1.5 text-red-400 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"><XCircle size={16}/></button>
                      </>}
                      <button disabled={apagarMut.isPending} onClick={() => setOrcamentoParaApagar(o)} title="Apagar orçamento" className="p-1.5 text-red-400 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"><Trash2 size={16}/></button>
                      <button disabled={pdfMut.isPending} onClick={() => pdfMut.mutate(o.id)} title="Baixar PDF" className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded transition-colors disabled:opacity-50"><Download size={16}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination meta={orcamentosResponse?.meta} onPage={setPage} onLimit={setLimit}/>
          </div>
        </div>
      )}

      {/* WIZARD DE CRIAÇÃO (DRAWER) */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setIsCreating(false)} />
          <div className="relative w-full max-w-4xl bg-[#141414] border-l border-[#2a2a2a] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            <div className="p-6 border-b border-[#2a2a2a] bg-[#0a0a0a] flex justify-between items-center">
               <h2 className="text-xl font-bold text-white flex items-center gap-2">Novo Orçamento <span className="text-gray-500 text-sm font-normal">Passo {wizardStep} de 2</span></h2>
               <button onClick={() => setIsCreating(false)} className="text-gray-500 hover:text-white"><X size={20}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {wizardStep === 1 && (
                <div className="space-y-6 animate-in slide-in-from-left-4">
                  <section>
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase mb-4 flex items-center gap-2"><User size={16}/> Dados do Cliente</h3>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Cliente Cadastrado *</label>
                      <select disabled={isLoadingClientes} value={formData.cliente_id} onChange={e => setFormData({...formData, cliente_id: e.target.value})} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none disabled:opacity-60">
                        <option value="">{isLoadingClientes ? 'Carregando clientes…' : isErrorClientes ? 'Falha ao carregar clientes' : '-- Selecione --'}</option>
                        {clientes.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.documento})</option>)}
                      </select>
                    </div>
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Tipo de orçamento *</label>
                      <select value={formData.tipo} onChange={e => setFormData({...formData, tipo:e.target.value})} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none">
                        <option value="SERVICO">Serviço / produção</option>
                        {canCreateRentalQuote && <option value="LOCACAO">Locação</option>}
                      </select>
                    </div>
                  </section>
                  <section>
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase mb-4 mt-8 flex items-center gap-2"><Clock size={16}/> Prazos e Condições</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Validade da Proposta</label>
                        <input type="date" value={formData.validade} onChange={e => setFormData({...formData, validade: e.target.value})} className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none [color-scheme:dark]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Condições de Pagamento</label>
                        <input value={formData.condicoes_pagamento} onChange={e => setFormData({...formData, condicoes_pagamento: e.target.value})} placeholder="Ex: 50% Entrada, 50% na Entrega" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Prazo de Entrega</label>
                        <input maxLength={200} value={formData.prazo_entrega} onChange={e => setFormData({...formData, prazo_entrega: e.target.value})} placeholder="Ex: 15 dias úteis após aprovação" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Observações</label>
                        <input maxLength={1000} value={formData.observacoes} onChange={e => setFormData({...formData, observacoes: e.target.value})} placeholder="Detalhes adicionais para o cliente" className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 flex flex-col md:flex-row gap-6">
                  {/* Tabela de Itens */}
                  <div className="flex-1 space-y-4">
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase mb-2">Composição de Itens</h3>
                    {itens.map((item, idx) => (
                      <div key={item.id} className="bg-[#1a1a1a] border border-[#2a2a2a] p-4 rounded-xl flex items-start gap-4">
                        <div className="flex-1 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div className="sm:col-span-3">
                              <label className="text-[10px] text-gray-500 uppercase">Produto / Serviço</label>
                              <input placeholder="Nome do Produto / Serviço" value={item.produto_nome} onChange={e => { const newI = [...itens]; newI[idx] = { ...newI[idx], produto_nome: e.target.value }; setItens(newI); }} className="w-full bg-[#242424] border border-[#3a3a3a] rounded px-3 py-2 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 uppercase">Desc. (%)</label>
                              <input type="number" min="0" max="100" step="0.01" value={item.desconto} onChange={e => { const newI = [...itens]; newI[idx] = { ...newI[idx], desconto: Number(e.target.value) }; setItens(newI); }} className="w-full bg-[#242424] border border-[#3a3a3a] rounded px-3 py-2 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                            </div>
                          </div>

                          {/* Seleção de medidas ativas (permite ativar 1, 2 ou as 3 ao mesmo tempo) */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span className="text-[10px] text-gray-400 uppercase font-semibold mr-1">Medidas no item:</span>
                            {UNIT_ORDER.map(unit => {
                              const isActive = item.unidades_ativas.includes(unit);
                              return (
                                <button
                                  key={unit}
                                  type="button"
                                  onClick={() => {
                                    const newI = [...itens];
                                    const current = newI[idx].unidades_ativas;
                                    if (isActive && current.length === 1) return;
                                    const nextUnits = isActive ? current.filter(u => u !== unit) : UNIT_ORDER.filter(u => current.includes(u) || u === unit);
                                    newI[idx] = { ...newI[idx], unidades_ativas: nextUnits };
                                    setItens(newI);
                                  }}
                                  className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${isActive ? 'bg-[#b0fb5d]/15 text-[#b0fb5d] border-[#b0fb5d]/40' : 'bg-[#242424] text-gray-400 border-[#3a3a3a] hover:text-white'}`}
                                >
                                  {isActive ? '✓ ' : '+ '}{UNIT_FULL_LABEL[unit]}
                                </button>
                              );
                            })}
                          </div>

                          {/* Campos de Quantidade e Valor Unitário para cada medida ativa (Unidade, Kg, Metro) */}
                          <div className="space-y-2 pt-1">
                            {UNIT_ORDER.filter(unit => item.unidades_ativas.includes(unit)).map(unit => {
                              const measureVal = item.medidas_valores[unit] || { quantidade: 0, valor_unitario: 0 };
                              const measureSubtotal = (Number(measureVal.quantidade) || 0) * (Number(measureVal.valor_unitario) || 0);
                              return (
                                <div key={unit} className="grid grid-cols-12 gap-2 items-end bg-[#141414]/70 border border-[#2a2a2a] rounded-lg p-2.5">
                                  <div className="col-span-3">
                                    <span className="text-[10px] text-gray-400 uppercase block">Medida</span>
                                    <span className="text-xs font-bold text-[#b0fb5d]">{UNIT_FULL_LABEL[unit]}</span>
                                  </div>
                                  <div className="col-span-4">
                                    <label className="text-[10px] text-gray-500 uppercase block">Qtd ({UNIT_SHORT_LABEL[unit]})</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step={unit === 'UN' ? '1' : '0.01'}
                                      value={measureVal.quantidade}
                                      onChange={e => {
                                        const newI = [...itens];
                                        newI[idx] = {
                                          ...newI[idx],
                                          medidas_valores: {
                                            ...newI[idx].medidas_valores,
                                            [unit]: { ...measureVal, quantidade: Number(e.target.value) },
                                          },
                                        };
                                        setItens(newI);
                                      }}
                                      className="w-full bg-[#242424] border border-[#3a3a3a] rounded px-2.5 py-1.5 text-sm text-white focus:ring-[#b0fb5d] outline-none"
                                    />
                                  </div>
                                  <div className="col-span-3">
                                    <label className="text-[10px] text-gray-500 uppercase block">Valor Unit. (R$/{UNIT_SHORT_LABEL[unit]})</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={measureVal.valor_unitario}
                                      onChange={e => {
                                        const newI = [...itens];
                                        newI[idx] = {
                                          ...newI[idx],
                                          medidas_valores: {
                                            ...newI[idx].medidas_valores,
                                            [unit]: { ...measureVal, valor_unitario: Number(e.target.value) },
                                          },
                                        };
                                        setItens(newI);
                                      }}
                                      className="w-full bg-[#242424] border border-[#3a3a3a] rounded px-2.5 py-1.5 text-sm text-white focus:ring-[#b0fb5d] outline-none"
                                    />
                                  </div>
                                  <div className="col-span-2 text-right">
                                    <span className="text-[10px] text-gray-500 uppercase block">Subtotal</span>
                                    <span className="text-xs font-mono font-semibold text-gray-200">{formatCurrency(measureSubtotal)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <button onClick={() => setItens(itens.filter(i => i.id !== item.id))} className="text-red-500 hover:bg-red-500/20 p-2 rounded transition-colors mt-6"><Trash2 size={16}/></button>
                      </div>
                    ))}
                    <button onClick={() => setItens([...itens, createEmptyWizardItem()])} className="w-full py-3 border-2 border-dashed border-[#2a2a2a] rounded-xl text-gray-500 hover:text-[#b0fb5d] hover:border-[#b0fb5d] transition-colors text-sm font-bold flex justify-center items-center gap-2">
                      <Plus size={16}/> Adicionar Linha
                    </button>
                  </div>

                  {/* Prévia do PDF / Resumo */}
                  <div className="w-[300px] shrink-0 bg-white text-black p-6 rounded-lg shadow-xl relative aspect-[1/1.4] overflow-hidden opacity-90 scale-95 origin-top">
                    <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-gray-100 z-0"></div>
                    <div className="relative z-10 flex flex-col h-full">
                       <h4 className="text-xl font-black mb-4 uppercase text-[#b0fb5d] bg-black p-2 rounded">Sua Empresa</h4>
                       <p className="text-[10px] text-gray-500 border-b pb-2">Orçamento #{String(Date.now()).slice(-4)}</p>
                       <div className="mt-4 flex-1">
                          <p className="text-[10px] font-bold text-gray-800">ITENS</p>
                          {itens.map((i, idx) => {
                            const measures = getFilledMeasures(i);
                            const measuresSummary = measures.length > 0
                              ? measures.map(m => `${m.quantidade}${UNIT_SHORT_LABEL[m.unidade]}`).join(' + ')
                              : '0un';
                            return (
                              <div key={idx} className="flex justify-between text-[10px] border-b border-gray-100 py-1 gap-1">
                                 <span className="truncate w-24 font-medium">{i.produto_nome || 'Item...'}</span>
                                 <span className="text-gray-600">{measuresSummary}{Number(i.desconto) > 0 ? ` (-${i.desconto}%)` : ''}</span>
                                 <span className="font-semibold">{formatCurrency(calcWizardItemTotal(i))}</span>
                              </div>
                            );
                          })}
                       </div>
                       <div className="border-t-2 border-black pt-2 flex justify-between items-end mt-4">
                          <span className="text-xs font-bold">TOTAL FINAL</span>
                          <span className="text-lg font-black text-green-600">{formatCurrency(totalWizard)}</span>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-6 border-t border-[#2a2a2a] bg-[#0a0a0a] flex justify-between">
              <button onClick={() => wizardStep === 1 ? setIsCreating(false) : setWizardStep(1)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
                {wizardStep === 1 ? 'Cancelar' : 'Voltar'}
              </button>
              {wizardStep === 1 ? (
                 <button onClick={() => setWizardStep(2)} className="bg-[#2a2a2a] text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#3a3a3a]">Próximo: Itens & Valores</button>
              ) : (
                 <button onClick={handleCreate} disabled={createMut.isPending} className="bg-[#b0fb5d] text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#9de44f] flex items-center gap-2">
                   <Send size={16}/> {createMut.isPending ? 'Salvando...' : 'Salvar Orçamento'}
                 </button>
              )}
            </div>
          </div>
        </div>
      )}

      {orcamentoParaAprovar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOrcamentoParaAprovar(null)} />
          <div className="relative w-full max-w-md rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-white">Aprovar locação</h2>
                <p className="text-xs text-gray-400 mt-1">A conta a receber será gerada automaticamente.</p>
              </div>
              <button onClick={() => setOrcamentoParaAprovar(null)} className="text-gray-500 hover:text-white"><X size={20}/></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-xs text-gray-400">Início da locação
                <input type="date" value={periodoLocacao.data_inicio} onChange={event => setPeriodoLocacao({...periodoLocacao, data_inicio: event.target.value})} className="mt-1.5 w-full rounded-lg border border-[#2a2a2a] bg-[#242424] px-3 py-2.5 text-sm text-white outline-none [color-scheme:dark] focus:ring-1 focus:ring-[#b0fb5d]" />
              </label>
              <label className="text-xs text-gray-400">Fim da locação
                <input type="date" value={periodoLocacao.data_fim_prevista} onChange={event => setPeriodoLocacao({...periodoLocacao, data_fim_prevista: event.target.value})} className="mt-1.5 w-full rounded-lg border border-[#2a2a2a] bg-[#242424] px-3 py-2.5 text-sm text-white outline-none [color-scheme:dark] focus:ring-1 focus:ring-[#b0fb5d]" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setOrcamentoParaAprovar(null)} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
              <button onClick={confirmarAprovacaoLocacao} disabled={aprovarMut.isPending} className="rounded-lg bg-[#b0fb5d] px-5 py-2.5 text-sm font-bold text-black hover:bg-[#9de44f] disabled:opacity-50">
                {aprovarMut.isPending ? 'Aprovando…' : 'Aprovar e gerar conta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {orcamentoParaApagar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOrcamentoParaApagar(null)} />
          <div className="relative w-full max-w-md rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Trash2 size={18} className="text-red-400" />
                Apagar orçamento #{String(orcamentoParaApagar.numero).padStart(4, '0')}?
              </h2>
              <button onClick={() => setOrcamentoParaApagar(null)} className="text-gray-500 hover:text-white"><X size={20}/></button>
            </div>
            <p className="text-sm text-gray-400">
              Tem certeza que deseja apagar o orçamento de <strong className="text-white">{orcamentoParaApagar.cliente_nome}</strong>? Ele será removido da lista.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setOrcamentoParaApagar(null)} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
              <button onClick={() => apagarMut.mutate(orcamentoParaApagar.id)} disabled={apagarMut.isPending} className="rounded-lg bg-red-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-50">
                {apagarMut.isPending ? 'Apagando…' : 'Apagar Orçamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER DE EDIÇÃO DO CONTRATO (EM ABAS, SEM CAMPOS OBRIGATÓRIOS) */}
      {contratoEditando && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setContratoEditando(null)} />
          <div className="relative w-full max-w-4xl bg-[#141414] border-l border-[#2a2a2a] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            <div className="p-6 border-b border-[#2a2a2a] bg-[#0a0a0a] flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <FileSignature className="text-[#b0fb5d]" size={22} />
                  Contrato #{String(contratoEditando.numero).padStart(4, '0')} · {contratoEditando.cliente_nome}
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Nenhum campo é obrigatório. Preencha apenas o que desejar personalizar para este cliente e edite ou adicione cláusulas livremente.
                </p>
              </div>
              <button onClick={() => setContratoEditando(null)} className="text-gray-500 hover:text-white"><X size={20}/></button>
            </div>

            {/* Abas do Editor de Contrato */}
            <div className="flex gap-2 px-6 pt-3 border-b border-[#2a2a2a] bg-[#101010] overflow-x-auto no-scrollbar">
              {[
                { id: 'partes', label: '1. Contratante e Contratado' },
                { id: 'objeto_prazos', label: '2. Objeto, Prazos e Data' },
                { id: 'valores_pagamento', label: '3. Valores e Pagamento' },
                { id: 'clausulas', label: `4. Cláusulas (${contratoForm.clausulas.length})` },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setContratoTab(tab.id as typeof contratoTab)}
                  className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    contratoTab === tab.id
                      ? 'border-[#b0fb5d] text-[#b0fb5d]'
                      : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {contratoTab === 'partes' && (
                <div className="space-y-6">
                  <section className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider">Cabeçalho do Contrato</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Título Principal (opcional)</label>
                        <input
                          value={contratoForm.titulo_principal}
                          onChange={e => setContratoForm({ ...contratoForm, titulo_principal: e.target.value })}
                          placeholder="CONTRATO DE PRESTAÇÃO DE SERVIÇOS"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Subtítulo (opcional)</label>
                        <input
                          value={contratoForm.subtitulo}
                          onChange={e => setContratoForm({ ...contratoForm, subtitulo: e.target.value })}
                          placeholder="SERRALHERIA ARTSTEEL"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider">Dados do Contratante (Cliente)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome / Razão Social (opcional)</label>
                        <input
                          value={contratoForm.contratante_nome}
                          onChange={e => setContratoForm({ ...contratoForm, contratante_nome: e.target.value })}
                          placeholder="Ex: Alessandra Maria Afonso Teixeira"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">CPF / CNPJ (opcional)</label>
                        <input
                          value={contratoForm.contratante_documento}
                          onChange={e => setContratoForm({ ...contratoForm, contratante_documento: e.target.value })}
                          placeholder="000.000.000-00"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Estado Civil (opcional)</label>
                        <input
                          value={contratoForm.contratante_estado_civil}
                          onChange={e => setContratoForm({ ...contratoForm, contratante_estado_civil: e.target.value })}
                          placeholder="Ex: Casada, Solteiro(a)..."
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Profissão (opcional)</label>
                        <input
                          value={contratoForm.contratante_profissao}
                          onChange={e => setContratoForm({ ...contratoForm, contratante_profissao: e.target.value })}
                          placeholder="Ex: Advogada, Empresário..."
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Informações para Contato (opcional)</label>
                        <input
                          value={contratoForm.contratante_contato}
                          onChange={e => setContratoForm({ ...contratoForm, contratante_contato: e.target.value })}
                          placeholder="E-mail e/ou telefone"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Endereço Residencial / Comercial (opcional)</label>
                        <input
                          value={contratoForm.contratante_endereco}
                          onChange={e => setContratoForm({ ...contratoForm, contratante_endereco: e.target.value })}
                          placeholder="Rua, número, bairro, cidade - UF, CEP"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                    </div>
                    <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg p-3 text-xs text-gray-300">
                      <span className="font-bold text-white">Prévia no PDF — CONTRATANTE: </span>
                      {buildContratanteQualification(contratoForm) || <span className="text-gray-500 italic">(Em branco)</span>}
                    </div>
                  </section>

                  <section className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider">Dados do Contratado (ArtSteel)</h3>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Qualificação do Contratado (opcional)</label>
                      <textarea
                        rows={3}
                        value={contratoForm.contratado_qualificacao}
                        onChange={e => setContratoForm({ ...contratoForm, contratado_qualificacao: e.target.value })}
                        className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome na Linha de Assinatura do Contratado (opcional)</label>
                      <input
                        value={contratoForm.contratado_nome_assinatura}
                        onChange={e => setContratoForm({ ...contratoForm, contratado_nome_assinatura: e.target.value })}
                        placeholder="FILOMENO SERVICOS LTDA (Filomeno Pereira Neto)"
                        className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                      />
                    </div>
                  </section>
                </div>
              )}

              {contratoTab === 'objeto_prazos' && (
                <div className="space-y-6">
                  <section className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider">Cláusula 1 – Objeto do Contrato</h3>
                    <p className="text-xs text-gray-400">
                      Descreve o serviço/produto contratado. Alterar este campo atualiza automaticamente o texto da Cláusula 1.
                    </p>
                    <textarea
                      rows={3}
                      value={contratoForm.objeto_resumo}
                      onChange={e => updateObjetoResumo(e.target.value)}
                      placeholder="Ex: O presente contrato tem por objeto a produção e instalação de um guarda corpo e um corrimão."
                      className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                    />
                  </section>

                  <section className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider">Prazo de Execução e Local/Data</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Prazo de Execução (Cláusula 3, item e)</label>
                        <input
                          value={contratoForm.prazo_execucao}
                          onChange={e => updatePrazoExecucao(e.target.value)}
                          placeholder="Ex: 30 dias após a assinatura do contrato"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Cidade / UF da Assinatura</label>
                        <input
                          value={contratoForm.cidade_assinatura}
                          onChange={e => setContratoForm({ ...contratoForm, cidade_assinatura: e.target.value })}
                          placeholder="Timóteo -MG"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Data da Assinatura</label>
                        <input
                          value={contratoForm.data_assinatura}
                          onChange={e => setContratoForm({ ...contratoForm, data_assinatura: e.target.value })}
                          placeholder="DD/MM/AAAA"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {contratoTab === 'valores_pagamento' && (
                <div className="space-y-6">
                  <section className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider">Cláusula 4 – Valor e Forma de Pagamento</h3>
                      <button
                        type="button"
                        onClick={recalcularParcelas50}
                        className="text-xs px-3 py-1.5 rounded bg-[#242424] hover:bg-[#333] text-[#b0fb5d] border border-[#3a3a3a] transition-colors"
                      >
                        Calcular 50% Entrada / 50% Conclusão automaticamente
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Valor Total do Contrato (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={contratoForm.valor_total}
                          onChange={e => updateValoresClausula4({ valor_total: e.target.value })}
                          placeholder="4000.00"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Valor por Extenso (opcional)</label>
                        <input
                          value={contratoForm.valor_extenso}
                          onChange={e => updateValoresClausula4({ valor_extenso: e.target.value })}
                          placeholder="quatro mil reais"
                          className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Parcelas / Condições de Pagamento (use **texto** para negrito)</label>
                      <textarea
                        rows={4}
                        value={contratoForm.parcelas_texto}
                        onChange={e => updateValoresClausula4({ parcelas_texto: e.target.value })}
                        placeholder="**1ª parcela (entrada, 50%):** R$ 2.000,00, pagos no ato da assinatura do contrato;"
                        className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Dados Bancários / PIX (use **texto** para negrito)</label>
                      <textarea
                        rows={3}
                        value={contratoForm.dados_bancarios}
                        onChange={e => updateValoresClausula4({ dados_bancarios: e.target.value })}
                        className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                      />
                    </div>
                  </section>
                </div>
              )}

              {contratoTab === 'clausulas' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider">Cláusulas do Contrato</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Edite livremente o título ou o conteúdo de qualquer cláusula, ou adicione novas cláusulas ao contrato.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const padrao = buildDefaultContractData({
                          numero: contratoEditando.numero,
                          status: contratoEditando.status,
                          valor_total: contratoForm.valor_total || contratoEditando.valor_total,
                          prazo_entrega: contratoForm.prazo_execucao || contratoEditando.prazo_entrega,
                          cliente_nome: contratoForm.contratante_nome || contratoEditando.cliente_nome,
                          itens: [],
                        });
                        setContratoForm(prev => ({ ...prev, clausulas: padrao.clausulas }));
                        toast.success('Cláusulas padrão restauradas.');
                      }}
                      className="text-xs px-3 py-1.5 rounded bg-[#242424] hover:bg-[#333] text-gray-300 border border-[#3a3a3a] flex items-center gap-1.5 transition-colors"
                    >
                      <RotateCcw size={13} /> Restaurar Cláusulas Padrão
                    </button>
                  </div>

                  {contratoForm.clausulas.map((clausula, idx) => (
                    <div key={clausula.id} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <input
                          value={clausula.titulo}
                          onChange={e => {
                            const novas = [...contratoForm.clausulas];
                            novas[idx] = { ...novas[idx], titulo: e.target.value };
                            setContratoForm({ ...contratoForm, clausulas: novas });
                          }}
                          placeholder={`CLÁUSULA ${idx + 1} – TÍTULO DA CLÁUSULA`}
                          className="flex-1 bg-[#242424] border border-[#3a3a3a] rounded-lg px-3 py-2 text-xs font-bold text-[#b0fb5d] uppercase outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setContratoForm({
                              ...contratoForm,
                              clausulas: contratoForm.clausulas.filter((_, i) => i !== idx),
                            })
                          }
                          title="Remover cláusula"
                          className="p-2 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <textarea
                        rows={5}
                        value={clausula.conteudo}
                        onChange={e => {
                          const novas = [...contratoForm.clausulas];
                          novas[idx] = { ...novas[idx], conteudo: e.target.value };
                          setContratoForm({ ...contratoForm, clausulas: novas });
                        }}
                        placeholder="Texto da cláusula..."
                        className="w-full bg-[#242424] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]"
                      />
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => {
                      const nextNum = contratoForm.clausulas.length + 1;
                      setContratoForm({
                        ...contratoForm,
                        clausulas: [
                          ...contratoForm.clausulas,
                          {
                            id: `clausula-${Date.now()}`,
                            titulo: `CLÁUSULA ${nextNum} – NOVA CLÁUSULA`,
                            conteudo: '',
                          },
                        ],
                      });
                    }}
                    className="w-full py-3 border-2 border-dashed border-[#2a2a2a] rounded-xl text-gray-400 hover:text-[#b0fb5d] hover:border-[#b0fb5d] transition-colors text-sm font-bold flex justify-center items-center gap-2"
                  >
                    <Plus size={16} /> Adicionar Nova Cláusula
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-[#2a2a2a] bg-[#0a0a0a] flex flex-wrap justify-between items-center gap-3">
              <button
                type="button"
                onClick={() => setContratoEditando(null)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Cancelar
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={savingContrato}
                  onClick={() => void handleSaveContract(false)}
                  className="bg-[#2a2a2a] text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-[#3a3a3a] disabled:opacity-50"
                >
                  {savingContrato ? 'Salvando…' : 'Salvar Alterações'}
                </button>
                <button
                  type="button"
                  disabled={savingContrato}
                  onClick={() => void handleSaveContract(true)}
                  className="bg-[#b0fb5d] text-black px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-[#9de44f] flex items-center gap-2 disabled:opacity-50"
                >
                  <Download size={16} /> {savingContrato ? 'Gerando…' : 'Salvar e Baixar PDF'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation';
import { Download, Plus, Search, TrendingUp, TrendingDown, AlertCircle, Bell, FileText, X, CheckCircle2, Clock, CalendarDays, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {Pagination} from '@/components/Pagination';
import { useRouter, useSearchParams } from 'next/navigation';
import { IMaskInput } from 'react-imask';
import * as XLSX from 'xlsx';
import { useTenantStore } from '@/stores/useTenantStore';
import { useFormDraft } from '@/hooks/useFormDraft';

type Transacao = {
  id: string;
  tipo: 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA';
  descricao: string;
  valor: string | number; // A API retorna numeric como string; o formulário envia número.
  data_competencia: string;
  data_vencimento: string;
  data_pagamento: string | null;
  status: 'PENDENTE' | 'PAGO' | 'ATRASADO' | 'CANCELADO';
  categoria: string;
  conta_bancaria: string;
  cliente_id: string | null;
  valor_pago?: string | number;
  saldo_aberto?: string | number;
  pagamentos?: Pagamento[];
};

type Pagamento = {
  id: string;
  valor: string | number;
  valor_dispensado: string | number;
  metodo: string;
  metodo_outro: string | null;
  data_pagamento: string;
  observacao: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
  revertido_em: string | null;
  revertido_por_nome: string | null;
  justificativa_reversao?: string;
};

type LembreteBucket = { quantidade: number; total: number };
type ProximaConta = {
  id: string;
  descricao: string;
  valor: number;
  saldo_aberto: number;
  data_vencimento: string;
  status: string;
  categoria: string;
  dias_para_vencer: number;
};
type DashboardData = {
  saldo_atual: number;
  receitas_pendentes: number;
  despesas_pendentes: number;
  lembretes_a_pagar?: {
    vencidas: LembreteBucket;
    vence_hoje: LembreteBucket;
    proximos_7_dias: LembreteBucket;
    proximas_contas: ProximaConta[];
  };
};
type TransacoesPage = { data: Transacao[]; meta: { page: number; limit: number; total: number; totalPages: number } };
type FinanceSnapshot = Array<[QueryKey, unknown]>;

function parseCurrencyInput(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  return Number(normalized);
}

export default function FinanceiroModule() {
  const queryClient = useQueryClient();
  const activeTenant = useTenantStore((s) => s.activeTenant);
  const params=useSearchParams(),router=useRouter();const busca=params.get('q')??'',page=Number(params.get('page')??'1'),limit=Number(params.get('limit')??'50');
  const parseTab = (value: string | null): 'lancamentos' | 'a_pagar' | 'a_receber' | 'conciliacao' =>
    value === 'a_pagar' || value === 'a_receber' || value === 'conciliacao' || value === 'lancamentos' ? value : 'lancamentos';
  const [activeTab, setActiveTab] = useState<'lancamentos' | 'a_pagar' | 'a_receber' | 'conciliacao'>(() => parseTab(params.get('tab')));
  useEffect(() => {
    const nextTab = parseTab(params.get('tab'));
    setActiveTab(current => current === nextTab ? current : nextTab);
  }, [params]);
  const selectTab = (tab: 'lancamentos' | 'a_pagar' | 'a_receber' | 'conciliacao') => {
    setActiveTab(tab);
    const next = new URLSearchParams(params.toString());
    if (tab === 'lancamentos') next.delete('tab');
    else next.set('tab', tab);
    next.set('page', '1');
    router.replace(`/financeiro?${next}`);
  };
  const [buscaInput, setBuscaInput] = useState(busca);
  useEffect(() => setBuscaInput(busca), [busca]);
  useEffect(() => {
    if (buscaInput === busca) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      const normalized = buscaInput.trim();
      normalized ? next.set('q', normalized) : next.delete('q');
      next.set('page', '1');
      router.replace(`/financeiro?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [buscaInput, busca, params, router]);
  const setBusca=(value:string)=>setBuscaInput(value);
  const setPage=(value:number)=>{const next=new URLSearchParams(params.toString());next.set('page',String(value));router.replace(`/financeiro?${next}`)};
  const setLimit=(value:number)=>{const next=new URLSearchParams(params.toString());next.set('limit',String(value));next.set('page','1');router.replace(`/financeiro?${next}`)};
  const [transacaoAberta, setTransacaoAberta] = useState<Transacao | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [valorForm, setValorForm] = useState('');
  const financeFormRef = useRef<HTMLFormElement>(null);
  const FINANCE_DRAFT_FIELDS = ['tipo', 'descricao', 'categoria', 'conta_bancaria', 'data_vencimento', 'data_competencia', 'status'] as const;
  const { loadDraft, saveDraft, clearDraft, hasDraft } = useFormDraft<Record<string, string>>(`financeiro:${activeTenant?.id ?? 'default'}`, isCreating && !transacaoAberta);
  const syncFinanceDraft = (valorOverride?: string) => {
    if (!isCreating || transacaoAberta || !financeFormRef.current) return;
    const fd = new FormData(financeFormRef.current);
    const next: Record<string, string> = { valor: valorOverride ?? valorForm };
    for (const field of FINANCE_DRAFT_FIELDS) next[field] = String(fd.get(field) ?? '');
    saveDraft(next);
  };
  const resetFinanceDraft = () => {
    clearDraft();
    setValorForm('');
    financeFormRef.current?.reset();
  };
  useEffect(() => {
    if (isCreating && !transacaoAberta) {
      const draft = loadDraft();
      setValorForm(draft?.valor ?? '');
      requestAnimationFrame(() => {
        if (!financeFormRef.current) return;
        financeFormRef.current.reset();
        if (!draft) return;
        for (const field of FINANCE_DRAFT_FIELDS) {
          const el = financeFormRef.current.elements.namedItem(field) as HTMLInputElement | HTMLSelectElement | null;
          if (el && draft[field] !== undefined) el.value = draft[field];
        }
      });
      return;
    }
    setValorForm(transacaoAberta?.valor != null ? String(transacaoAberta.valor).replace('.', ',') : '');
  }, [isCreating, transacaoAberta, activeTenant?.id]);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [baixaAlvo, setBaixaAlvo] = useState<Transacao | null>(null);
  const [valorBaixa, setValorBaixa] = useState('');
  const [dataBaixa, setDataBaixa] = useState(new Date().toISOString().slice(0, 10));
  const [metodoBaixa, setMetodoBaixa] = useState('');
  const [metodoOutro, setMetodoOutro] = useState('');
  const [observacaoBaixa, setObservacaoBaixa] = useState('');
  const [acaoParcial, setAcaoParcial] = useState<'MANTER_ABERTO' | 'QUITAR' | ''>('');
  const [reversaoAlvo, setReversaoAlvo] = useState<Transacao | null>(null);
  const [justificativaReversao, setJustificativaReversao] = useState('');
  const isOwner = activeTenant?.role === 'ADMIN';
  const canManagePayments = isOwner || activeTenant?.role === 'FINANCEIRO';
  const transactionListPrefix = ['financeiro', 'transacoes', activeTenant?.id] as const;
  const transactionListKey = [...transactionListPrefix, page, busca, limit, activeTab] as const;
  const financeDashboardKey = ['financeiro', 'dashboard', activeTenant?.id] as const;

  // Queries isoladas por empresa ativa
  const { data: dashboard, isLoading: isLoadingDash } = useQuery({
    queryKey: ['financeiro', 'dashboard', activeTenant?.id],
    queryFn: () => api<DashboardData>('/financeiro/dashboard'),
    enabled: Boolean(activeTenant?.id),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });

  const buildTransactionQuery = (targetPage: number, targetLimit: number) => {
    const qs = new URLSearchParams({
      page: String(targetPage),
      limit: String(targetLimit),
      search: busca,
    });
    if (activeTab === 'a_pagar') {
      qs.set('tipo', 'DESPESA');
      qs.set('status', 'ABERTO');
      qs.set('sort', 'data_vencimento:asc');
    } else if (activeTab === 'a_receber') {
      qs.set('tipo', 'RECEITA');
      qs.set('status', 'ABERTO');
      qs.set('sort', 'data_vencimento:asc');
    }
    return qs.toString();
  };

  const { data: transacoesResponse, isLoading: isLoadingTransacoes } = useQuery({
    queryKey: transactionListKey,
    queryFn: ({ signal }) => api<TransacoesPage>(`/financeiro/transacoes?${buildTransactionQuery(page, limit)}`, { signal }),
    enabled: Boolean(activeTenant?.id),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnMount: true,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === activeTenant?.id ? previous : undefined,
  });
  const transacoes=transacoesResponse?.data??[];

  // Filtros Avançados
  const filtrarPorAba = (items: Transacao[]) => {
    let filtrado = items;
    
    // Filtro de aba
    if (activeTab === 'a_pagar') {
      filtrado = filtrado.filter(t => t.tipo === 'DESPESA' && (t.status === 'PENDENTE' || t.status === 'ATRASADO'));
    } else if (activeTab === 'a_receber') {
      filtrado = filtrado.filter(t => t.tipo === 'RECEITA' && (t.status === 'PENDENTE' || t.status === 'ATRASADO'));
    }

    // Filtro de busca
    if (busca) {
      const termo = busca.toLowerCase();
      filtrado = filtrado.filter(t => 
        t.descricao.toLowerCase().includes(termo) || 
        t.categoria.toLowerCase().includes(termo) ||
        t.conta_bancaria.toLowerCase().includes(termo)
      );
    }

    if (activeTab === 'a_pagar' || activeTab === 'a_receber') {
      return [...filtrado].sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''));
    }
    
    return filtrado;
  };

  const transacoesFiltradas = useMemo(() => filtrarPorAba(transacoes), [transacoes, activeTab, busca]);

  const excelText = (value: unknown) => {
    const text = String(value ?? '');
    // Evita que planilhas interpretem campos exportados como fórmulas.
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  };

  const gerarRelatorio = async () => {
    setGerandoRelatorio(true);
    try {
      const firstPage = await api<{data:Transacao[];meta:{totalPages:number}}>(`/financeiro/transacoes?${buildTransactionQuery(1, 100)}`);
      const pages: Array<{data:Transacao[]}> = [];
      for (let pageNumber = 2; pageNumber <= firstPage.meta.totalPages; pageNumber += 2) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(2, firstPage.meta.totalPages - pageNumber + 1) }, (_, index) =>
            api<{data:Transacao[]}>(`/financeiro/transacoes?${buildTransactionQuery(pageNumber + index, 100)}`),
          ),
        );
        pages.push(...batch);
      }
      const rows = filtrarPorAba([...firstPage.data, ...pages.flatMap((pageData) => pageData.data)]);
      const headers = ['Vencimento', 'Competência', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Status', 'Valor'];
      const entradas = rows.filter((row) => row.tipo === 'RECEITA').reduce((sum, row) => sum + Number(row.valor), 0);
      const saidas = rows.filter((row) => row.tipo === 'DESPESA').reduce((sum, row) => sum + Number(row.valor), 0);
      const worksheet = XLSX.utils.aoa_to_sheet([
        headers,
        ...rows.map((row) => [
          row.data_vencimento,
          row.data_competencia,
          excelText(row.tipo),
          excelText(row.descricao),
          excelText(row.categoria),
          excelText(row.conta_bancaria),
          excelText(row.status),
          Number(row.valor),
        ]),
        [],
        ['Totais', 'Entradas', entradas],
        ['Totais', 'Saídas', saidas],
        ['Totais', 'Balanço', entradas - saidas],
      ]);
      worksheet['!cols'] = [
        { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 34 },
        { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 14 },
      ];
      worksheet['!autofilter'] = { ref: `A1:H${rows.length + 1}` };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Transacoes');
      const slug = activeTenant?.nome_fantasia ? activeTenant.nome_fantasia.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'financeiro';
      XLSX.writeFile(workbook, `relatorio-financeiro-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Relatório gerado com ${rows.length} lançamento(s).`);
    } catch (error) {
      toast.error((error as Error).message || 'Não foi possível gerar o relatório.');
    } finally {
      setGerandoRelatorio(false);
    }
  };

  // Totais Visuais (Rodapé da Tabela)
  const totais = useMemo(() => {
    const entradas = transacoesFiltradas.filter(t => t.tipo === 'RECEITA').reduce((acc, t) => acc + Number(t.valor), 0);
    const saidas = transacoesFiltradas.filter(t => t.tipo === 'DESPESA').reduce((acc, t) => acc + Number(t.valor), 0);
    return { entradas, saidas, balanco: entradas - saidas };
  }, [transacoesFiltradas]);

  // Mutações
  const updateTransactionData = (oldData: unknown, update: (items: Transacao[], meta: TransacoesPage['meta']) => { data: Transacao[]; meta: TransacoesPage['meta'] }) => {
    if (!oldData || typeof oldData !== 'object') return oldData;
    const cached = oldData as TransacoesPage;
    return Array.isArray(cached.data) ? { ...cached, ...update(cached.data, cached.meta) } : oldData;
  };
  const mergeSavedTransaction = (current: Transacao, saved: Partial<Transacao>): Transacao => {
    const previousPaid = Number(current.valor_pago ?? 0);
    const updated = { ...current, ...saved };
    return {
      ...updated,
      valor_pago: current.valor_pago,
      saldo_aberto: Math.max(0, Number(updated.valor) - previousPaid),
      pagamentos: current.pagamentos,
    };
  };
  const findCachedTransaction = (id: string) => queryClient.getQueriesData<TransacoesPage>({ queryKey: transactionListPrefix })
    .flatMap(([, cached]) => cached?.data ?? [])
    .find(transaction => transaction.id === id) ?? null;
  const findSnapshotTransaction = (snapshot: FinanceSnapshot, id: string) => snapshot
    .flatMap(([, cached]) => cached && typeof cached === 'object' && Array.isArray((cached as TransacoesPage).data) ? (cached as TransacoesPage).data : [])
    .find(transaction => transaction.id === id) ?? null;
  const dashboardImpact = (transaction: Transacao | null) => {
    if (!transaction) return { saldo: 0, receitas: 0, despesas: 0 };
    if (transaction.status === 'PAGO') {
      const valor = Number(transaction.valor_pago ?? transaction.valor);
      return { saldo: transaction.tipo === 'RECEITA' ? valor : transaction.tipo === 'DESPESA' ? -valor : 0, receitas: 0, despesas: 0 };
    }
    if (transaction.status === 'PENDENTE' || transaction.status === 'ATRASADO') {
      const saldo = Number(transaction.saldo_aberto ?? transaction.valor);
      return { saldo: 0, receitas: transaction.tipo === 'RECEITA' ? saldo : 0, despesas: transaction.tipo === 'DESPESA' ? saldo : 0 };
    }
    return { saldo: 0, receitas: 0, despesas: 0 };
  };
  const adjustDashboard = (before: Transacao | null, after: Transacao | null) => {
    const previous = dashboardImpact(before), next = dashboardImpact(after);
    queryClient.setQueryData<DashboardData>(financeDashboardKey, current => current ? {
      saldo_atual: current.saldo_atual + next.saldo - previous.saldo,
      receitas_pendentes: current.receitas_pendentes + next.receitas - previous.receitas,
      despesas_pendentes: current.despesas_pendentes + next.despesas - previous.despesas,
    } : current);
  };
  const buildOptimisticTransaction = (variables: Partial<Transacao> & { tempId: string }): Transacao => ({
    id: variables.tempId,
    tipo: variables.tipo ?? 'RECEITA',
    descricao: variables.descricao ?? '',
    valor: variables.valor ?? 0,
    data_competencia: variables.data_competencia ?? '',
    data_vencimento: variables.data_vencimento ?? '',
    data_pagamento: null,
    status: variables.status ?? 'PENDENTE',
    categoria: variables.categoria ?? '',
    conta_bancaria: variables.conta_bancaria ?? 'Conta Principal',
    cliente_id: variables.cliente_id ?? null,
    valor_pago: 0,
    saldo_aberto: variables.valor ?? 0,
    pagamentos: [],
  });

  const createMutation = useOptimisticMutation<Transacao, Partial<Transacao> & { tempId: string }>({
    mutationFn: (data) => {
      const { tempId, ...payload } = data;
      void tempId;
      return api<Transacao>('/financeiro/transacoes', { method: 'POST', body: JSON.stringify(payload) });
    },
    queryKeys: [transactionListKey, financeDashboardKey],
    apply: (oldData, variables) => {
      const transaction = buildOptimisticTransaction(variables);
      const querySearch = String(transactionListKey[4] ?? '').trim().toLocaleLowerCase();
      const matchesSearch = !querySearch || `${transaction.descricao} ${transaction.categoria} ${transaction.conta_bancaria}`.toLocaleLowerCase().includes(querySearch);
      if (!oldData || typeof oldData !== 'object') {
        if (Number(transactionListKey[3]) !== 1 || !matchesSearch) return oldData;
        return { data: [transaction], meta: { page: 1, limit, total: 1, totalPages: 1 } };
      }
      return updateTransactionData(oldData, (items, meta) => {
        if (Number(transactionListKey[3]) !== 1 || !matchesSearch) return { data: items, meta };
        const total = meta.total + 1;
        return { data: [transaction, ...items], meta: { ...meta, total, totalPages: Math.ceil(total / meta.limit) } };
      });
    },
    onSuccessData: (saved, variables) => {
      queryClient.setQueryData<TransacoesPage>(transactionListKey, cached => {
        if (!cached) {
          return { data: [saved], meta: { page: 1, limit, total: 1, totalPages: 1 } };
        }
        const exists = cached.data.some(transaction => transaction.id === variables.tempId || transaction.id === saved.id);
        return {
          ...cached,
          data: exists
            ? cached.data.map(transaction => (transaction.id === variables.tempId || transaction.id === saved.id) ? mergeSavedTransaction(transaction, saved) : transaction)
            : [saved, ...cached.data],
        };
      });
      if (
        (activeTab === 'a_pagar' && (saved.tipo !== 'DESPESA' || (saved.status !== 'PENDENTE' && saved.status !== 'ATRASADO'))) ||
        (activeTab === 'a_receber' && (saved.tipo !== 'RECEITA' || (saved.status !== 'PENDENTE' && saved.status !== 'ATRASADO')))
      ) {
        selectTab('lancamentos');
      }
      clearDraft();
      setIsCreating(false);
      toast.success('Lançamento registrado com sucesso!');
    },
    onMutateData: (variables) => {
      adjustDashboard(null, findCachedTransaction(variables.tempId) ?? buildOptimisticTransaction(variables));
    },
    invalidate: 'financeiro',
  });

  const updateMutation = useOptimisticMutation<Transacao, { id: string; payload: Partial<Transacao> }>({
    mutationFn: (data) => api<Transacao>(`/financeiro/transacoes/${data.id}`, { method: 'PUT', body: JSON.stringify(data.payload) }),
    queryKeys: [transactionListPrefix, financeDashboardKey],
    apply: (oldData, variables) => updateTransactionData(oldData, (items, meta) => ({ data: items.map(item => {
      if (item.id !== variables.id) return item;
      const updated = { ...item, ...variables.payload };
      return variables.payload.valor === undefined ? updated : {
        ...updated,
        saldo_aberto: Math.max(0, Number(variables.payload.valor) - Number(item.valor_pago ?? 0)),
      };
    }), meta })),
    onSuccessData: (saved) => {
      setTransacaoAberta(current => current ? mergeSavedTransaction(current, saved) : current);
      toast.success('Lançamento atualizado!');
    },
    onMutateData: (variables, snapshot) => {
      const before = findSnapshotTransaction(snapshot, variables.id);
      const after = findCachedTransaction(variables.id) ?? (before ? mergeSavedTransaction(before, variables.payload) : null);
      adjustDashboard(before, after);
      setTransacaoAberta(null);
    },
    onErrorData: (_error, variables) => setTransacaoAberta(findCachedTransaction(variables.id)),
    invalidate: 'financeiro',
  });

  const deleteMutation = useOptimisticMutation<unknown, string>({
    mutationFn: (id) => api(`/financeiro/transacoes/${id}`, { method: 'DELETE' }),
    queryKeys: [transactionListPrefix, financeDashboardKey],
    apply: (oldData, id) => updateTransactionData(oldData, (items, meta) => {
      const removed = items.some(item => item.id === id);
      const total = Math.max(0, meta.total - (removed ? 1 : 0));
      return { data: items.filter(item => item.id !== id), meta: { ...meta, total, totalPages: Math.ceil(total / meta.limit) } };
    }),
    onSuccessData: () => toast.success('Lançamento apagado com sucesso.'),
    onMutateData: (id, snapshot) => {
      adjustDashboard(findSnapshotTransaction(snapshot, id), null);
      setTransacaoAberta(null);
    },
    onErrorData: (_error, id) => setTransacaoAberta(findCachedTransaction(id)),
    invalidate: 'financeiro',
  });

  const payMutation = useOptimisticMutation<unknown, {id:string;valor:number;data_pagamento:string;metodo:string;metodo_outro?:string;observacao?:string;acao_parcial?:'MANTER_ABERTO'|'QUITAR'}>({
    mutationFn: (data) => api(`/financeiro/transacoes/${data.id}/baixas`, {
      method: 'POST',
      body: JSON.stringify({valor:data.valor,data_pagamento:data.data_pagamento,metodo:data.metodo,metodo_outro:data.metodo_outro||undefined,observacao:data.observacao||undefined,acao_parcial:data.acao_parcial||undefined}),
    }),
    queryKeys: [transactionListPrefix, financeDashboardKey],
    apply: (oldData, payment) => updateTransactionData(oldData, (items, meta) => ({
      data: items.map(transaction => {
        if (transaction.id !== payment.id) return transaction;
        const remaining = Number(transaction.saldo_aberto ?? transaction.valor);
        const partial = payment.valor < remaining - 0.001;
        const writtenOff = partial && payment.acao_parcial === 'QUITAR' ? remaining - payment.valor : 0;
        const nextStatus: Transacao['status'] = partial && payment.acao_parcial === 'MANTER_ABERTO'
          ? transaction.data_vencimento < new Date().toISOString().slice(0, 10) ? 'ATRASADO' : 'PENDENTE'
          : 'PAGO';
        const optimisticPayment: Pagamento = {
          id: `optimistic-${crypto.randomUUID()}`,
          valor: payment.valor,
          valor_dispensado: writtenOff,
          metodo: payment.metodo,
          metodo_outro: payment.metodo_outro ?? null,
          data_pagamento: payment.data_pagamento,
          observacao: payment.observacao ?? null,
          registrado_por_nome: 'Sincronizando…',
          registrado_em: new Date().toISOString(),
          revertido_em: null,
          revertido_por_nome: null,
        };
        return {
          ...transaction,
          status: nextStatus,
          data_pagamento: payment.data_pagamento,
          valor_pago: Number(transaction.valor_pago ?? 0) + payment.valor,
          saldo_aberto: Math.max(0, remaining - payment.valor - writtenOff),
          pagamentos: [...(transaction.pagamentos ?? []), optimisticPayment],
        };
      }),
      meta,
    })),
    onSuccessData: () => {
      setBaixaAlvo(null);
      toast.success(acaoParcial === 'MANTER_ABERTO' ? 'Pagamento registrado; o saldo continua em aberto.' : 'Baixa registrada com sucesso.');
    },
    onMutateData: (payment, snapshot) => {
      adjustDashboard(findSnapshotTransaction(snapshot, payment.id), findCachedTransaction(payment.id));
      setBaixaAlvo(null);
    },
    onErrorData: (_error, payment) => setBaixaAlvo(findCachedTransaction(payment.id)),
    invalidate: 'financeiro',
  });

  const reverseMutation = useOptimisticMutation<unknown, {id:string;justificativa:string}>({
    mutationFn: (data) => api(`/financeiro/transacoes/${data.id}/reverter-baixa`,{method:'POST',body:JSON.stringify({justificativa:data.justificativa})}),
    queryKeys: [transactionListPrefix, financeDashboardKey],
    apply: (oldData, reversal) => updateTransactionData(oldData, (items, meta) => ({
      data: items.map(transaction => transaction.id === reversal.id ? {
        ...transaction,
        status: transaction.data_vencimento < new Date().toISOString().slice(0, 10) ? 'ATRASADO' : 'PENDENTE',
        data_pagamento: null,
        valor_pago: 0,
        saldo_aberto: Number(transaction.valor),
        pagamentos: transaction.pagamentos?.map(payment => payment.revertido_em ? payment : {
          ...payment,
          revertido_em: new Date().toISOString(),
          revertido_por_nome: 'Você',
          ...(isOwner ? { justificativa_reversao: reversal.justificativa } : {}),
        }),
      } : transaction),
      meta,
    })),
    onSuccessData: () => {
      setReversaoAlvo(null);
      setJustificativaReversao('');
      toast.success('Baixa revertida; o lançamento voltou a ficar em aberto.');
    },
    onMutateData: (reversal, snapshot) => {
      adjustDashboard(findSnapshotTransaction(snapshot, reversal.id), findCachedTransaction(reversal.id));
      setReversaoAlvo(null);
    },
    onErrorData: (_error, reversal) => setReversaoAlvo(findCachedTransaction(reversal.id)),
    invalidate: 'financeiro',
  });

  const abrirModalBaixa = (transaction:Transacao) => {
    setBaixaAlvo(transaction);
    setValorBaixa(Number(transaction.saldo_aberto ?? transaction.valor).toFixed(2).replace('.',','));
    setDataBaixa(new Date().toISOString().slice(0,10));
    setMetodoBaixa('');
    setMetodoOutro('');
    setObservacaoBaixa('');
    setAcaoParcial('');
  };

  // Utils
  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  const baixaRestante = Number(baixaAlvo?.saldo_aberto ?? baixaAlvo?.valor ?? 0);
  const baixaNumerica = parseCurrencyInput(valorBaixa);
  const pagamentoParcial = baixaNumerica > 0 && baixaNumerica < baixaRestante - 0.005;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload = {
      tipo: formData.get('tipo') as any,
      descricao: formData.get('descricao') as string,
      valor: parseCurrencyInput(formData.get('valor')),
      data_competencia: formData.get('data_competencia') as string,
      data_vencimento: formData.get('data_vencimento') as string,
      categoria: formData.get('categoria') as string,
      conta_bancaria: formData.get('conta_bancaria') as string,
      status: transacaoAberta?.status === 'PAGO' ? undefined : (formData.get('status') as Transacao['status']) || undefined,
    };

    if (isCreating) {
      createMutation.mutate({ ...payload, tempId: crypto.randomUUID() });
    } else if (transacaoAberta) {
      updateMutation.mutate({ id: transacaoAberta.id, payload });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#121316] text-white p-8 animate-in fade-in duration-300 relative">
      {/* HEADER & ABAS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Receipt className="text-[#E4E7EC]" size={28} />
              Financeiro
            </h1>
            {activeTenant && (
              <span className="bg-[#1A1C20] border border-[#2E3238] text-[#E4E7EC] text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-[#E4E7EC]" />
                {activeTenant.nome_fantasia}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Lançamentos, receitas e despesas exclusivos de <strong className="text-gray-300">{activeTenant?.nome_fantasia || 'sua empresa'}</strong>
          </p>
          <div className="flex gap-6 mt-4 border-b border-[#2E3238]">
            {[
              { id: 'lancamentos', label: 'Lançamentos' },
              { id: 'a_pagar', label: 'A Pagar' },
              { id: 'a_receber', label: 'A Receber' },
              { id: 'conciliacao', label: 'Conciliação' }
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => selectTab(tab.id as any)}
                className={`pb-2 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.id ? 'border-[#E4E7EC] text-[#E4E7EC]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => void gerarRelatorio()} disabled={gerandoRelatorio} className="flex items-center gap-2 text-sm px-4 py-2.5 bg-[#1A1C20] border border-[#2E3238] rounded-lg hover:text-white transition-colors disabled:opacity-50">
            <Download size={16}/> {gerandoRelatorio ? 'Gerando…' : 'Relatórios'}
          </button>
          <button 
            onClick={() => { setTransacaoAberta(null); setIsCreating(true); }}
            className="flex items-center gap-2 text-sm px-5 py-2.5 bg-[#E4E7EC] text-[#121316] font-bold rounded-lg shadow-[0_0_15px_rgba(228,231,236,0.14)] hover:bg-[#D4D8DF] transition-all"
          >
            <Plus size={16}/> Novo Lançamento
          </button>
        </div>
      </div>

      {/* KPIs DASHBOARD */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl">
          <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Saldo Atual</span>
          <div className="text-2xl font-bold mt-2 text-white">
            {isLoadingDash ? '...' : formatCurrency(dashboard?.saldo_atual || 0)}
          </div>
        </div>
        <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl border-t-2 border-t-[#E4E7EC]">
          <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">A Receber <TrendingUp size={14} className="text-[#E4E7EC]"/></span>
          <div className="text-2xl font-bold mt-2 text-white">
            {isLoadingDash ? '...' : formatCurrency(dashboard?.receitas_pendentes || 0)}
          </div>
        </div>
        <div className="bg-[#1A1C20] border border-[#2E3238] p-5 rounded-xl border-t-2 border-t-red-500">
          <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">A Pagar <TrendingDown size={14} className="text-red-400"/></span>
          <div className="text-2xl font-bold mt-2 text-white">
            {isLoadingDash ? '...' : formatCurrency(dashboard?.despesas_pendentes || 0)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => selectTab('a_pagar')}
          className="text-left bg-[#E0A11B]/10 border border-[#E0A11B]/30 p-5 rounded-xl hover:bg-[#E0A11B]/15 transition-colors"
        >
          <span className="text-[#E0A11B] text-xs font-semibold uppercase tracking-wider flex items-center gap-2"><Bell size={14}/> Vencimentos em Alerta</span>
          <div className="text-2xl font-bold mt-2 text-[#F2F3F5]">
            {isLoadingDash ? '...' : (dashboard?.lembretes_a_pagar?.vencidas.quantidade ?? 0) + (dashboard?.lembretes_a_pagar?.vence_hoje.quantidade ?? 0) + (dashboard?.lembretes_a_pagar?.proximos_7_dias.quantidade ?? 0)} conta(s)
          </div>
          <p className="text-xs text-[#9CA1AA] mt-1">
            {isLoadingDash ? '' : `Total: ${formatCurrency((dashboard?.lembretes_a_pagar?.vencidas.total ?? 0) + (dashboard?.lembretes_a_pagar?.vence_hoje.total ?? 0) + (dashboard?.lembretes_a_pagar?.proximos_7_dias.total ?? 0))}`}
          </p>
        </button>
      </div>

      {dashboard?.lembretes_a_pagar && (dashboard.lembretes_a_pagar.vencidas.quantidade + dashboard.lembretes_a_pagar.vence_hoje.quantidade + dashboard.lembretes_a_pagar.proximos_7_dias.quantidade) > 0 && (
        <div className="mb-6 rounded-xl border border-[#E0A11B]/30 bg-[#E0A11B]/10 px-5 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell size={18} className="text-[#E0A11B] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#F2F3F5]">Lembretes de Contas a Pagar (ordem de vencimento)</p>
              <div className="flex flex-wrap gap-3 mt-1 text-xs">
                {dashboard.lembretes_a_pagar.vencidas.quantidade > 0 && (
                  <span className="text-red-400 font-medium">
                    {dashboard.lembretes_a_pagar.vencidas.quantidade} vencida(s) ({formatCurrency(dashboard.lembretes_a_pagar.vencidas.total)})
                  </span>
                )}
                {dashboard.lembretes_a_pagar.vence_hoje.quantidade > 0 && (
                  <span className="text-[#E0A11B] font-medium">
                    {dashboard.lembretes_a_pagar.vence_hoje.quantidade} vence(m) hoje ({formatCurrency(dashboard.lembretes_a_pagar.vence_hoje.total)})
                  </span>
                )}
                {dashboard.lembretes_a_pagar.proximos_7_dias.quantidade > 0 && (
                  <span className="text-[#E4E7EC]">
                    {dashboard.lembretes_a_pagar.proximos_7_dias.quantidade} nos próximos 7 dias ({formatCurrency(dashboard.lembretes_a_pagar.proximos_7_dias.total)})
                  </span>
                )}
              </div>
            </div>
          </div>
          {activeTab !== 'a_pagar' && (
            <button
              type="button"
              onClick={() => selectTab('a_pagar')}
              className="px-4 py-2 rounded-lg bg-[#E4E7EC] text-[#121316] text-xs font-semibold hover:bg-white transition-colors shrink-0"
            >
              Ver contas a pagar
            </button>
          )}
        </div>
      )}

      {/* DATA TABLE (EXTRATO) */}
      <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl overflow-hidden flex-1 flex flex-col">
        <div className="p-4 border-b border-[#2E3238] flex gap-4 bg-[#121316]/50">
          <div className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
            <input 
              value={buscaInput}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg pl-12 pr-4 py-2.5 text-sm focus:ring-1 focus:ring-[#E4E7EC] outline-none transition-all placeholder:text-gray-600"
              placeholder="Buscar por descrição, categoria ou conta..."
            />
          </div>
        </div>
        
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#23262B] text-gray-400 sticky top-0 z-10 shadow-sm border-b border-[#2E3238]">
              <tr>
                <th className="p-4 font-medium w-[120px]">Vencimento</th>
                <th className="p-4 font-medium">Descrição</th>
                <th className="p-4 font-medium">Categoria</th>
                <th className="p-4 font-medium">Conta</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Valor</th>
                <th className="p-4 font-medium w-[100px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2E3238] font-mono">
              {isLoadingTransacoes ? (
                Array.from({ length: 5 }, (_, index) => (
                  <tr key={`skeleton-${index}`} aria-hidden="true">
                    {Array.from({ length: 7 }, (_, cell) => <td key={cell} className="p-4"><div className="h-4 rounded bg-[#2E3238] animate-pulse" /></td>)}
                  </tr>
                ))
              ) : transacoesFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-gray-500 font-sans">
                    Nenhum lançamento encontrado para os filtros atuais.
                  </td>
                </tr>
              ) : (
                transacoesFiltradas.map(t => {
                  const todayIso = new Date().toISOString().slice(0, 10);
                  const dueIso = String(t.data_vencimento || '').slice(0, 10);
                  const diffDays = dueIso ? Math.round((Date.parse(`${dueIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000) : null;
                  const openAccount = t.status === 'PENDENTE' || t.status === 'ATRASADO';
                  return (
                  <tr 
                    key={t.id} 
                    className="hover:bg-[#23262B] transition-colors cursor-pointer group"
                    onClick={() => { setIsCreating(false); setTransacaoAberta(t); }}
                  >
                    <td className="p-4 text-gray-300">
                      <div>{formatDate(t.data_vencimento)}</div>
                      {openAccount && diffDays !== null && diffDays < 0 && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-red-500/15 text-red-400">
                          Vencida há {Math.abs(diffDays)}d
                        </span>
                      )}
                      {openAccount && diffDays === 0 && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-[#E0A11B]/15 text-[#E0A11B]">
                          Vence hoje
                        </span>
                      )}
                      {openAccount && diffDays !== null && diffDays > 0 && diffDays <= 7 && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-[#23262B] text-[#E4E7EC] border border-[#2E3238]">
                          Em {diffDays}d
                        </span>
                      )}
                    </td>
                    <td className="p-4 font-sans text-white group-hover:text-[#E4E7EC] transition-colors">
                      {t.descricao}
                    </td>
                    <td className="p-4 text-xs font-sans text-gray-400">{t.categoria}</td>
                    <td className="p-4 text-xs font-sans text-gray-400">{t.conta_bancaria}</td>
                    <td className="p-4 font-sans">
                      {t.status === 'PAGO' ? (
                        <span className="bg-[#E4E7EC]/10 text-[#E4E7EC] px-2 py-0.5 rounded text-xs border border-[#E4E7EC]/20 font-medium">PAGO</span>
                      ) : t.status === 'ATRASADO' ? (
                        <span className="bg-red-500/10 text-red-400 px-2 py-0.5 rounded text-xs border border-red-500/20 font-medium">ATRASADO</span>
                      ) : (
                        <span className="bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded text-xs border border-yellow-500/20 font-medium">PENDENTE</span>
                      )}
                    </td>
                    <td className={`p-4 text-right font-medium ${t.tipo === 'RECEITA' ? 'text-[#E4E7EC]' : 'text-red-400'}`}>
                      {t.tipo === 'RECEITA' ? '+' : '-'} {formatCurrency(Number(t.valor))}
                      {t.status !== 'PAGO' && Number(t.valor_pago ?? 0) > 0 && <span className="mt-1 block font-sans text-[10px] text-gray-500">Saldo em aberto: {formatCurrency(Number(t.saldo_aberto ?? 0))}</span>}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end items-center gap-2">
                        {canManagePayments && t.status !== 'CANCELADO' && (
                          <button
                            disabled={payMutation.isPending || reverseMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); if(t.status === 'PAGO'){setReversaoAlvo(t);setJustificativaReversao('');}else{abrirModalBaixa(t);} }}
                            className="text-xs bg-[#2E3238] hover:bg-[#E4E7EC] hover:text-[#121316] text-white px-3 py-1 rounded font-sans transition-colors"
                          >
                            {t.status === 'PAGO' ? 'Reverter Baixa' : 'Dar Baixa'}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Apagar lançamento ${t.descricao}`}
                          title="Apagar lançamento"
                          disabled={deleteMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Apagar o lançamento \"${t.descricao}\"? Ele será removido da visão financeira.`)) {
                              deleteMutation.mutate(t.id);
                            }
                          }}
                          className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <Pagination meta={transacoesResponse?.meta} onPage={setPage} onLimit={setLimit}/>
        </div>
        
        {/* FOOTER TOTALIZADOR */}
        <div className="bg-[#121316] border-t border-[#2E3238] p-4 flex justify-end gap-12 font-mono text-sm">
          <div><span className="text-gray-500 font-sans text-xs mr-2">Entradas na visão:</span> <span className="text-[#E4E7EC]">{formatCurrency(totais.entradas)}</span></div>
          <div><span className="text-gray-500 font-sans text-xs mr-2">Saídas na visão:</span> <span className="text-red-400">{formatCurrency(totais.saidas)}</span></div>
          <div><span className="text-gray-500 font-sans text-xs mr-2">Balanço:</span> <span className="text-white font-bold">{formatCurrency(totais.balanco)}</span></div>
        </div>
      </div>

      {/* DRAWER / SLIDE-OVER (Criar ou Editar Lançamento) */}
      {(transacaoAberta || isCreating) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => { setTransacaoAberta(null); setIsCreating(false); }} />
          
          <div className="relative w-full max-w-lg bg-[#1A1C20] border-l border-[#2E3238] shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-6 border-b border-[#2E3238] bg-[#121316]">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                  {isCreating ? 'Novo Lançamento' : 'Detalhes do Lançamento'}
                </h2>
                {activeTenant && (
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                    Empresa vinculada: <span className="text-[#E4E7EC] font-semibold">{activeTenant.nome_fantasia}</span>
                  </p>
                )}
              </div>
              <button onClick={() => { setTransacaoAberta(null); setIsCreating(false); }} className="text-gray-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <form id="finance-form" ref={financeFormRef} onInput={() => syncFinanceDraft()} onChange={() => syncFinanceDraft()} onSubmit={handleSubmit} className="space-y-6">
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Tipo *</label>
                    <select name="tipo" defaultValue={transacaoAberta?.tipo || (activeTab === 'a_receber' ? 'RECEITA' : 'DESPESA')} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none">
                      <option value="RECEITA">Receita (Entrada)</option>
                      <option value="DESPESA">Despesa (Saída)</option>
                      <option value="TRANSFERENCIA">Transferência</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Valor (R$) *</label>
                    <IMaskInput name="valor" mask={Number} scale={2} radix="," mapToRadix={['.']} thousandsSeparator="." padFractionalZeros={false} normalizeZeros value={valorForm} onAccept={(value) => { const next = String(value); setValorForm(next); syncFinanceDraft(next); }} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" placeholder="0,00" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Descrição *</label>
                  <input name="descricao" defaultValue={transacaoAberta?.descricao || ''} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" placeholder="Ex: Pagamento Fornecedor XYZ" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Categoria *</label>
                    <input name="categoria" defaultValue={transacaoAberta?.categoria || ''} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" placeholder="Ex: Manutenção" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Conta Bancária / Caixa</label>
                    <input name="conta_bancaria" defaultValue={transacaoAberta?.conta_bancaria || 'Conta Principal'} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1"><CalendarDays size={12}/> Vencimento *</label>
                    <input name="data_vencimento" type="date" defaultValue={transacaoAberta?.data_vencimento || new Date().toISOString().split('T')[0]} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none [color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1"><CalendarDays size={12}/> Competência *</label>
                    <input name="data_competencia" type="date" defaultValue={transacaoAberta?.data_competencia || new Date().toISOString().split('T')[0]} required className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none [color-scheme:dark]" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
                  {transacaoAberta?.status === 'PAGO' ? (
                    <p className="rounded-lg border border-[#2E3238] bg-[#23262B] px-4 py-2.5 text-sm text-[#E4E7EC]">Pago — use “Reverter Baixa” para desfazer</p>
                  ) : (
                    <select name="status" defaultValue={transacaoAberta?.status || 'PENDENTE'} className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#E4E7EC] outline-none">
                      <option value="PENDENTE">Pendente</option>
                      <option value="ATRASADO">Atrasado</option>
                      <option value="CANCELADO">Cancelado</option>
                    </select>
                  )}
                </div>

              </form>

              {transacaoAberta && (transacaoAberta.pagamentos?.length ?? 0) > 0 && (
                <section className="mt-8 border-t border-[#2E3238] pt-6">
                  <h3 className="mb-3 text-sm font-semibold text-white">Histórico de pagamentos</h3>
                  <div className="space-y-3">
                    {transacaoAberta.pagamentos!.map(payment => (
                      <article key={payment.id} className="rounded-lg border border-[#2E3238] bg-[#23262B] p-3 text-xs">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium text-white">{formatCurrency(Number(payment.valor))}{Number(payment.valor_dispensado)>0?` · ${formatCurrency(Number(payment.valor_dispensado))} dispensados`:''}</span>
                          <span className={payment.revertido_em?'text-red-400':'text-[#E4E7EC]'}>{payment.revertido_em?'Revertido':'Registrado'}</span>
                        </div>
                        <p className="mt-2 text-gray-400">{payment.metodo==='LEGADO'?'Método não registrado':payment.metodo==='OUTRO'?payment.metodo_outro:payment.metodo.replaceAll('_',' ')} · pagamento em {formatDate(payment.data_pagamento)}</p>
                        <p className="mt-1 text-gray-500">Registrado por {payment.registrado_por_nome || 'usuário anterior'} em {new Date(payment.registrado_em).toLocaleString('pt-BR')}</p>
                        {payment.observacao&&<p className="mt-1 text-gray-400">Observação: {payment.observacao}</p>}
                        {payment.revertido_em&&<p className="mt-1 text-gray-500">Revertido por {payment.revertido_por_nome||'usuário'} em {new Date(payment.revertido_em).toLocaleString('pt-BR')}</p>}
                        {isOwner&&payment.justificativa_reversao&&<p className="mt-2 border-t border-[#2E3238] pt-2 text-gray-300">Justificativa da reversão: {payment.justificativa_reversao}</p>}
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="p-6 border-t border-[#2E3238] bg-[#121316] flex justify-between items-center">
              {transacaoAberta ? (
                <button 
                  onClick={() => {
                    if(confirm('Apagar este lançamento? Ele será removido da visão financeira.')) {
                      deleteMutation.mutate(transacaoAberta.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Apagando…' : <><Trash2 size={15} className="inline mr-2" />Apagar lançamento</>}
                </button>
              ) : isCreating && hasDraft ? (
                <button type="button" onClick={resetFinanceDraft} className="text-xs font-medium text-[#9CA1AA] hover:text-[#F2F3F5] px-3 py-2 rounded-lg border border-[#2E3238]">
                  Limpar rascunho
                </button>
              ) : <div></div>}

              <div className="flex gap-3">
                <button onClick={() => { setTransacaoAberta(null); setIsCreating(false); }} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  form="finance-form"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="bg-[#E4E7EC] text-[#121316] px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#D4D8DF] disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {baixaAlvo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!payMutation.isPending)setBaixaAlvo(null);}}>
          <form className="w-full max-w-lg space-y-4 rounded-xl border border-[#2E3238] bg-[#1A1C20] p-6 text-white shadow-2xl" onSubmit={event=>{
            event.preventDefault();
            if(baixaNumerica<=0||baixaNumerica>baixaRestante+0.001){toast.error('Informe um valor positivo que não ultrapasse o saldo em aberto.');return;}
            if(pagamentoParcial&&!acaoParcial){toast.error('Escolha o que fazer com o saldo restante.');return;}
            if(!metodoBaixa){toast.error('Selecione o método de pagamento.');return;}
            if(metodoBaixa==='OUTRO'&&!metodoOutro.trim()){toast.error('Descreva o método de pagamento.');return;}
            payMutation.mutate({id:baixaAlvo.id,valor:baixaNumerica,data_pagamento:dataBaixa,metodo:metodoBaixa,metodo_outro:metodoOutro,observacao:observacaoBaixa,acao_parcial:pagamentoParcial&&acaoParcial?acaoParcial:undefined});
          }}>
            <div>
              <h2 className="text-lg font-bold">Dar Baixa</h2>
              <p className="mt-1 text-xs text-gray-400">{baixaAlvo.descricao} · saldo em aberto: {formatCurrency(baixaRestante)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-gray-300">Valor pago
                <input required inputMode="decimal" value={valorBaixa} onChange={event=>setValorBaixa(event.target.value)} className="w-full rounded-lg border border-[#2E3238] bg-[#23262B] px-3 py-2.5 text-sm text-white" placeholder="0,00" />
              </label>
              <label className="space-y-1 text-xs text-gray-300">Data do pagamento
                <input required type="date" value={dataBaixa} onChange={event=>setDataBaixa(event.target.value)} className="w-full rounded-lg border border-[#2E3238] bg-[#23262B] px-3 py-2.5 text-sm text-white [color-scheme:dark]" />
              </label>
            </div>
            <label className="block space-y-1 text-xs text-gray-300">Método de pagamento *
              <select required value={metodoBaixa} onChange={event=>setMetodoBaixa(event.target.value)} className="w-full rounded-lg border border-[#2E3238] bg-[#23262B] px-3 py-2.5 text-sm text-white">
                <option value="">Selecione…</option><option value="DINHEIRO">Dinheiro</option><option value="PIX">PIX</option><option value="CARTAO_CREDITO">Cartão de Crédito</option><option value="CARTAO_DEBITO">Cartão de Débito</option><option value="BOLETO">Boleto</option><option value="TRANSFERENCIA">Transferência Bancária (TED/DOC)</option><option value="OUTRO">Outro</option>
              </select>
            </label>
            {metodoBaixa==='OUTRO'&&<label className="block space-y-1 text-xs text-gray-300">Descreva o método *<input required maxLength={100} value={metodoOutro} onChange={event=>setMetodoOutro(event.target.value)} className="w-full rounded-lg border border-[#2E3238] bg-[#23262B] px-3 py-2.5 text-sm text-white" /></label>}
            {pagamentoParcial&&<fieldset className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><legend className="px-1 font-semibold text-amber-300">Pagamento parcial — saldo restante {formatCurrency(Math.max(0,baixaRestante-baixaNumerica))}</legend>
              <label className="flex items-start gap-2 text-gray-300"><input type="radio" name="partial-action" checked={acaoParcial==='MANTER_ABERTO'} onChange={()=>setAcaoParcial('MANTER_ABERTO')} />Manter o saldo restante em aberto para receber/pagar depois.</label>
              <label className="flex items-start gap-2 text-gray-300"><input type="radio" name="partial-action" checked={acaoParcial==='QUITAR'} onChange={()=>setAcaoParcial('QUITAR')} />Quitar agora e registrar o saldo restante como dispensado.</label>
            </fieldset>}
            <label className="block space-y-1 text-xs text-gray-300">Observação (opcional)
              <textarea maxLength={1000} value={observacaoBaixa} onChange={event=>setObservacaoBaixa(event.target.value)} rows={3} className="w-full resize-y rounded-lg border border-[#2E3238] bg-[#23262B] px-3 py-2.5 text-sm text-white" />
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={()=>setBaixaAlvo(null)} disabled={payMutation.isPending} className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-[#2E3238]">Cancelar</button>
              <button type="submit" disabled={payMutation.isPending} className="rounded-lg bg-[#E4E7EC] px-4 py-2 text-sm font-bold text-[#121316] disabled:opacity-50">{payMutation.isPending?'Registrando…':'Confirmar Baixa'}</button>
            </div>
          </form>
        </div>
      )}

      {reversaoAlvo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!reverseMutation.isPending)setReversaoAlvo(null);}}>
          <form className="w-full max-w-lg space-y-4 rounded-xl border border-[#2E3238] bg-[#1A1C20] p-6 text-white shadow-2xl" onSubmit={event=>{event.preventDefault();if(justificativaReversao.trim().length<10){toast.error('A justificativa deve ter pelo menos 10 caracteres.');return;}reverseMutation.mutate({id:reversaoAlvo.id,justificativa:justificativaReversao.trim()});}}>
            <div><h2 className="text-lg font-bold">Reverter Baixa</h2><p className="mt-1 text-xs text-gray-400">{reversaoAlvo.descricao}. Os pagamentos antigos permanecerão no histórico.</p></div>
            <label className="block space-y-1 text-xs text-gray-300">Justificativa obrigatória (mínimo 10 caracteres)
              <textarea required minLength={10} maxLength={1000} value={justificativaReversao} onChange={event=>setJustificativaReversao(event.target.value)} rows={4} className="w-full resize-y rounded-lg border border-[#2E3238] bg-[#23262B] px-3 py-2.5 text-sm text-white" placeholder="Explique o motivo da reversão…" />
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={()=>setReversaoAlvo(null)} disabled={reverseMutation.isPending} className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-[#2E3238]">Cancelar</button>
              <button type="submit" disabled={reverseMutation.isPending||justificativaReversao.trim().length<10} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{reverseMutation.isPending?'Revertendo…':'Confirmar Reversão'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

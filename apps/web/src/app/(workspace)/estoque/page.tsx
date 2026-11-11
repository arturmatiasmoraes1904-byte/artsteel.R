'use client';
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/useTenantStore';
import { Search, Plus, Package, Box, TrendingDown, ArrowRightLeft, AlertTriangle, AlertCircle, X, Download, Upload, Filter, BarChart3, FileText, CheckCircle2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination } from '@/components/Pagination';
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation';

type Produto = {
  id: string;
  nome: string;
  sku: string | null;
  ean: string | null;
  ncm: string | null;
  unidade: string;
  custo_medio: string | number;
  preco_venda: string | number;
  estoque_atual: string | number;
  estoque_minimo: string | number;
  localizacao: string | null;
  status: string;
};

type Movimentacao = {
  produto_id: string;
  tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'TRANSFERENCIA';
  quantidade: number;
  custo_unitario: number;
  motivo: string;
  documento?: string;
};

type MovimentacaoRegistro = Movimentacao & {
  id: string;
  created_at: string;
  produto_nome?: string;
  produto_sku?: string | null;
};

type PageMeta = { page: number; limit: number; total: number; totalPages: number };
type ProdutoPage = { data: Produto[]; meta: PageMeta };
type MovimentacaoPage = { data: MovimentacaoRegistro[]; meta: PageMeta };
type EstoqueDashboard = {
  total_produtos: number;
  valor_total_custo: number;
  valor_total_venda: number;
  produtos_baixo_estoque: number;
  produtos_zerados: number;
  itens_baixo_estoque: Produto[];
};
type MovementVariables = Movimentacao & { tempId: string; product: Produto };

function matchesProductQuery(product: Produto, search: string, filter: string) {
  const stock = Number(product.estoque_atual);
  const minimum = Number(product.estoque_minimo);
  if (filter === 'BAIXO_ESTOQUE' && !(stock > 0 && stock <= minimum)) return false;
  if (filter === 'ZERADOS' && stock > 0) return false;
  if (filter === 'ATIVO' && product.status !== 'ATIVO') return false;
  if (filter === 'INATIVO' && product.status !== 'INATIVO') return false;
  const term = search.trim().toLocaleLowerCase();
  return !term || [product.nome, product.sku ?? '', product.ean ?? ''].some(value => value.toLocaleLowerCase().includes(term));
}

function changeProductPage(oldData: unknown, queryKey: readonly unknown[], previous: Produto | null, next: Produto | null) {
  const search = String(queryKey[4] ?? '');
  const filter = String(queryKey[5] ?? 'TODOS');
  const page = Number(queryKey[3] ?? 1);
  const limit = Number(queryKey[6] ?? 50);
  const oldMatches = previous ? matchesProductQuery(previous, search, filter) : false;
  const nextMatches = next ? matchesProductQuery(next, search, filter) : false;

  if (Array.isArray(oldData)) {
    const rows = oldData as Produto[];
    const contains = rows.some(product => product.id === previous?.id);
    let updated = rows.filter(product => product.id !== previous?.id);
    if (next && nextMatches && (contains || page === 1)) updated = [...updated, next];
    return updated.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  if (!oldData || typeof oldData !== 'object' || !Array.isArray((oldData as ProdutoPage).data)) return oldData;

  const current = oldData as ProdutoPage;
  const contains = current.data.some(product => product.id === previous?.id);
  let rows = current.data.filter(product => product.id !== previous?.id);
  if (next && nextMatches && (contains || page === 1)) rows = [...rows, next];
  rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  rows = rows.slice(0, limit);
  const delta = Number(nextMatches) - Number(oldMatches);
  return { ...current, data: rows, meta: { ...current.meta, total: Math.max(0, current.meta.total + delta) } };
}

function changeMovementPage(oldData: unknown, tempId: string, movement: MovimentacaoRegistro, limit: number) {
  if (Array.isArray(oldData)) {
    const rows = oldData as MovimentacaoRegistro[];
    return [movement, ...rows.filter(item => item.id !== tempId)].slice(0, limit);
  }
  if (!oldData || typeof oldData !== 'object' || !Array.isArray((oldData as MovimentacaoPage).data)) return oldData;
  const current = oldData as MovimentacaoPage;
  const firstPage = current.meta.page === 1;
  const rows = current.data.filter(item => item.id !== tempId);
  return {
    ...current,
    data: firstPage ? [movement, ...rows].slice(0, current.meta.limit) : rows,
    meta: { ...current.meta, total: current.meta.total + (rows.length === current.data.length ? 1 : 0) },
  };
}

function replaceMovement(oldData: unknown, tempId: string, saved: MovimentacaoRegistro, limit: number) {
  if (Array.isArray(oldData)) {
    const rows = oldData as MovimentacaoRegistro[];
    return [saved, ...rows.filter(item => item.id !== tempId)].slice(0, limit);
  }
  if (!oldData || typeof oldData !== 'object' || !Array.isArray((oldData as MovimentacaoPage).data)) return oldData;
  const current = oldData as MovimentacaoPage;
  if (current.meta.page !== 1) return oldData;
  return { ...current, data: [saved, ...current.data.filter(item => item.id !== tempId)].slice(0, current.meta.limit) };
}

type XmlItemImport = {
  nome: string;
  sku: string;
  ean: string;
  ncm: string;
  unidade: string;
  quantidade: number;
  custo_unitario: number;
  preco_venda: number;
};

function parseXmlNotaFiscal(xmlText: string): {
  documento: string;
  fornecedor: string;
  itens: XmlItemImport[];
} {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

  const getTagValue = (parent: Element | Document, tagName: string): string => {
    const el = parent.getElementsByTagName(tagName)[0] || parent.getElementsByTagNameNS('*', tagName)[0];
    return el?.textContent?.trim() || '';
  };

  const ide = xmlDoc.getElementsByTagName('ide')[0] || xmlDoc.getElementsByTagNameNS('*', 'ide')[0];
  const nNF = ide ? getTagValue(ide, 'nNF') : getTagValue(xmlDoc, 'nNF');

  const emit = xmlDoc.getElementsByTagName('emit')[0] || xmlDoc.getElementsByTagNameNS('*', 'emit')[0];
  const fornecedor = emit ? (getTagValue(emit, 'xFant') || getTagValue(emit, 'xNome')) : '';

  const detList = Array.from(
    xmlDoc.getElementsByTagName('det').length
      ? xmlDoc.getElementsByTagName('det')
      : xmlDoc.getElementsByTagNameNS('*', 'det')
  );

  const itens: XmlItemImport[] = [];

  if (detList.length > 0) {
    for (const det of detList) {
      const prod = det.getElementsByTagName('prod')[0] || det.getElementsByTagNameNS('*', 'prod')[0] || det;
      const nome = getTagValue(prod, 'xProd') || getTagValue(prod, 'nome');
      if (!nome) continue;

      const sku = getTagValue(prod, 'cProd') || getTagValue(prod, 'sku');
      const rawEan = getTagValue(prod, 'cEAN') || getTagValue(prod, 'cEANTrib') || getTagValue(prod, 'ean');
      const ean = rawEan && rawEan !== 'SEM GTIN' ? rawEan : '';
      const ncm = getTagValue(prod, 'NCM') || getTagValue(prod, 'ncm');
      const unidade = (getTagValue(prod, 'uCom') || getTagValue(prod, 'uTrib') || getTagValue(prod, 'unidade') || 'UN').toUpperCase().slice(0, 6);
      const quantidade = Number((getTagValue(prod, 'qCom') || getTagValue(prod, 'qTrib') || getTagValue(prod, 'quantidade') || '0').replace(',', '.')) || 0;
      const custo_unitario = Number((getTagValue(prod, 'vUnCom') || getTagValue(prod, 'vUnTrib') || getTagValue(prod, 'custo_unitario') || '0').replace(',', '.')) || 0;

      itens.push({
        nome,
        sku,
        ean,
        ncm,
        unidade,
        quantidade: quantidade > 0 ? quantidade : 1,
        custo_unitario: Number(custo_unitario.toFixed(2)),
        preco_venda: Number((custo_unitario * 1.5).toFixed(2)),
      });
    }
  } else {
    // Fallback para XML genérico de produtos (<produto> ou <item>)
    const genericNodes = [
      ...Array.from(xmlDoc.getElementsByTagName('produto')),
      ...Array.from(xmlDoc.getElementsByTagName('item')),
    ];
    for (const node of genericNodes) {
      const nome = getTagValue(node, 'nome') || getTagValue(node, 'xProd') || getTagValue(node, 'descricao');
      if (!nome) continue;
      const sku = getTagValue(node, 'sku') || getTagValue(node, 'cProd') || getTagValue(node, 'codigo');
      const ean = getTagValue(node, 'ean') || getTagValue(node, 'cEAN');
      const ncm = getTagValue(node, 'ncm') || getTagValue(node, 'NCM');
      const unidade = (getTagValue(node, 'unidade') || getTagValue(node, 'uCom') || 'UN').toUpperCase().slice(0, 6);
      const quantidade = Number((getTagValue(node, 'quantidade') || getTagValue(node, 'estoque_atual') || getTagValue(node, 'qCom') || '1').replace(',', '.')) || 1;
      const custo_unitario = Number((getTagValue(node, 'custo_unitario') || getTagValue(node, 'custo_medio') || getTagValue(node, 'vUnCom') || '0').replace(',', '.')) || 0;
      const preco_venda = Number((getTagValue(node, 'preco_venda') || '0').replace(',', '.')) || Number((custo_unitario * 1.5).toFixed(2));

      itens.push({
        nome,
        sku,
        ean,
        ncm,
        unidade,
        quantidade,
        custo_unitario,
        preco_venda,
      });
    }
  }

  return {
    documento: nNF ? `NF-e ${nNF}` : '',
    fornecedor,
    itens,
  };
}

export default function EstoquePage() {
  const queryClient = useQueryClient();
  const { activeTenant } = useTenantStore();
  const xmlInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<'visao_geral' | 'produtos' | 'movimentacoes'>('visao_geral');
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [filtroEstoque, setFiltroEstoque] = useState<'TODOS' | 'BAIXO_ESTOQUE' | 'ZERADOS' | 'ATIVO' | 'INATIVO'>('TODOS');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [produtoPage, setProdutoPage] = useState(1);
  const [produtoLimit, setProdutoLimit] = useState(50);
  const [movimentacaoPage, setMovimentacaoPage] = useState(1);
  const [movimentacaoLimit, setMovimentacaoLimit] = useState(50);

  // Modals / Drawers
  const [produtoAberto, setProdutoAberto] = useState<Produto | null>(null);
  const [isCreatingProduto, setIsCreatingProduto] = useState(false);
  const [movimentarProduto, setMovimentarProduto] = useState<Produto | null>(null);

  // Estado de Importação XML
  const [isXmlModalOpen, setIsXmlModalOpen] = useState(false);
  const [xmlFileName, setXmlFileName] = useState('');
  const [xmlRawContent, setXmlRawContent] = useState('');
  const [xmlDocumento, setXmlDocumento] = useState('');
  const [xmlFornecedor, setXmlFornecedor] = useState('');
  const [xmlItens, setXmlItens] = useState<XmlItemImport[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBuscaDebounced(busca.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [busca]);
  useEffect(() => setProdutoPage(1), [buscaDebounced, filtroEstoque]);

  // Queries
  const dashboardKey = ['estoque', 'dashboard', activeTenant?.id] as const;
  const productListPrefix = ['estoque', 'produtos', activeTenant?.id] as const;
  const productListKey = [...productListPrefix, produtoPage, buscaDebounced, filtroEstoque, produtoLimit] as const;
  const movementListPrefix = ['estoque', 'movimentacoes', activeTenant?.id] as const;
  const movementListKey = [...movementListPrefix, movimentacaoPage, movimentacaoLimit] as const;

  const { data: dashboard, isLoading: isLoadingDash } = useQuery({
    queryKey: dashboardKey,
    queryFn: () => api<EstoqueDashboard>('/estoque/dashboard'),
    enabled: Boolean(activeTenant?.id),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });

  const { data: produtosResponse, isLoading: isLoadingProdutos } = useQuery({
    queryKey: productListKey,
    queryFn: ({ signal }) => api<ProdutoPage>(`/estoque/produtos?page=${produtoPage}&limit=${produtoLimit}&search=${encodeURIComponent(buscaDebounced)}&status=${filtroEstoque}`, { signal }),
    enabled: Boolean(activeTenant?.id),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === activeTenant?.id ? previous : undefined,
  });
  const produtos = produtosResponse?.data ?? [];
  const { data: movementProductOptions } = useQuery({
    queryKey: ['estoque', 'produtos', activeTenant?.id, 'movimentacao-selector'],
    queryFn: ({ signal }) => api<ProdutoPage>('/estoque/produtos?page=1&limit=50&status=ATIVO', { signal }),
    enabled: Boolean(activeTenant?.id) && activeTab === 'movimentacoes',
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const movementProducts = movementProductOptions?.data ?? [];
  const { data: movimentacoesResponse, isLoading: isLoadingMovimentacoes } = useQuery({
    queryKey: movementListKey,
    queryFn: ({ signal }) => api<MovimentacaoPage>(`/estoque/movimentacoes?page=${movimentacaoPage}&limit=${movimentacaoLimit}`, { signal }),
    enabled: Boolean(activeTenant?.id) && activeTab === 'movimentacoes',
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === activeTenant?.id ? previous : undefined,
  });
  const movimentacoes = movimentacoesResponse?.data ?? [];
  const produtosAlerta = dashboard?.itens_baixo_estoque ?? [];

  // Mutações otimistas: produtos e movimentações aparecem antes da confirmação da API.
  const replaceProductInAllPages = (previous: Produto, next: Produto) => {
    queryClient.getQueriesData({ queryKey: productListPrefix }).forEach(([key, cached]) => {
      queryClient.setQueryData(key, changeProductPage(cached, key, previous, next));
    });
  };

  const createProdutoMut = useOptimisticMutation<Produto, { tempId: string; payload: Partial<Produto> }>({
    mutationFn: ({ payload }) => api<Produto>('/estoque/produtos', { method: 'POST', body: JSON.stringify(payload) }),
    queryKeys: [productListPrefix],
    apply: (oldData, variables, key) => {
      const optimistic: Produto = {
        id: variables.tempId,
        nome: variables.payload.nome ?? 'Novo produto',
        sku: variables.payload.sku ?? null,
        ean: variables.payload.ean ?? null,
        ncm: variables.payload.ncm ?? null,
        unidade: variables.payload.unidade ?? 'UN',
        custo_medio: variables.payload.custo_medio ?? 0,
        preco_venda: variables.payload.preco_venda ?? 0,
        estoque_atual: variables.payload.estoque_atual ?? 0,
        estoque_minimo: variables.payload.estoque_minimo ?? 0,
        localizacao: variables.payload.localizacao ?? null,
        status: variables.payload.status ?? 'ATIVO',
      };
      return changeProductPage(oldData, key, null, optimistic);
    },
    onSuccessData: (saved, variables) => {
      replaceProductInAllPages({ ...saved, id: variables.tempId }, saved);
      setIsCreatingProduto(false);
      toast.success('Produto cadastrado com sucesso!');
    },
    invalidate: 'estoque',
  });

  const updateProdutoMut = useOptimisticMutation<Produto, { id: string; payload: Partial<Produto>; previous: Produto }>({
    mutationFn: ({ id, payload }) => api<Produto>(`/estoque/produtos/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    queryKeys: [productListPrefix],
    apply: (oldData, variables, key) => changeProductPage(oldData, key, variables.previous, { ...variables.previous, ...variables.payload }),
    onSuccessData: (saved, variables) => {
      replaceProductInAllPages({ ...variables.previous, ...variables.payload }, saved);
      setProdutoAberto(saved);
      toast.success('Produto atualizado!');
    },
    invalidate: 'estoque',
  });

  const movimentaMut = useOptimisticMutation<MovimentacaoRegistro & { estoque_atual?: number | string }, MovementVariables>({
    mutationFn: variables => api<MovimentacaoRegistro & { estoque_atual?: number | string }>('/estoque/movimentacoes', {
      method: 'POST',
      body: JSON.stringify({
        produto_id: variables.produto_id,
        tipo: variables.tipo,
        quantidade: variables.quantidade,
        custo_unitario: variables.custo_unitario,
        motivo: variables.motivo,
        documento: variables.documento,
      }),
    }),
    queryKeys: [productListPrefix, movementListPrefix],
    apply: (oldData, variables, key) => {
      if (key[1] === 'produtos') {
        const current = Number(variables.product.estoque_atual);
        const nextStock = variables.tipo === 'ENTRADA'
          ? current + variables.quantidade
          : variables.tipo === 'SAIDA'
            ? current - variables.quantidade
            : variables.tipo === 'AJUSTE' ? variables.quantidade : current;
        return changeProductPage(oldData, key, variables.product, { ...variables.product, estoque_atual: nextStock });
      }
      if (key[1] === 'movimentacoes' && Number(key[3] ?? 1) === 1) {
        const optimistic: MovimentacaoRegistro = {
          produto_id: variables.produto_id,
          tipo: variables.tipo,
          quantidade: variables.quantidade,
          custo_unitario: variables.custo_unitario,
          motivo: variables.motivo,
          documento: variables.documento,
          id: variables.tempId,
          created_at: new Date().toISOString(),
          produto_nome: variables.product.nome,
          produto_sku: variables.product.sku,
        };
        return changeMovementPage(oldData, variables.tempId, optimistic, Number(key[4] ?? 50));
      }
      return oldData;
    },
    onSuccessData: (saved, variables) => {
      const updatedProduct = {
        ...variables.product,
        estoque_atual: saved.estoque_atual ?? (variables.tipo === 'ENTRADA'
          ? Number(variables.product.estoque_atual) + variables.quantidade
          : variables.tipo === 'SAIDA'
            ? Number(variables.product.estoque_atual) - variables.quantidade
            : variables.tipo === 'AJUSTE' ? variables.quantidade : variables.product.estoque_atual),
      };
      replaceProductInAllPages({ ...variables.product, estoque_atual: variables.product.estoque_atual }, updatedProduct);
      queryClient.getQueriesData({ queryKey: movementListPrefix }).forEach(([key, cached]) => {
        queryClient.setQueryData(key, replaceMovement(cached, variables.tempId, saved, Number(key[4] ?? 50)));
      });
      setMovimentarProduto(null);
      toast.success('Movimentação registrada com sucesso!');
    },
    invalidate: 'estoque',
  });

  const deleteProdutoMut = useOptimisticMutation<unknown, { id: string; product: Produto }>({
    mutationFn: ({ id }) => api(`/estoque/produtos/${id}`, { method: 'DELETE' }),
    queryKeys: [productListPrefix],
    apply: (oldData, variables, key) => changeProductPage(oldData, key, variables.product, null),
    onSuccessData: () => {
      setProdutoAberto(null);
      toast.success('Produto removido/desativado.');
    },
    invalidate: 'estoque',
  });

  const importarXmlMut = useMutation({
    mutationFn: (payload: { xml?: string; documento?: string; fornecedor?: string; itens: XmlItemImport[] }) =>
      api<{ criados: number; atualizados: number; total_itens?: number; total_processados?: number }>('/estoque/importar-xml', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['estoque'] });
      setIsXmlModalOpen(false);
      setXmlItens([]);
      setXmlRawContent('');
      setXmlFileName('');
      const total = res.total_itens ?? res.total_processados ?? ((res.criados || 0) + (res.atualizados || 0));
      toast.success(
        `${total} produto(s) importado(s) com sucesso! (${res.criados} novo(s), ${res.atualizados} atualizado(s))`
      );
    },
    onError: (error) => {
      toast.error((error as Error).message || 'Erro ao importar arquivo XML.');
    },
  });

  const processXmlString = (content: string, fileName: string) => {
    setXmlFileName(fileName);
    setXmlRawContent(content);
    const parsed = parseXmlNotaFiscal(content);
    setXmlDocumento(parsed.documento || fileName.replace(/\.xml$/i, ''));
    setXmlFornecedor(parsed.fornecedor);
    setXmlItens(parsed.itens);
    setIsXmlModalOpen(true);

    if (parsed.itens.length === 0) {
      toast.warning('Não encontramos tags padrão <det>/<prod> na pré-visualização, mas você pode tentar enviar ou carregar outro XML.');
    } else {
      toast.success(`${parsed.itens.length} item(ns) identificado(s) no XML!`);
    }
  };

  const handleXmlFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      processXmlString(text, file.name);
    } catch {
      toast.error('Não foi possível ler o arquivo XML selecionado.');
    }
  };

  const handleCarregarXmlExemplo = () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35261012345678000199550010000124501000124505" versao="4.00">
      <ide>
        <nNF>12450</nNF>
      </ide>
      <emit>
        <xNome>Distribuidora de Aço e Metais Brasil Ltda</xNome>
        <xFant>Aço Brasil</xFant>
      </emit>
      <det nItem="1">
        <prod>
          <cProd>CH-ACO-3MM</cProd>
          <cEAN>7891000111222</cEAN>
          <xProd>Chapa de Aço Carbono 3mm (2x1m)</xProd>
          <NCM>72085200</NCM>
          <uCom>UN</uCom>
          <qCom>15.0000</qCom>
          <vUnCom>245.0000</vUnCom>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>TUB-50X50</cProd>
          <cEAN>7891000333444</cEAN>
          <xProd>Metalon Tubo Quadrado 50x50mm #16 (Barra 6m)</xProd>
          <NCM>73066100</NCM>
          <uCom>UN</uCom>
          <qCom>25.0000</qCom>
          <vUnCom>118.5000</vUnCom>
        </prod>
      </det>
      <det nItem="3">
        <prod>
          <cProd>DISCO-CORTE-7</cProd>
          <cEAN>7891000555666</cEAN>
          <xProd>Disco de Corte Fino 7" Inox/Aço</xProd>
          <NCM>68042211</NCM>
          <uCom>UN</uCom>
          <qCom>50.0000</qCom>
          <vUnCom>8.9000</vUnCom>
        </prod>
      </det>
    </infNFe>
  </NFe>
</nfeProc>`;
    processXmlString(sampleXml, 'NFe-12450-AcoBrasil.xml');
  };

  const handleUpdateXmlItem = (index: number, field: keyof XmlItemImport, value: string | number) => {
    setXmlItens(prev => prev.map((item, idx) => idx === index ? { ...item, [field]: value } : item));
  };

  const handleRemoveXmlItem = (index: number) => {
    setXmlItens(prev => prev.filter((_, idx) => idx !== index));
  };

  const formatCurrency = (val: number | string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val));
  const formatNumber = (val: number | string) => new Intl.NumberFormat('pt-BR').format(Number(val));

  const handleSalvarProduto = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload = {
      nome: formData.get('nome') as string,
      sku: formData.get('sku') as string,
      ean: formData.get('ean') as string,
      ncm: formData.get('ncm') as string,
      unidade: formData.get('unidade') as string,
      custo_medio: Number(formData.get('custo_medio')),
      preco_venda: Number(formData.get('preco_venda')),
      estoque_atual: Number(formData.get('estoque_atual')),
      estoque_minimo: Number(formData.get('estoque_minimo')),
      localizacao: formData.get('localizacao') as string,
      status: formData.get('status') as string,
    };

    if (isCreatingProduto) {
      createProdutoMut.mutate({ tempId: crypto.randomUUID(), payload });
    } else if (produtoAberto) {
      updateProdutoMut.mutate({ id: produtoAberto.id, payload, previous: produtoAberto });
    }
  };

  const handleMovimentar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!movimentarProduto) return;
    const formData = new FormData(e.currentTarget);
    const payload: Movimentacao = {
      produto_id: movimentarProduto.id,
      tipo: formData.get('tipo') as Movimentacao['tipo'],
      quantidade: Number(formData.get('quantidade')),
      custo_unitario: Number(formData.get('custo_unitario') || movimentarProduto.custo_medio),
      motivo: formData.get('motivo') as string,
      documento: formData.get('documento') as string,
    };
    movimentaMut.mutate({ ...payload, tempId: crypto.randomUUID(), product: movimentarProduto });
  };

  return (
    <div className="flex flex-col h-full bg-[#141414] text-white p-8 animate-in fade-in duration-300 relative">
      {/* Input oculto para seleção de arquivo XML */}
      <input
        ref={xmlInputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={handleXmlFileChange}
      />

      {/* HEADER & ABAS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Package className="text-[#b0fb5d]" size={28} />
            Estoque / WMS
          </h1>
          <div className="flex gap-6 mt-3 border-b border-[#2a2a2a] overflow-x-auto no-scrollbar">
            {[
              { id: 'visao_geral', label: 'Visão Geral' },
              { id: 'produtos', label: 'Produtos' },
              { id: 'movimentacoes', label: 'Movimentações' }
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
            type="button"
            onClick={() => {
              setIsXmlModalOpen(true);
              xmlInputRef.current?.click();
            }}
            className="flex items-center gap-2 text-sm px-4 py-2.5 bg-[#242424] border border-[#2a2a2a] text-gray-200 font-semibold rounded-lg hover:bg-[#2a2a2a] hover:text-white transition-all"
          >
            <Upload size={16} className="text-[#b0fb5d]" /> Importar XML
          </button>
          <button 
            onClick={() => { setProdutoAberto(null); setIsCreatingProduto(true); }}
            className="flex items-center gap-2 text-sm px-5 py-2.5 bg-[#b0fb5d] text-black font-bold rounded-lg shadow-[0_0_15px_rgba(176,251,93,0.2)] hover:bg-[#9de44f] transition-all"
          >
            <Plus size={16}/> Novo Produto
          </button>
        </div>
      </div>

      {activeTab === 'visao_geral' && (
        <div className="space-y-6">
          {/* KPIs DASHBOARD */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] p-5 rounded-xl">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Produtos Cadastrados</span>
              <div className="text-2xl font-bold mt-2 text-white">
                {isLoadingDash ? '...' : dashboard?.total_produtos || 0}
              </div>
            </div>
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] p-5 rounded-xl border-t-2 border-t-[#b0fb5d]">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Custo do Estoque</span>
              <div className="text-2xl font-bold mt-2 text-white">
                {isLoadingDash ? '...' : formatCurrency(dashboard?.valor_total_custo || 0)}
              </div>
            </div>
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] p-5 rounded-xl border-t-2 border-t-blue-500">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Valor de Venda (Projeção)</span>
              <div className="text-2xl font-bold mt-2 text-white">
                {isLoadingDash ? '...' : formatCurrency(dashboard?.valor_total_venda || 0)}
              </div>
            </div>
            <div className="bg-red-500/5 border border-red-500/20 p-5 rounded-xl relative overflow-hidden">
              <span className="text-red-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2"><AlertCircle size={14}/> Baixo Estoque / Zerados</span>
              <div className="text-2xl font-bold mt-2 text-red-400 flex items-end gap-2">
                {isLoadingDash ? '...' : dashboard?.produtos_baixo_estoque || 0} <span className="text-sm font-normal text-gray-500 mb-1">alertas</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 h-64 flex flex-col items-center justify-center text-gray-500">
              <BarChart3 size={40} className="mb-4 opacity-50"/>
              <p>O gráfico de movimentações semanais (Entradas x Saídas) será renderizado aqui.</p>
            </div>
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 h-64 overflow-y-auto no-scrollbar">
              <h3 className="text-sm font-semibold mb-4 text-[#b0fb5d]">Atenção Necessária</h3>
              <div className="space-y-3">
                {produtosAlerta.length === 0 ? (
                  <p className="text-xs text-gray-500">Nenhum produto com estoque crítico no momento.</p>
                ) : (
                  produtosAlerta.map(prod => {
                    const estq = Number(prod.estoque_atual);
                    const min = Number(prod.estoque_minimo);
                    const zerado = estq <= 0;
                    return (
                      <div
                        key={prod.id}
                        onClick={() => { setIsCreatingProduto(false); setProdutoAberto(prod); }}
                        className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          zerado
                            ? 'bg-red-500/10 border-red-500/20 hover:bg-red-500/15'
                            : 'bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/15'
                        }`}
                      >
                        <AlertTriangle className={zerado ? 'text-red-400 shrink-0' : 'text-yellow-500 shrink-0'} size={16}/>
                        <div>
                          <div className="text-xs font-bold text-white">{prod.nome}</div>
                          <div className={`text-[10px] ${zerado ? 'text-red-400' : 'text-yellow-500'}`}>
                            Estoque atual: {formatNumber(estq)} {prod.unidade} (Mínimo: {formatNumber(min)})
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'produtos' && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-[#2a2a2a] flex flex-wrap gap-4 bg-[#141414]/50 items-center">
            <div className="relative flex-1 min-w-[240px] max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
              <input 
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg pl-12 pr-4 py-2.5 text-sm focus:ring-1 focus:ring-[#b0fb5d] outline-none transition-all placeholder:text-gray-600"
                placeholder="Buscar por nome, SKU, código de barras..."
              />
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowFilterMenu(prev => !prev)}
                className={`px-4 py-2.5 bg-[#242424] border rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  filtroEstoque !== 'TODOS'
                    ? 'border-[#b0fb5d] text-[#b0fb5d]'
                    : 'border-[#2a2a2a] text-gray-400 hover:text-white'
                }`}
              >
                <Filter size={16}/> Filtros {filtroEstoque !== 'TODOS' ? `(${filtroEstoque})` : ''}
              </button>
              {showFilterMenu && (
                <div className="absolute left-0 mt-2 w-48 bg-[#1f1f1f] border border-[#2a2a2a] rounded-xl shadow-xl z-20 py-1">
                  {[
                    { id: 'TODOS', label: 'Todos os produtos' },
                    { id: 'BAIXO_ESTOQUE', label: 'Estoque baixo' },
                    { id: 'ZERADOS', label: 'Estoque zerado' },
                    { id: 'ATIVO', label: 'Apenas Ativos' },
                    { id: 'INATIVO', label: 'Apenas Inativos' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setFiltroEstoque(opt.id as typeof filtroEstoque);
                        setShowFilterMenu(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-[#2a2a2a] transition-colors ${
                        filtroEstoque === opt.id ? 'text-[#b0fb5d] font-bold' : 'text-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsXmlModalOpen(true);
                xmlInputRef.current?.click();
              }}
              className="px-4 py-2.5 bg-[#242424] border border-[#2a2a2a] rounded-lg text-sm text-gray-300 hover:text-white hover:border-[#b0fb5d]/50 flex items-center gap-2 transition-all"
            >
              <Upload size={16} className="text-[#b0fb5d]" /> Importar XML
            </button>
          </div>
          
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#242424] text-gray-400 sticky top-0 z-10 shadow-sm border-b border-[#2a2a2a]">
                <tr>
                  <th className="p-4 font-medium">Produto / SKU</th>
                  <th className="p-4 font-medium">Localização</th>
                  <th className="p-4 font-medium text-right">Estoque</th>
                  <th className="p-4 font-medium text-right">Custo Médio</th>
                  <th className="p-4 font-medium text-right">Preço Venda</th>
                  <th className="p-4 font-medium text-center">Status</th>
                  <th className="p-4 font-medium w-[120px]">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {isLoadingProdutos ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <tr key={`skeleton-${index}`} aria-hidden="true">
                      {Array.from({ length: 7 }, (_, cell) => <td key={cell} className="p-4"><div className="h-4 rounded bg-[#2a2a2a] animate-pulse" /></td>)}
                    </tr>
                  ))
                ) : produtos.length === 0 ? (
                  <tr><td colSpan={7} className="p-12 text-center text-gray-500">Nenhum produto encontrado.</td></tr>
                ) : (
                  produtos.map(p => {
                    const estq = Number(p.estoque_atual);
                    const min = Number(p.estoque_minimo);
                    const isBaixo = estq > 0 && estq <= min;
                    const isZerado = estq <= 0;

                    return (
                      <tr key={p.id} className="hover:bg-[#242424] transition-colors group">
                        <td className="p-4 cursor-pointer" onClick={() => { setIsCreatingProduto(false); setProdutoAberto(p); }}>
                          <div className="font-semibold text-white group-hover:text-[#b0fb5d] transition-colors">{p.nome}</div>
                          <div className="text-xs text-gray-500 mt-0.5">SKU: {p.sku || 'Sem SKU'} {p.ean ? ` | EAN: ${p.ean}` : ''}</div>
                        </td>
                        <td className="p-4 text-xs text-gray-400">{p.localizacao || '-'}</td>
                        <td className="p-4 text-right font-mono font-medium">
                          <span className={isZerado ? 'text-red-400' : isBaixo ? 'text-yellow-500' : 'text-white'}>
                            {formatNumber(estq)} {p.unidade}
                          </span>
                        </td>
                        <td className="p-4 text-right text-gray-400 font-mono">{formatCurrency(p.custo_medio)}</td>
                        <td className="p-4 text-right text-[#b0fb5d] font-mono">{formatCurrency(p.preco_venda)}</td>
                        <td className="p-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs border font-medium ${p.status === 'ATIVO' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setMovimentarProduto(p); }}
                            className="text-xs bg-[#2a2a2a] hover:bg-blue-500/20 hover:text-blue-400 hover:border-blue-500/30 text-white px-3 py-1.5 rounded font-sans transition-all border border-[#2a2a2a] flex items-center gap-1.5"
                          >
                            <ArrowRightLeft size={12}/> Movimentar
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            meta={produtosResponse?.meta}
            onPage={setProdutoPage}
            onLimit={value => { setProdutoLimit(value); setProdutoPage(1); }}
          />
        </div>
      )}

      {activeTab === 'movimentacoes' && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden flex-1 flex flex-col">
          <div className="p-5 border-b border-[#2a2a2a] flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Histórico de movimentações</h2>
              <p className="text-sm text-gray-500 mt-1">Entradas, saídas e ajustes registrados no estoque.</p>
            </div>
            <button
              onClick={() => movementProducts[0] && setMovimentarProduto(movementProducts[0])}
              disabled={!movementProducts.length}
              className="flex items-center gap-2 rounded-lg bg-[#b0fb5d] px-4 py-2 text-sm font-bold text-black hover:bg-[#9de44f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16}/> Nova movimentação
            </button>
          </div>
          {isLoadingMovimentacoes ? (
            <div aria-label="Carregando movimentações" className="space-y-3 p-5">
              {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-10 rounded bg-[#242424] animate-pulse" />)}
            </div>
          ) : !movimentacoes.length ? (
            <p className="p-8 text-center text-gray-500">Nenhuma movimentação registrada.</p>
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#242424] text-gray-400">
                  <tr>
                    <th className="p-4">Data</th>
                    <th className="p-4">Produto</th>
                    <th className="p-4">Tipo</th>
                    <th className="p-4 text-right">Quantidade</th>
                    <th className="p-4">Motivo / Documento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a2a2a]">
                  {movimentacoes.map(m => (
                    <tr key={m.id} className="hover:bg-[#242424]/50">
                      <td className="p-4 text-gray-400">{m.created_at ? new Date(m.created_at).toLocaleString('pt-BR') : '-'}</td>
                      <td className="p-4 text-white font-medium">{m.produto_nome ?? m.produto_id}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          m.tipo === 'ENTRADA'
                            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                            : m.tipo === 'SAIDA'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>
                          {m.tipo}
                        </span>
                      </td>
                      <td className="p-4 text-right text-white font-mono">{formatNumber(m.quantidade)}</td>
                      <td className="p-4 text-gray-400">
                        {m.motivo}
                        {m.documento ? <span className="ml-2 text-xs text-gray-500">({m.documento})</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            meta={movimentacoesResponse?.meta}
            onPage={setMovimentacaoPage}
            onLimit={value => { setMovimentacaoLimit(value); setMovimentacaoPage(1); }}
          />
        </div>
      )}

      {/* MODAL DE IMPORTAÇÃO XML (NF-e / Catálogo) */}
      {isXmlModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsXmlModalOpen(false)} />
          <div className="relative w-full max-w-4xl bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-[#2a2a2a] bg-[#141414] rounded-t-xl">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                  <FileText className="text-[#b0fb5d]" size={20} />
                  Importar Produtos via XML (NF-e)
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Carregue o arquivo XML da Nota Fiscal Eletrônica para cadastrar novos itens e dar entrada automática no estoque.
                </p>
              </div>
              <button onClick={() => setIsXmlModalOpen(false)} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Barra de seleção de arquivo */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#242424] border border-dashed border-[#3a3a3a]">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-[#b0fb5d]/10 text-[#b0fb5d]">
                    <Upload size={22} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {xmlFileName ? `Arquivo: ${xmlFileName}` : 'Selecione um arquivo .XML de Nota Fiscal'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {xmlFornecedor
                        ? `Fornecedor: ${xmlFornecedor} • Documento: ${xmlDocumento}`
                        : 'Suporta NF-e padrão SEFAZ (<det><prod>) ou XML de catálogo de produtos'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCarregarXmlExemplo}
                    className="px-3 py-2 rounded-lg text-xs font-medium bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
                  >
                    Carregar XML de Exemplo
                  </button>
                  <button
                    type="button"
                    onClick={() => xmlInputRef.current?.click()}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-[#b0fb5d] text-black hover:bg-[#9de44f] transition-colors"
                  >
                    Escolher Arquivo .XML
                  </button>
                </div>
              </div>

              {xmlItens.length > 0 && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Nº Documento / NF-e</label>
                      <input
                        value={xmlDocumento}
                        onChange={e => setXmlDocumento(e.target.value)}
                        className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#b0fb5d]"
                        placeholder="Ex: NF-e 12450"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Fornecedor / Emitente</label>
                      <input
                        value={xmlFornecedor}
                        onChange={e => setXmlFornecedor(e.target.value)}
                        className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#b0fb5d]"
                        placeholder="Nome do fornecedor"
                      />
                    </div>
                  </div>

                  <div className="border border-[#2a2a2a] rounded-xl overflow-hidden">
                    <div className="bg-[#242424] px-4 py-2.5 border-b border-[#2a2a2a] flex justify-between items-center">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#b0fb5d]">
                        Itens Identificados ({xmlItens.length})
                      </span>
                      <span className="text-xs text-gray-400">
                        Você pode revisar quantidades e preços antes de confirmar
                      </span>
                    </div>
                    <div className="overflow-x-auto max-h-72">
                      <table className="w-full text-left text-xs whitespace-nowrap">
                        <thead className="bg-[#1f1f1f] text-gray-400 border-b border-[#2a2a2a]">
                          <tr>
                            <th className="p-3">Produto</th>
                            <th className="p-3">SKU</th>
                            <th className="p-3 w-20">Unid.</th>
                            <th className="p-3 w-28 text-right">Qtd. Entrada</th>
                            <th className="p-3 w-32 text-right">Custo Unit. (R$)</th>
                            <th className="p-3 w-32 text-right">Preço Venda (R$)</th>
                            <th className="p-3 w-12 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2a2a2a]">
                          {xmlItens.map((item, idx) => (
                            <tr key={idx} className="hover:bg-[#242424]/60">
                              <td className="p-2.5">
                                <input
                                  value={item.nome}
                                  onChange={e => handleUpdateXmlItem(idx, 'nome', e.target.value)}
                                  className="w-full min-w-[200px] bg-[#242424] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-white focus:border-[#b0fb5d] outline-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  value={item.sku}
                                  onChange={e => handleUpdateXmlItem(idx, 'sku', e.target.value)}
                                  className="w-28 bg-[#242424] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-gray-300 focus:border-[#b0fb5d] outline-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  value={item.unidade}
                                  onChange={e => handleUpdateXmlItem(idx, 'unidade', e.target.value.toUpperCase())}
                                  className="w-16 bg-[#242424] border border-[#2a2a2a] rounded px-2 py-1.5 text-center text-gray-300 focus:border-[#b0fb5d] outline-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  value={item.quantidade}
                                  onChange={e => handleUpdateXmlItem(idx, 'quantidade', Number(e.target.value))}
                                  className="w-24 bg-[#242424] border border-[#2a2a2a] rounded px-2 py-1.5 text-right text-white font-mono focus:border-[#b0fb5d] outline-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.custo_unitario}
                                  onChange={e => handleUpdateXmlItem(idx, 'custo_unitario', Number(e.target.value))}
                                  className="w-28 bg-[#242424] border border-[#2a2a2a] rounded px-2 py-1.5 text-right text-gray-300 font-mono focus:border-[#b0fb5d] outline-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.preco_venda}
                                  onChange={e => handleUpdateXmlItem(idx, 'preco_venda', Number(e.target.value))}
                                  className="w-28 bg-[#242424] border border-[#2a2a2a] rounded px-2 py-1.5 text-right text-[#b0fb5d] font-mono focus:border-[#b0fb5d] outline-none"
                                />
                              </td>
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveXmlItem(idx)}
                                  className="text-gray-500 hover:text-red-400 p-1"
                                  title="Remover item da importação"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="p-5 border-t border-[#2a2a2a] bg-[#141414] rounded-b-xl flex justify-between items-center">
              <div className="text-xs text-gray-400">
                {xmlItens.length > 0 ? (
                  <span>
                    Total da Entrada:{' '}
                    <strong className="text-[#b0fb5d]">
                      {formatCurrency(xmlItens.reduce((acc, it) => acc + Number(it.quantidade) * Number(it.custo_unitario), 0))}
                    </strong>
                  </span>
                ) : (
                  <span>Nenhum item carregado ainda.</span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsXmlModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={importarXmlMut.isPending || (xmlItens.length === 0 && !xmlRawContent)}
                  onClick={() =>
                    importarXmlMut.mutate({
                      xml: xmlRawContent || undefined,
                      documento: xmlDocumento || undefined,
                      fornecedor: xmlFornecedor || undefined,
                      itens: xmlItens,
                    })
                  }
                  className="flex items-center gap-2 bg-[#b0fb5d] text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#9de44f] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <CheckCircle2 size={16} />
                  {importarXmlMut.isPending ? 'Importando...' : 'Confirmar Importação no Estoque'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER DO PRODUTO (Criar/Editar) */}
      {(produtoAberto || isCreatingProduto) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => { setProdutoAberto(null); setIsCreatingProduto(false); }} />
          <div className="relative w-full max-w-xl bg-[#1a1a1a] border-l border-[#2a2a2a] shadow-2xl flex flex-col h-full animate-in slide-in-from-right">
            <div className="flex items-center justify-between p-6 border-b border-[#2a2a2a] bg-[#141414]">
              <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                {isCreatingProduto ? <><Box className="text-[#b0fb5d]"/> Novo Produto</> : <><Box className="text-[#b0fb5d]"/> Editar Produto</>}
              </h2>
              <button onClick={() => { setProdutoAberto(null); setIsCreatingProduto(false); }} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
              <form id="produto-form" onSubmit={handleSalvarProduto} className="space-y-6">
                <section>
                  <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider mb-3">Identificação</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome / Descrição do Produto *</label>
                      <input name="nome" defaultValue={produtoAberto?.nome} required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">SKU (Código Interno)</label>
                        <input name="sku" defaultValue={produtoAberto?.sku || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Código de Barras (EAN)</label>
                        <input name="ean" defaultValue={produtoAberto?.ean || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Unidade de Medida</label>
                        <select name="unidade" defaultValue={produtoAberto?.unidade || 'UN'} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none appearance-none">
                          <option value="UN">Unidade (UN)</option>
                          <option value="KG">Quilo (KG)</option>
                          <option value="M">Metro (M)</option>
                          <option value="CX">Caixa (CX)</option>
                          <option value="L">Litro (L)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">NCM (Fiscal)</label>
                        <input name="ncm" defaultValue={produtoAberto?.ncm || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider mb-3">Preços (R$)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Custo Médio</label>
                      <input name="custo_medio" type="number" step="0.01" min="0" defaultValue={produtoAberto?.custo_medio || '0'} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Preço de Venda Final</label>
                      <input name="preco_venda" type="number" step="0.01" min="0" defaultValue={produtoAberto?.preco_venda || '0'} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-[#b0fb5d] uppercase tracking-wider mb-3">Controle Físico</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Estoque Atual</label>
                      <input name="estoque_atual" type="number" step="0.001" defaultValue={produtoAberto?.estoque_atual || '0'} disabled={!isCreatingProduto} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none disabled:opacity-50" title="Para alterar saldo, use o botão Movimentar" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Estoque Mín.</label>
                      <input name="estoque_minimo" type="number" step="0.001" defaultValue={produtoAberto?.estoque_minimo || '0'} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Localização</label>
                      <input name="localizacao" defaultValue={produtoAberto?.localizacao || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" placeholder="Ex: C-12" />
                    </div>
                  </div>
                </section>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
                  <select name="status" defaultValue={produtoAberto?.status || 'ATIVO'} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none">
                    <option value="ATIVO">Ativo</option>
                    <option value="INATIVO">Inativo (Não vender)</option>
                  </select>
                </div>
              </form>
            </div>
            <div className="p-6 border-t border-[#2a2a2a] bg-[#141414] flex justify-between items-center">
              {produtoAberto && (
                <button onClick={() => { if(confirm('Apagar produto?')) deleteProdutoMut.mutate({ id: produtoAberto.id, product: produtoAberto }); }} disabled={deleteProdutoMut.isPending} className="text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
                  {deleteProdutoMut.isPending ? 'Excluindo…' : 'Excluir'}
                </button>
              )}
              {!produtoAberto && <div/>}
              <div className="flex gap-3">
                <button onClick={() => { setProdutoAberto(null); setIsCreatingProduto(false); }} disabled={deleteProdutoMut.isPending} className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-50">Cancelar</button>
                <button type="submit" form="produto-form" disabled={createProdutoMut.isPending || updateProdutoMut.isPending} className="bg-[#b0fb5d] text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#9de44f] disabled:opacity-50">
                  {createProdutoMut.isPending || updateProdutoMut.isPending ? 'Salvando...' : 'Salvar Ficha'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE MOVIMENTAÇÃO */}
      {movimentarProduto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setMovimentarProduto(null)} />
          <div className="relative w-full max-w-md bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[#2a2a2a]">
              <h2 className="text-lg font-bold flex items-center gap-2 text-white">Registrar Movimentação</h2>
              <p className="text-sm text-gray-500 mt-1">Produto: <span className="text-[#b0fb5d]">{movimentarProduto.nome}</span></p>
            </div>
            <div className="p-6">
              <form id="mov-form" onSubmit={handleMovimentar} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Produto *</label>
                  <select value={movimentarProduto.id} onChange={event => { const selected = produtos.find(product => product.id === event.target.value); if (selected) setMovimentarProduto(selected); }} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none">
                    {produtos.map(product => <option key={product.id} value={product.id}>{product.nome} — saldo: {product.estoque_atual} {product.unidade}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Tipo de Movimento *</label>
                  <select name="tipo" required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none">
                    <option value="ENTRADA">Entrada (Compra/Devolução)</option>
                    <option value="SAIDA">Saída (Venda/Perda)</option>
                    <option value="AJUSTE">Ajuste de Inventário (Sobrescreve)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Quantidade ({movimentarProduto.unidade}) *</label>
                  <input name="quantidade" type="number" step="0.001" min="0" required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Motivo / Observação *</label>
                  <input name="motivo" required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" placeholder="Ex: NF 1234, Quebra na loja..." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Documento de Origem (Opcional)</label>
                  <input name="documento" className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-[#b0fb5d] outline-none" placeholder="Nº da Nota ou Pedido" />
                </div>
              </form>
            </div>
            <div className="p-4 border-t border-[#2a2a2a] bg-[#141414] rounded-b-xl flex justify-end gap-3">
              <button onClick={() => setMovimentarProduto(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancelar</button>
              <button type="submit" form="mov-form" disabled={movimentaMut.isPending} className="bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-400 disabled:opacity-50">
                {movimentaMut.isPending ? 'Confirmando...' : 'Confirmar Movimentação'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

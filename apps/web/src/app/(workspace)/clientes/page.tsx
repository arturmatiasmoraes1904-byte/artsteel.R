'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Plus, Filter, X, Users, Mail, Phone, MapPin, Building2, CheckCircle2, Trash2, Clock, UserCircle, FileText, ExternalLink, Package, Calendar, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import {Pagination} from '@/components/Pagination';
import {useRouter,useSearchParams} from 'next/navigation';
import {IMaskInput} from 'react-imask';
import { documentoMask, isValidCnpj, isValidCpf, isValidDocumento } from '@/lib/documento';
import { queryKeys } from '@/lib/queryKeys';
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation';
import { useTenantStore } from '@/stores/useTenantStore';

type Endereco = {
  cep?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
};

type CnpjLookupResult = {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  situacao_cadastral: string | null;
  natureza_juridica: string | null;
  porte: string | null;
  capital_social: number | null;
  data_abertura: string | null;
  cnae_principal: {
    codigo: string;
    descricao: string;
  } | null;
  telefone: string | null;
  email: string | null;
  endereco: {
    cep: string;
    rua: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
  };
  fonte: 'w14n' | 'brasilapi' | 'cadastro_interno' | 'validacao_cpf';
};

type Cliente = {
  id: string;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  endereco: Endereco | string | null;
  status: string;
  created_at: string;
};

type ContratoLocacaoItem = {
  id: string;
  nome: string;
  patrimonio?: string;
  valor_unitario?: string | number;
};

type ContratoLocacao = {
  id: string;
  status: 'RASCUNHO' | 'ATIVO' | 'ENCERRADO' | 'CANCELADO';
  data_inicio: string;
  data_fim_prevista: string;
  valor_total: string | number;
  condicao_pagamento?: string;
  periodicidade?: string;
  dia_vencimento?: number;
  observacoes?: string | null;
  itens?: ContratoLocacaoItem[];
};

type ViaCepAddress = {
  erro?: boolean;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

export default function ClientesPage() {
  const queryClient = useQueryClient();
  const activeTenant = useTenantStore((state) => state.activeTenant);
  const params=useSearchParams();const router=useRouter();
  const busca=params.get('q')??''; const statusFiltro=params.get('status')??'TODOS'; const page=Number(params.get('page')??'1'); const limit=Number(params.get('limit')??'50');
  const [buscaInput, setBuscaInput] = useState(busca);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  useEffect(() => setBuscaInput(busca), [busca]);
  useEffect(() => {
    if (buscaInput === busca) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      buscaInput ? next.set('q', buscaInput) : next.delete('q');
      next.set('page', '1');
      router.replace(`/clientes?${next}`);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [buscaInput, busca, params, router]);
  const aplicarBusca = (value: string, status = statusFiltro) => {
    const next = new URLSearchParams(params.toString());
    const normalized = value.trim();
    normalized ? next.set('q', normalized) : next.delete('q');
    status !== 'TODOS' ? next.set('status', status) : next.delete('status');
    next.set('page', '1');
    router.replace(`/clientes?${next}`);
  };
  const setStatusFiltro = (value: string) => {
    const next = new URLSearchParams(params.toString());
    value !== 'TODOS' ? next.set('status', value) : next.delete('status');
    next.set('page', '1');
    router.replace(`/clientes?${next}`);
  };
  const setPage=(value:number)=>{const next=new URLSearchParams(params.toString());next.set('page',String(value));router.replace(`/clientes?${next}`)};
  const setLimit=(value:number)=>{const next=new URLSearchParams(params.toString());next.set('limit',String(value));next.set('page','1');router.replace(`/clientes?${next}`)};
  const [clienteAberto, setClienteAberto] = useState<Cliente | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [documento, setDocumento] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cep, setCep] = useState('');
  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [dadosCnpj, setDadosCnpj] = useState<CnpjLookupResult | null>(null);
  const documentoDigits = documento.replace(/\D/g, '');
  const documentoCompleto = documentoDigits.length === 11 || documentoDigits.length === 14;
  const documentoValido = documentoCompleto && isValidDocumento(documento);
  const isCnpjValido = documentoDigits.length === 14 && isValidCnpj(documentoDigits);

  useEffect(() => {
    setDocumento(clienteAberto?.documento ?? '');
    setTelefone(clienteAberto?.telefone ?? '');
    setCep((clienteAberto?.endereco as Endereco)?.cep ?? '');
    setDadosCnpj(null);
  }, [clienteAberto, isCreating]);

  useEffect(() => {
    if (params.get('novo') !== '1') return;
    setClienteAberto(null);
    setIsCreating(true);
    const next = new URLSearchParams(params.toString());
    next.delete('novo');
    router.replace(`/clientes?${next}`);
  }, [params, router]);

  // Busca de clientes
  const listaKey = queryKeys.clientes.list(activeTenant?.id, {search: busca, status: statusFiltro, page, limit});
  const { data: clientesQuery, isLoading } = useQuery({
    queryKey: listaKey,
    queryFn: ({ signal }) => api<{data:Cliente[];meta:{page:number;limit:number;total:number;totalPages:number}}>(`/clientes?page=${page}&limit=${limit}&search=${encodeURIComponent(busca)}&status=${encodeURIComponent(statusFiltro)}`, { signal }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === activeTenant?.id ? previous : undefined,
  });
  const clientes=clientesQuery?.data??[];
  const clienteContratosQuery = useQuery({
    queryKey: ['clientes', clienteAberto?.id, 'contratos'],
    queryFn: ({ signal }) => api<ContratoLocacao[]>(`/locacao/contratos?cliente_id=${clienteAberto?.id}`, { signal }),
    enabled: Boolean(clienteAberto?.id),
    staleTime: 30_000,
  });
  const clienteContratos = clienteContratosQuery.data ?? [];

  type CreateVariables = { tempId: string; payload: Partial<Cliente> };
  type UpdateVariables = { id: string; payload: Partial<Cliente> };

  const updateCachedClient = (oldData: unknown, id: string, updater: (client: Cliente) => Cliente) => {
    if (Array.isArray(oldData)) {
      return oldData.map((client) => (client as Cliente).id === id ? updater(client as Cliente) : client);
    }
    if (!oldData || typeof oldData !== 'object') return oldData;
    const result = oldData as { data?: Cliente[] };
    return Array.isArray(result.data)
      ? { ...result, data: result.data.map((client) => client.id === id ? updater(client) : client) }
      : oldData;
  };
  const updateAllClientCaches = (id: string, updater: (client: Cliente) => Cliente) => {
    queryClient.getQueriesData({ queryKey: queryKeys.clientes.all }).forEach(([key, value]) => {
      queryClient.setQueryData(key, updateCachedClient(value, id, updater));
    });
  };

  // As três mutações seguem o mesmo ciclo: snapshot, mudança imediata, rollback e invalidação.
  const createMutation = useOptimisticMutation<Cliente, CreateVariables>({
    mutationFn: (data) => api<Cliente>('/clientes', {
      method: 'POST',
      body: JSON.stringify(data.payload),
    }),
    queryKeys: [listaKey, ['clientes', activeTenant?.id, 'orcamento-dropdown']],
    apply: (oldData, variables) => {
      const optimisticClient = {
        ...(variables.payload as Cliente),
        id: variables.tempId,
        created_at: new Date().toISOString(),
      };
      if (Array.isArray(oldData)) return [optimisticClient, ...oldData];
      if (!oldData || typeof oldData !== 'object') return oldData;
      const result = oldData as { data?: Cliente[]; meta?: { total?: number } };
      if (!Array.isArray(result.data)) return oldData;
      const matchesList = page === 1
        && (statusFiltro === 'TODOS' || (variables.payload.status ?? 'ATIVO') === statusFiltro)
        && (!busca || `${variables.payload.nome ?? ''} ${variables.payload.documento ?? ''} ${variables.payload.email ?? ''}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase()));
      return matchesList
        ? { ...result, data: [optimisticClient, ...result.data], meta: result.meta ? { ...result.meta, total: (result.meta.total ?? 0) + 1 } : result.meta }
        : oldData;
    },
    onSuccessData: (saved, variables) => {
      updateAllClientCaches(variables.tempId, () => saved);
      setIsCreating(false);
      toast.success('Cliente cadastrado com sucesso!');
    },
    invalidate: 'criarCliente',
  });

  const updateMutation = useOptimisticMutation<Cliente, UpdateVariables>({
    mutationFn: (data) => api<Cliente>(`/clientes/${data.id}`, {
      method: 'PUT',
      body: JSON.stringify(data.payload),
    }),
    queryKeys: [queryKeys.clientes.all],
    apply: (oldData, variables) => updateCachedClient(oldData, variables.id, (client) => ({ ...client, ...variables.payload })),
    onSuccessData: (updatedData) => {
      updateAllClientCaches(updatedData.id, () => updatedData);
      setClienteAberto(updatedData);
      toast.success('Cadastro atualizado!');
    },
    invalidate: 'editarCliente',
    invalidateVariables: (variables) => ({ id: variables.id }),
  });

  const deleteMutation = useOptimisticMutation<null, string>({
    mutationFn: (id: string) => api(`/clientes/${id}`, { method: 'DELETE' }),
    queryKeys: [queryKeys.clientes.all],
    apply: (oldData, id) => {
      if (!oldData || typeof oldData !== 'object') return oldData;
      const result = oldData as { data?: Cliente[]; meta?: { total?: number } };
      return Array.isArray(result.data)
        ? { ...result, data: result.data.filter((client) => client.id !== id), meta: result.meta ? { ...result.meta, total: Math.max(0, (result.meta.total ?? 1) - 1) } : result.meta }
        : oldData;
    },
    onSuccessData: () => {
      setClienteAberto(null);
      toast.success('Cliente removido.');
    },
    invalidate: 'excluirCliente',
    invalidateVariables: (id) => ({ id }),
  });

  // Handlers do Formulário
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const documentoForm = String(formData.get('documento') ?? '');
    if (documentoForm && !isValidDocumento(documentoForm)) {
      toast.error('Informe um CPF ou CNPJ válido.');
      return;
    }
    
    // Constrói o objeto de endereço
    const endereco = {
      cep: formData.get('cep') as string,
      rua: formData.get('rua') as string,
      numero: formData.get('numero') as string,
      complemento: formData.get('complemento') as string,
      bairro: formData.get('bairro') as string,
      cidade: formData.get('cidade') as string,
      uf: formData.get('uf') as string,
    };

    const payload = {
      nome: formData.get('nome') as string,
      documento: documentoForm,
      email: formData.get('email') as string,
      telefone: formData.get('telefone') as string,
      status: formData.get('status') as string,
      endereco,
    };

    if (isCreating) {
      createMutation.mutate({ tempId: `temp-${crypto.randomUUID()}`, payload });
    } else if (clienteAberto) {
      updateMutation.mutate({ id: clienteAberto.id, payload });
    }
  };

  const preencherEnderecoPorCep = async (value: string, form: HTMLFormElement | null) => {
    const cepDigits = value.replace(/\D/g, '');
    if (cepDigits.length !== 8 || !form) return;
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`);
      if (!response.ok) throw new Error('CEP não encontrado.');
      const address = await response.json() as ViaCepAddress;
      if (address.erro) throw new Error('CEP não encontrado.');
      const set = (name: string, field?: string) => {
        const input = form.elements.namedItem(name) as HTMLInputElement | null;
        if (input && field) input.value = field;
      };
      set('rua', address.logradouro);
      set('complemento', address.complemento);
      set('bairro', address.bairro);
      set('cidade', address.localidade);
      set('uf', address.uf);
      (form.elements.namedItem('numero') as HTMLInputElement | null)?.focus();
    } catch {
      toast.error('Não foi possível localizar este CEP. Preencha o endereço manualmente.');
    }
  };

  const consultarDocumento = async () => {
    const form = document.getElementById('cliente-form') as HTMLFormElement | null;
    const rawValue = (form?.elements.namedItem('documento') as HTMLInputElement | null)?.value || documento;
    const digits = rawValue.replace(/\D/g, '');

    if (digits.length !== 11 && digits.length !== 14) {
      toast.error('Digite um CPF (11 dígitos) ou CNPJ (14 dígitos) completo para consultar.');
      return;
    }

    if (digits.length === 11 && !isValidCpf(digits)) {
      toast.error('O CPF informado é inválido. Verifique os dígitos.');
      return;
    }

    if (digits.length === 14 && !isValidCnpj(digits)) {
      toast.error('O CNPJ informado é inválido. Verifique os dígitos.');
      return;
    }

    setConsultandoCnpj(true);
    try {
      let result: CnpjLookupResult | null = null;

      try {
        result = await api<CnpjLookupResult>(`/clientes/documento/${digits}`);
      } catch {
        if (digits.length === 14) {
          // Fallback direto via navegador para https://api.w14n.dev/v1/company/{cnpj} e BrasilAPI
          const w14nRes = await fetch(`https://api.w14n.dev/v1/company/${digits}`).catch(() => null);
          if (w14nRes && w14nRes.ok) {
            const w14nJson = await w14nRes.json();
            const c = w14nJson?.data;
            if (c?.legal_name) {
              const rawCep = String(c.location?.postal_code ?? '').replace(/\D/g, '');
              result = {
                cnpj: digits,
                razao_social: c.legal_name,
                nome_fantasia: c.trade_name || null,
                situacao_cadastral: c.status?.description_pt || (c.status?.code === '02' ? 'ATIVA' : c.status?.description_en || 'ATIVA'),
                natureza_juridica: c.legal_nature?.description_pt || c.legal_nature?.description_en || null,
                porte: c.company_size?.description_pt || (c.company_size?.code === '01' ? 'Microempresa (ME)' : c.company_size?.description_en || null),
                capital_social: typeof c.share_capital?.amount === 'number' ? c.share_capital.amount : null,
                data_abertura: c.opened_on || null,
                cnae_principal: c.main_activity?.cnae_code
                  ? { codigo: String(c.main_activity.cnae_code), descricao: c.main_activity.description_pt || c.main_activity.description_en || '' }
                  : null,
                telefone: null,
                email: null,
                endereco: {
                  cep: rawCep.length === 8 ? `${rawCep.slice(0, 5)}-${rawCep.slice(5)}` : rawCep,
                  rua: '',
                  numero: '',
                  complemento: '',
                  bairro: '',
                  cidade: c.location?.city || '',
                  uf: String(c.location?.state || '').toUpperCase(),
                },
                fonte: 'w14n',
              };
            }
          }
          if (!result) {
            const brRes = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
            if (!brRes.ok) {
              throw new Error(brRes.status === 404 ? 'CNPJ não encontrado na Receita Federal.' : 'Não foi possível consultar este CNPJ no momento.');
            }
            const b = await brRes.json();
            const rawCep = String(b.cep ?? '').replace(/\D/g, '');
            const rawTel = String(b.ddd_telefone_1 ?? '').replace(/\D/g, '');
            result = {
              cnpj: digits,
              razao_social: b.razao_social || b.nome_fantasia || '',
              nome_fantasia: b.nome_fantasia || null,
              situacao_cadastral: b.descricao_situacao_cadastral || null,
              natureza_juridica: b.natureza_juridica || null,
              porte: b.porte || b.descricao_porte || null,
              capital_social: typeof b.capital_social === 'number' ? b.capital_social : null,
              data_abertura: b.data_inicio_atividade || null,
              cnae_principal: b.cnae_fiscal ? { codigo: String(b.cnae_fiscal), descricao: b.cnae_fiscal_descricao || '' } : null,
              telefone: rawTel.length >= 10 ? rawTel : null,
              email: b.email ? String(b.email).toLowerCase() : null,
              endereco: {
                cep: rawCep.length === 8 ? `${rawCep.slice(0, 5)}-${rawCep.slice(5)}` : rawCep,
                rua: [b.descricao_tipo_de_logradouro, b.logradouro].filter(Boolean).join(' ').trim(),
                numero: b.numero || '',
                complemento: b.complemento || '',
                bairro: b.bairro || '',
                cidade: b.municipio || '',
                uf: String(b.uf || '').toUpperCase(),
              },
              fonte: 'brasilapi',
            };
          }
        } else {
          // Fallback para CPF (11 dígitos): verifica na lista local e valida
          const existingLocal = clientes.find(c => (c.documento ?? '').replace(/\D/g, '') === digits);
          if (existingLocal) {
            const addr = (typeof existingLocal.endereco === 'object' && existingLocal.endereco ? existingLocal.endereco : {}) as Endereco;
            result = {
              cnpj: digits,
              razao_social: existingLocal.nome,
              nome_fantasia: null,
              situacao_cadastral: 'CADASTRADO NA BASE',
              natureza_juridica: 'Pessoa Física (CPF)',
              porte: null,
              capital_social: null,
              data_abertura: null,
              cnae_principal: null,
              telefone: existingLocal.telefone,
              email: existingLocal.email,
              endereco: {
                cep: addr.cep || '',
                rua: addr.rua || '',
                numero: addr.numero || '',
                complemento: addr.complemento || '',
                bairro: addr.bairro || '',
                cidade: addr.cidade || '',
                uf: addr.uf || '',
              },
              fonte: 'cadastro_interno',
            };
          } else {
            result = {
              cnpj: digits,
              razao_social: '',
              nome_fantasia: null,
              situacao_cadastral: 'CPF VÁLIDO',
              natureza_juridica: 'Pessoa Física (CPF)',
              porte: null,
              capital_social: null,
              data_abertura: null,
              cnae_principal: null,
              telefone: null,
              email: null,
              endereco: { cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
              fonte: 'validacao_cpf',
            };
          }
        }
      }

      setDadosCnpj(result);
      const setField = (name: string, value?: string | null) => {
        if (!form || !value) return;
        const input = form.elements.namedItem(name) as HTMLInputElement | null;
        if (input) input.value = value;
      };

      if (result.razao_social || result.nome_fantasia) {
        setField('nome', result.razao_social || result.nome_fantasia);
      }
      if (result.email) setField('email', result.email);
      if (result.telefone) setTelefone(result.telefone);
      if (result.endereco.cep) setCep(result.endereco.cep);
      if (result.endereco.rua) setField('rua', result.endereco.rua);
      if (result.endereco.numero) setField('numero', result.endereco.numero);
      if (result.endereco.complemento) setField('complemento', result.endereco.complemento);
      if (result.endereco.bairro) setField('bairro', result.endereco.bairro);
      if (result.endereco.cidade) setField('cidade', result.endereco.cidade);
      if (result.endereco.uf) setField('uf', result.endereco.uf);

      // Se veio pela w14n (que traz CEP/Cidade/UF), complementa logradouro e bairro via ViaCEP automaticamente
      if (result.endereco.cep && !result.endereco.rua) {
        await preencherEnderecoPorCep(result.endereco.cep, form);
      }

      if (result.fonte === 'validacao_cpf') {
        toast.success('CPF validado com sucesso!');
        (form?.elements.namedItem('nome') as HTMLInputElement | null)?.focus();
      } else if (result.fonte === 'cadastro_interno') {
        toast.success(`Cliente "${result.razao_social}" localizado na base do sistema!`);
      } else {
        toast.success(`Dados de "${result.razao_social}" preenchidos com sucesso!`);
      }
    } catch (err) {
      toast.error((err as Error).message || 'Não foi possível consultar o documento.');
    } finally {
      setConsultandoCnpj(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#141414] text-white p-8 animate-in fade-in duration-300 relative">
      {/* HEADER & TOOLBAR */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Users className="text-[#b0fb5d]" size={28} />
            Clientes
          </h1>
          <p className="text-sm text-gray-500 mt-1">Gerencie sua carteira de contatos ({clientes.length} registros)</p>
        </div>
        <button 
          onClick={() => { setClienteAberto(null); setIsCreating(true); }}
          className="bg-[#b0fb5d] text-black px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 hover:bg-[#9de44f] transition-all shadow-[0_0_15px_rgba(176,251,93,0.2)]"
        >
          <Plus size={18} /> Novo Cliente
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} aria-hidden="true" />
          <form onSubmit={(event) => { event.preventDefault(); aplicarBusca(buscaInput); }}>
            <input
              value={buscaInput}
              onChange={(e) => setBuscaInput(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg pl-14 pr-4 py-2.5 text-sm focus:ring-1 focus:ring-[#b0fb5d] outline-none transition-all placeholder:text-gray-600"
              placeholder="Buscar por nome, e-mail ou documento..."
              aria-label="Buscar clientes"
            />
          </form>
        </div>
        <button type="button" onClick={() => setFiltrosAbertos((open) => !open)} aria-expanded={filtrosAbertos} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-sm text-gray-400 hover:text-white transition-colors whitespace-nowrap">
          <Filter size={16} /> Filtros
        </button>
      </div>
      {filtrosAbertos && (
        <div className="flex items-center gap-3 mb-6 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-3">
          <label htmlFor="cliente-status" className="text-sm text-gray-400">Status</label>
          <select id="cliente-status" value={statusFiltro} onChange={(event) => setStatusFiltro(event.target.value)} className="bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[#b0fb5d]">
            <option value="TODOS">Todos ativos</option>
            <option value="ATIVO">Ativos</option>
            <option value="PROSPECT">Prospects</option>
          </select>
          {(busca || statusFiltro !== 'TODOS') && <button type="button" onClick={() => { setBuscaInput(''); aplicarBusca('', 'TODOS'); }} className="text-sm text-[#b0fb5d] hover:underline">Limpar filtros</button>}
        </div>
      )}

      {/* DATA TABLE */}
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#242424] text-gray-400 border-b border-[#2a2a2a]">
              <tr>
                <th className="p-4 font-medium">Nome / Empresa</th>
                <th className="p-4 font-medium">Documento</th>
                <th className="p-4 font-medium">Contato</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Cadastrado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a2a]">
              {isLoading ? (
                Array.from({ length: 5 }, (_, index) => (
                  <tr key={`skeleton-${index}`} aria-hidden="true">
                    {Array.from({ length: 5 }, (_, cell) => <td key={cell} className="p-4"><div className="h-4 rounded bg-[#2a2a2a] animate-pulse" /></td>)}
                  </tr>
                ))
              ) : clientes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-gray-500">
                    <div className="flex flex-col items-center gap-3">
                      <Users size={40} className="text-gray-700" />
                      <p>Nenhum cliente encontrado.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                clientes.map((c) => (
                  <tr 
                    key={c.id} 
                    className="hover:bg-[#242424]/50 transition-colors cursor-pointer group" 
                    onClick={() => { setIsCreating(false); setClienteAberto(c); }}
                  >
                    <td className="p-4">
                      <div className="font-semibold text-white group-hover:text-[#b0fb5d] transition-colors">{c.nome}</div>
                    </td>
                    <td className="p-4 text-gray-400">
                      {c.documento ? c.documento : <span className="text-gray-600">-</span>}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1 text-xs text-gray-400">
                        {c.telefone && <span className="flex items-center gap-1.5"><Phone size={12}/> {c.telefone}</span>}
                        {c.email && <span className="flex items-center gap-1.5"><Mail size={12}/> {c.email}</span>}
                        {!c.telefone && !c.email && <span className="text-gray-600">Sem contato</span>}
                      </div>
                    </td>
                    <td className="p-4">
                      {c.status === 'ATIVO' ? (
                        <span className="bg-[#b0fb5d]/10 text-[#b0fb5d] px-2.5 py-1 rounded-md text-xs font-medium border border-[#b0fb5d]/20 inline-flex items-center gap-1.5">
                          <CheckCircle2 size={12}/> Ativo
                        </span>
                      ) : (
                        <span className="bg-gray-500/10 text-gray-400 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-500/20 inline-flex items-center gap-1.5">
                          <Clock size={12}/> {c.status}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right text-gray-500 text-xs">
                      {new Date(c.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination meta={clientesQuery?.meta} onPage={setPage} onLimit={setLimit}/>
      </div>

      {/* DRAWER / SLIDE-OVER (Criar ou Editar) */}
      {(clienteAberto || isCreating) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Overlay escuro */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" 
            onClick={() => { setClienteAberto(null); setIsCreating(false); }} 
          />
          
          {/* Painel (Sheet) */}
          <div className="relative w-full max-w-lg bg-[#1a1a1a] border-l border-[#2a2a2a] shadow-2xl flex flex-col h-full overflow-hidden animate-in slide-in-from-right duration-300">
            {/* Header da Gaveta */}
            <div className="flex items-center justify-between p-6 border-b border-[#2a2a2a] bg-[#141414]">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {isCreating ? <><UserCircle className="text-[#b0fb5d]"/> Novo Cadastro</> : <><Building2 className="text-[#b0fb5d]"/> Editar Cliente</>}
              </h2>
              <button 
                onClick={() => { setClienteAberto(null); setIsCreating(false); }} 
                className="p-2 text-gray-500 hover:text-white hover:bg-[#2a2a2a] rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Formulário Scrollável */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-6">
              <form id="cliente-form" onSubmit={handleSubmit} className="space-y-8">
                
                {/* Bloco: Dados Principais */}
                <section>
                  <h3 className="text-sm font-bold text-[#b0fb5d] uppercase tracking-wider mb-4 border-b border-[#2a2a2a] pb-2">Identificação</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Documento (CPF / CNPJ)</label>
                      <div className="flex gap-2">
                        <IMaskInput
                          name="documento"
                          mask={documentoMask(documento)}
                          value={documento}
                          onAccept={(value) => setDocumento(String(value))}
                          placeholder="Digite o CPF (11 dígitos) ou CNPJ (14 dígitos)..."
                          className={`flex-1 bg-[#242424] border rounded-lg px-4 py-2.5 text-sm text-white outline-none ${documentoValido?'border-green-500 focus:ring-1 focus:ring-green-500':documentoCompleto?'border-red-500 focus:ring-1 focus:ring-red-500':'border-[#2a2a2a] focus:ring-1 focus:ring-[#b0fb5d]'}`}
                        />
                        <button
                          type="button"
                          onClick={consultarDocumento}
                          disabled={consultandoCnpj}
                          title="Consultar dados por CNPJ ou CPF"
                          className="px-4 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 bg-[#b0fb5d] text-black hover:bg-[#9de44f] transition-all disabled:opacity-50 whitespace-nowrap shadow-[0_0_12px_rgba(176,251,93,0.15)]"
                        >
                          {consultandoCnpj ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                          {consultandoCnpj ? 'Consultando...' : 'Consultar CNPJ/CPF'}
                        </button>
                      </div>
                      {documentoCompleto && (
                        <p className={`mt-1 text-xs ${documentoValido ? 'text-green-400' : 'text-red-400'}`}>
                          {documentoValido
                            ? isCnpjValido
                              ? 'CNPJ válido — clique em "Consultar CNPJ/CPF" para preencher os dados automaticamente'
                              : 'CPF válido — clique em "Consultar CNPJ/CPF" para verificar na base'
                            : 'CPF/CNPJ inválido'}
                        </p>
                      )}
                    </div>

                    {dadosCnpj && (
                      <div className="rounded-xl border border-[#b0fb5d]/30 bg-[#b0fb5d]/5 p-4 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#b0fb5d] uppercase tracking-wider flex items-center gap-1.5">
                            <Building2 size={14} /> {dadosCnpj.fonte === 'validacao_cpf' || dadosCnpj.fonte === 'cadastro_interno' ? 'Resultado da Consulta (CPF)' : 'Dados Empresariais Encontrados'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {dadosCnpj.situacao_cadastral && (
                              <span className="px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30 font-semibold uppercase text-[10px]">
                                {dadosCnpj.situacao_cadastral}
                              </span>
                            )}
                          </div>
                        </div>

                        {dadosCnpj.fonte === 'validacao_cpf' ? (
                          <div className="text-gray-300 space-y-1 pt-1">
                            <p>O CPF informado é <strong>válido</strong> e está liberado para novo cadastro.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-gray-300">
                            <div className="sm:col-span-2">
                              <span className="text-gray-500 block text-[11px]">{dadosCnpj.fonte === 'cadastro_interno' ? 'Nome Cadastrado:' : 'Razão Social:'}</span>
                              <strong className="text-white">{dadosCnpj.razao_social}</strong>
                            </div>
                            {dadosCnpj.nome_fantasia && (
                              <div className="sm:col-span-2 flex items-center justify-between gap-2 bg-[#1a1a1a]/80 p-2 rounded border border-[#2a2a2a]">
                                <div>
                                  <span className="text-gray-500 block text-[11px]">Nome Fantasia:</span>
                                  <strong className="text-white">{dadosCnpj.nome_fantasia}</strong>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const form = document.getElementById('cliente-form') as HTMLFormElement | null;
                                    const input = form?.elements.namedItem('nome') as HTMLInputElement | null;
                                    if (input && dadosCnpj.nome_fantasia) input.value = dadosCnpj.nome_fantasia;
                                  }}
                                  className="px-2.5 py-1 rounded bg-[#242424] hover:bg-[#b0fb5d] hover:text-black text-[#b0fb5d] border border-[#b0fb5d]/30 text-[11px] font-semibold transition-colors"
                                >
                                  Usar no Nome
                                </button>
                              </div>
                            )}
                            {dadosCnpj.cnae_principal && (
                              <div className="sm:col-span-2">
                                <span className="text-gray-500 block text-[11px]">Atividade Principal (CNAE):</span>
                                <span className="text-gray-200">{dadosCnpj.cnae_principal.codigo} — {dadosCnpj.cnae_principal.descricao}</span>
                              </div>
                            )}
                            {dadosCnpj.natureza_juridica && (
                              <div>
                                <span className="text-gray-500 block text-[11px]">Natureza:</span>
                                <span>{dadosCnpj.natureza_juridica}</span>
                              </div>
                            )}
                            {dadosCnpj.porte && (
                              <div>
                                <span className="text-gray-500 block text-[11px]">Porte:</span>
                                <span>{dadosCnpj.porte}</span>
                              </div>
                            )}
                            {dadosCnpj.data_abertura && (
                              <div>
                                <span className="text-gray-500 block text-[11px]">Data de Abertura:</span>
                                <span>{new Date(`${dadosCnpj.data_abertura}T00:00:00`).toLocaleDateString('pt-BR')}</span>
                              </div>
                            )}
                            {dadosCnpj.capital_social !== null && (
                              <div>
                                <span className="text-gray-500 block text-[11px]">Capital Social:</span>
                                <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(dadosCnpj.capital_social)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Nome / Razão Social *</label>
                      <input name="nome" defaultValue={clienteAberto?.nome} required className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                    </div>
                  </div>
                </section>

                {/* Bloco: Contato */}
                <section>
                  <h3 className="text-sm font-bold text-[#b0fb5d] uppercase tracking-wider mb-4 border-b border-[#2a2a2a] pb-2">Contato</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Celular / WhatsApp</label>
                      <IMaskInput name="telefone" mask="(00) 00000-0000" value={telefone} onAccept={(value) => setTelefone(String(value))} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">E-mail Corporativo</label>
                      <input name="email" type="email" defaultValue={clienteAberto?.email || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                    </div>
                  </div>
                </section>

                {/* Bloco: Endereço (JSON) */}
                <section>
                  <h3 className="text-sm font-bold text-[#b0fb5d] uppercase tracking-wider mb-4 border-b border-[#2a2a2a] pb-2 flex items-center gap-2"><MapPin size={14}/> Endereço</h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-1">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">CEP</label>
                        <IMaskInput name="cep" mask="00000-000" value={cep} onAccept={(value) => setCep(String(value))} onBlur={(event) => preencherEnderecoPorCep(event.currentTarget.value, event.currentTarget.form)} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Rua / Logradouro</label>
                        <input name="rua" defaultValue={(clienteAberto?.endereco as Endereco)?.rua || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-1">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Número</label>
                        <input name="numero" defaultValue={(clienteAberto?.endereco as Endereco)?.numero || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Complemento</label>
                        <input name="complemento" defaultValue={(clienteAberto?.endereco as Endereco)?.complemento || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-1">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Bairro</label>
                        <input name="bairro" defaultValue={(clienteAberto?.endereco as Endereco)?.bairro || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Cidade</label>
                        <input name="cidade" defaultValue={(clienteAberto?.endereco as Endereco)?.cidade || ''} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none" />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">UF</label>
                        <input name="uf" defaultValue={(clienteAberto?.endereco as Endereco)?.uf || ''} maxLength={2} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none uppercase" />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Bloco: Comercial */}
                <section>
                  <h3 className="text-sm font-bold text-[#b0fb5d] uppercase tracking-wider mb-4 border-b border-[#2a2a2a] pb-2">Comercial</h3>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Status da Conta</label>
                    <select name="status" defaultValue={clienteAberto?.status || 'ATIVO'} className="w-full bg-[#242424] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-sm text-white focus:ring-1 focus:ring-[#b0fb5d] outline-none appearance-none">
                      <option value="ATIVO">Ativo</option>
                      <option value="INATIVO">Inativo</option>
                      <option value="PROSPECT">Prospect (Aguardando Aprovação)</option>
                    </select>
                  </div>
                </section>

                {!isCreating && clienteAberto && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between border-b border-[#2a2a2a] pb-2">
                      <h3 className="text-sm font-bold text-[#b0fb5d] uppercase tracking-wider flex items-center gap-2">
                        <FileText size={16} /> Contratos Vinculados {clienteContratos.length > 0 ? `(${clienteContratos.length})` : ''}
                      </h3>
                      <Link 
                        href="/locacao/contratos" 
                        className="text-xs text-gray-400 hover:text-[#b0fb5d] flex items-center gap-1 transition-colors group"
                      >
                        Ver todos <ExternalLink size={12} className="group-hover:translate-x-0.5 transition-transform" />
                      </Link>
                    </div>

                    {clienteContratosQuery.isLoading ? (
                      <div className="flex items-center justify-center p-6 text-sm text-gray-500 gap-2">
                        <div className="w-4 h-4 border-2 border-[#b0fb5d] border-t-transparent rounded-full animate-spin" />
                        Carregando contratos vinculados...
                      </div>
                    ) : clienteContratosQuery.isError ? (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400 flex items-center gap-2">
                        <AlertCircle size={16} />
                        Não foi possível carregar os contratos deste cliente.
                      </div>
                    ) : clienteContratos.length === 0 ? (
                      <div className="text-center py-6 px-4 bg-[#242424]/40 border border-dashed border-[#2a2a2a] rounded-lg">
                        <FileText size={32} className="mx-auto text-gray-600 mb-2" />
                        <p className="text-xs text-gray-400 font-medium">Nenhum contrato vinculado a este cliente</p>
                        <p className="text-[11px] text-gray-500 mt-1">Os contratos emitidos para este cliente aparecerão aqui.</p>
                        <Link 
                          href="/locacao/contratos" 
                          className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-[#b0fb5d] hover:underline"
                        >
                          <Plus size={14} /> Novo Contrato
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {clienteContratos.map((contrato) => (
                          <div 
                            key={contrato.id} 
                            className="rounded-lg border border-[#2a2a2a] bg-[#242424] hover:border-[#3a3a3a] transition-all p-4 space-y-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white text-sm">
                                  Contrato #{contrato.id.slice(0, 8).toUpperCase()}
                                </span>
                                {contrato.periodicidade && (
                                  <span className="text-[10px] bg-white/5 border border-white/10 text-gray-400 px-1.5 py-0.5 rounded font-mono">
                                    {contrato.periodicidade}
                                  </span>
                                )}
                              </div>
                              <span className={`rounded-md px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                contrato.status === 'ATIVO' 
                                  ? 'bg-[#b0fb5d]/10 text-[#b0fb5d] border border-[#b0fb5d]/20' 
                                  : contrato.status === 'ENCERRADO'
                                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  : contrato.status === 'CANCELADO'
                                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}>
                                {contrato.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 bg-[#1e1e1e] p-2.5 rounded border border-[#2a2a2a]">
                              <div>
                                <span className="text-gray-500 text-[11px] block">Início:</span>
                                <strong className="text-gray-200">
                                  {contrato.data_inicio ? new Date(contrato.data_inicio).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'}
                                </strong>
                              </div>
                              <div>
                                <span className="text-gray-500 text-[11px] block">Fim / Devolução:</span>
                                <strong className="text-gray-200">
                                  {contrato.data_fim_prevista ? new Date(contrato.data_fim_prevista).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'}
                                </strong>
                              </div>
                              <div>
                                <span className="text-gray-500 text-[11px] block">Valor Total:</span>
                                <strong className="text-[#b0fb5d] font-semibold">
                                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(contrato.valor_total || 0))}
                                </strong>
                              </div>
                              <div>
                                <span className="text-gray-500 text-[11px] block">Condição:</span>
                                <strong className="text-gray-200">
                                  {contrato.condicao_pagamento || (contrato.dia_vencimento ? `Dia ${contrato.dia_vencimento}` : '—')}
                                </strong>
                              </div>
                            </div>

                            {contrato.itens && contrato.itens.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider block">
                                  Equipamentos ({contrato.itens.length})
                                </span>
                                <div className="space-y-1">
                                  {contrato.itens.map((it) => (
                                    <div key={it.id} className="flex items-center justify-between text-xs bg-[#1a1a1a] px-2.5 py-1.5 rounded border border-[#2a2a2a]">
                                      <span className="flex items-center gap-1.5 text-gray-300">
                                        <Package size={12} className="text-[#b0fb5d]" />
                                        {it.nome}
                                      </span>
                                      {it.patrimonio && (
                                        <span className="text-[10px] text-gray-500 font-mono">
                                          {it.patrimonio}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {contrato.observacoes && (
                              <p className="text-[11px] text-gray-400 italic bg-[#1a1a1a] p-2 rounded border border-[#2a2a2a]">
                                Obs: {contrato.observacoes}
                              </p>
                            )}

                            <div className="pt-1 flex justify-end">
                              <Link 
                                href="/locacao/contratos" 
                                className="text-xs text-gray-400 hover:text-[#b0fb5d] flex items-center gap-1 font-medium transition-colors"
                              >
                                Abrir no módulo de contratos <ExternalLink size={12} />
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

              </form>
            </div>

            {/* Footer de Ações Fixas */}
            <div className="p-6 border-t border-[#2a2a2a] bg-[#141414] flex items-center justify-between">
              {clienteAberto ? (
                <button 
                  onClick={() => {
                    if(confirm('Tem certeza que deseja apagar este cliente? Ele será ocultado do sistema.')) {
                      deleteMutation.mutate(clienteAberto.id);
                    }
                  }}
                  className="flex items-center gap-2 text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  type="button"
                >
                  <Trash2 size={16} /> Excluir Cliente
                </button>
              ) : <div></div>}

              <div className="flex gap-3">
                <button 
                  onClick={() => { setClienteAberto(null); setIsCreating(false); }}
                  className="px-5 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                  type="button"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  form="cliente-form"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="bg-[#b0fb5d] text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#9de44f] transition-colors disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending ? 'Sincronizando…' : 'Salvar Ficha'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

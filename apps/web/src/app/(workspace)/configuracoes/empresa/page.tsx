'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Building2, 
  Save, 
  CheckCircle2, 
  MapPin, 
  Phone, 
  Mail, 
  ShieldCheck, 
  FileText, 
  Sparkles,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { IMaskInput } from 'react-imask';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/useTenantStore';
import { isValidCnpj } from '@/lib/documento';

interface EmpresaData {
  id: string;
  segmento: 'LOCADORA' | 'SERRALHERIA' | 'MISTO';
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  telefone?: string;
  email?: string;
  inscricao_estadual?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  updated_at?: string;
}

export default function EmpresaSettingsPage() {
  const queryClient = useQueryClient();
  const { activeTenant, updateActiveTenant } = useTenantStore();

  const [nomeFantasia, setNomeFantasia] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [inscricaoEstadual, setInscricaoEstadual] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);

  // Fetch current company data from backend
  const { data: empresa, isLoading, isError, refetch } = useQuery<EmpresaData>({
    queryKey: ['empresa', activeTenant?.id],
    queryFn: () => api<EmpresaData>('/empresa'),
    staleTime: 1000 * 60 * 5,
  });

  // Populate form state when data loads or activeTenant changes
  useEffect(() => {
    if (empresa) {
      setNomeFantasia(empresa.nome_fantasia || activeTenant?.nome_fantasia || '');
      setRazaoSocial(empresa.razao_social || activeTenant?.razao_social || '');
      setCnpj(empresa.cnpj || activeTenant?.cnpj || '');
      setInscricaoEstadual(empresa.inscricao_estadual || '');
      setTelefone(empresa.telefone || '');
      setEmail(empresa.email || '');
      setCep(empresa.cep || '');
      setLogradouro(empresa.logradouro || '');
      setNumero(empresa.numero || '');
      setBairro(empresa.bairro || '');
      setCidade(empresa.cidade || '');
      setEstado(empresa.estado || '');
    } else if (activeTenant) {
      setNomeFantasia(activeTenant.nome_fantasia || '');
      setRazaoSocial(activeTenant.razao_social || '');
      setCnpj(activeTenant.cnpj || '');
    }
  }, [empresa, activeTenant]);

  // ViaCEP address lookup
  const handleCepChange = async (newCep: string) => {
    setCep(newCep);
    const cleanCep = newCep.replace(/\D/g, '');
    if (cleanCep.length === 8) {
      setBuscandoCep(true);
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const data = await res.json();
        if (!data.erro) {
          if (data.logradouro) setLogradouro(data.logradouro);
          if (data.bairro) setBairro(data.bairro);
          if (data.localidade) setCidade(data.localidade);
          if (data.uf) setEstado(data.uf);
          toast.success('Endereço preenchido pelo CEP.');
        }
      } catch {
        // silent fail on network error
      } finally {
        setBuscandoCep(false);
      }
    }
  };

  // Mutation to update company details
  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<EmpresaData>) => {
      return api<EmpresaData>('/empresa', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      // Update global tenant store so header, sidebar, and selectors update immediately
      updateActiveTenant({
        nome_fantasia: data.nome_fantasia,
        razao_social: data.razao_social,
        cnpj: data.cnpj,
        telefone: data.telefone,
        email: data.email,
        inscricao_estadual: data.inscricao_estadual,
        cep: data.cep,
        logradouro: data.logradouro,
        numero: data.numero,
        bairro: data.bairro,
        cidade: data.cidade,
        estado: data.estado,
      });

      queryClient.invalidateQueries({ queryKey: ['empresa'] });
      toast.success('Dados cadastrais da empresa salvos com sucesso!');
    },
    onError: (err: Error) => {
      toast.error(`Falha ao salvar: ${err.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!nomeFantasia.trim()) {
      toast.error('Informe o Nome Fantasia da empresa.');
      return;
    }

    if (!razaoSocial.trim()) {
      toast.error('Informe a Razão Social da empresa.');
      return;
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (cleanCnpj.length !== 14) {
      toast.error('CNPJ incompleto. Deve conter 14 dígitos.');
      return;
    }

    updateMutation.mutate({
      nome_fantasia: nomeFantasia.trim(),
      razao_social: razaoSocial.trim(),
      cnpj: cnpj.trim(),
      inscricao_estadual: inscricaoEstadual.trim() || undefined,
      telefone: telefone.trim() || undefined,
      email: email.trim() || undefined,
      cep: cep.trim() || undefined,
      logradouro: logradouro.trim() || undefined,
      numero: numero.trim() || undefined,
      bairro: bairro.trim() || undefined,
      cidade: cidade.trim() || undefined,
      estado: estado.trim() || undefined,
    });
  };

  const isLocadora = activeTenant?.segmento === 'LOCADORA';
  const cleanCnpjDigits = cnpj.replace(/\D/g, '');
  const cnpjValido = cleanCnpjDigits.length === 14 ? isValidCnpj(cleanCnpjDigits) : true;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2E3238] pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold text-[#E4E7EC] tracking-wider uppercase bg-[#E4E7EC]/10 px-2.5 py-0.5 rounded-full border border-[#E4E7EC]/20">
              CONFIGURAÇÕES DO SISTEMA
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono">
              ID: {activeTenant?.id ? `${activeTenant.id.slice(0, 8)}...` : '---'}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <Building2 className="w-7 h-7 text-[#E4E7EC]" />
            Dados Cadastrais da Empresa
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Altere as informações fiscais, institucionais e canais de contato da sua empresa ativa.
          </p>
        </div>

        {/* Quick Tenant Indicator */}
        <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#23262B] border border-[#2E3238] flex items-center justify-center text-[#E4E7EC] font-bold">
            {activeTenant?.nome_fantasia ? activeTenant.nome_fantasia.slice(0, 2).toUpperCase() : 'AS'}
          </div>
          <div>
            <div className="text-sm font-semibold text-white">
              {activeTenant?.nome_fantasia || 'Art Steel'}
            </div>
            <div className="text-xs text-[#E4E7EC] flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-[#E4E7EC] animate-pulse" />
              {isLocadora ? 'Locadora de Equipamentos' : 'Serralheria & Metalúrgica'}
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl p-12 text-center text-gray-400 flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-[#E4E7EC]" />
          <span>Carregando dados da empresa...</span>
        </div>
      ) : isError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-red-300 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span>Não foi possível carregar os dados cadastrais da empresa.</span>
          </div>
          <button 
            onClick={() => refetch()}
            className="px-3 py-1.5 bg-[#23262B] hover:bg-[#2E3238] rounded-lg text-xs font-medium text-white border border-[#2E3238]"
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Card 1: Identificação e Dados Fiscais */}
          <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#2E3238]">
              <FileText className="w-5 h-5 text-[#E4E7EC]" />
              <h2 className="text-base font-semibold text-white">Identificação & Dados Fiscais</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Nome Fantasia <span className="text-[#E4E7EC]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Art Steel"
                  value={nomeFantasia}
                  onChange={(e) => setNomeFantasia(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
                <span className="text-[11px] text-gray-500 mt-1 block">
                  Nome comercial exibido no topo, propostas e orçamentos.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Razão Social <span className="text-[#E4E7EC]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Art Steel Serralheria e Estruturas Metálicas LTDA"
                  value={razaoSocial}
                  onChange={(e) => setRazaoSocial(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
                <span className="text-[11px] text-gray-500 mt-1 block">
                  Nome oficial registrado na Junta Comercial e Receita Federal.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  CNPJ <span className="text-[#E4E7EC]">*</span>
                </label>
                <IMaskInput
                  mask="00.000.000/0000-00"
                  required
                  placeholder="00.000.000/0000-00"
                  value={cnpj}
                  onAccept={(val) => setCnpj(val)}
                  className={`w-full bg-[#23262B] border ${
                    cleanCnpjDigits.length === 14 && !cnpjValido
                      ? 'border-yellow-500/80 focus:border-yellow-500'
                      : 'border-[#2E3238] focus:border-[#E4E7EC]'
                  } rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#E4E7EC] transition-all font-mono`}
                />
                {cleanCnpjDigits.length === 14 && !cnpjValido && (
                  <span className="text-[11px] text-yellow-400 mt-1 block">
                    Aviso: Os dígitos verificadores deste CNPJ não são válidos pela Receita Federal.
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Inscrição Estadual (IE)
                </label>
                <input
                  type="text"
                  placeholder="Ex: 123.456.789.110 ou ISENTO"
                  value={inscricaoEstadual}
                  onChange={(e) => setInscricaoEstadual(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
              </div>

              <div className="md:col-span-2 bg-[#23262B] border border-[#2E3238] rounded-lg p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-gray-300 block">Segmento Operacional</span>
                  <span className="text-xs text-gray-500">
                    Define o fluxo da empresa: {isLocadora ? 'Locação de Equipamentos e Gestão de Frotas' : 'Serralheria, Fabricação de Metais e Ordens de Serviço'}.
                  </span>
                </div>
                <span className="px-3 py-1 bg-[#1A1C20] border border-[#2E3238] text-xs font-semibold text-[#E4E7EC] rounded-md uppercase tracking-wider">
                  {activeTenant?.segmento || 'SERRALHERIA'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Contato Corporativo */}
          <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#2E3238]">
              <Phone className="w-5 h-5 text-[#E4E7EC]" />
              <h2 className="text-base font-semibold text-white">Canais de Contato</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Telefone / WhatsApp Comercial
                </label>
                <IMaskInput
                  mask="(00) 00000-0000"
                  placeholder="(11) 99999-9999"
                  value={telefone}
                  onAccept={(val) => setTelefone(val)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  E-mail de Contato / Comercial
                </label>
                <input
                  type="email"
                  placeholder="comercial@artsteel.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
              </div>
            </div>
          </div>

          {/* Card 3: Endereço & Localização */}
          <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2E3238]">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[#E4E7EC]" />
                <h2 className="text-base font-semibold text-white">Endereço & Unidade</h2>
              </div>
              {buscandoCep && (
                <span className="text-xs text-[#E4E7EC] flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Buscando CEP...
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  CEP
                </label>
                <IMaskInput
                  mask="00000-000"
                  placeholder="00000-000"
                  value={cep}
                  onAccept={(val) => handleCepChange(val)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all font-mono"
                />
                <span className="text-[11px] text-gray-500 mt-1 block">
                  Preenchimento automático via ViaCEP.
                </span>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Logradouro (Rua, Avenida, Rodovia...)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Av. Industrial"
                  value={logradouro}
                  onChange={(e) => setLogradouro(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Número
                </label>
                <input
                  type="text"
                  placeholder="Ex: 1500 ou S/N"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Bairro
                </label>
                <input
                  type="text"
                  placeholder="Ex: Distrito Industrial"
                  value={bairro}
                  onChange={(e) => setBairro(e.target.value)}
                  className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    Cidade
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: São Paulo"
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    UF
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    placeholder="SP"
                    value={estado}
                    onChange={(e) => setEstado(e.target.value.toUpperCase())}
                    className="w-full bg-[#23262B] border border-[#2E3238] rounded-lg px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-[#E4E7EC] focus:ring-1 focus:ring-[#E4E7EC] transition-all uppercase"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Informações de Acesso & Segurança */}
          <div className="bg-[#1A1C20] border border-[#2E3238] rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#2E3238]">
              <ShieldCheck className="w-5 h-5 text-[#E4E7EC]" />
              <h2 className="text-base font-semibold text-white">Permissões & Identidade da Sessão</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="bg-[#23262B] border border-[#2E3238] p-3 rounded-lg">
                <span className="text-gray-400 block mb-1">Seu Perfil de Acesso</span>
                <span className="text-white font-semibold text-sm flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#E4E7EC]" />
                  {activeTenant?.role || 'ADMIN'}
                </span>
              </div>

              <div className="bg-[#23262B] border border-[#2E3238] p-3 rounded-lg">
                <span className="text-gray-400 block mb-1">Status da Conta</span>
                <span className="text-[#E4E7EC] font-semibold text-sm flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Ativa & Autorizada
                </span>
              </div>

              <div className="bg-[#23262B] border border-[#2E3238] p-3 rounded-lg">
                <span className="text-gray-400 block mb-1">Última Atualização</span>
                <span className="text-gray-300 font-mono text-sm">
                  {empresa?.updated_at 
                    ? new Date(empresa.updated_at).toLocaleString('pt-BR')
                    : 'Hoje'}
                </span>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#2E3238]">
            <button
              type="button"
              onClick={() => {
                if (empresa) {
                  setNomeFantasia(empresa.nome_fantasia || '');
                  setRazaoSocial(empresa.razao_social || '');
                  setCnpj(empresa.cnpj || '');
                  setInscricaoEstadual(empresa.inscricao_estadual || '');
                  setTelefone(empresa.telefone || '');
                  setEmail(empresa.email || '');
                  setCep(empresa.cep || '');
                  setLogradouro(empresa.logradouro || '');
                  setNumero(empresa.numero || '');
                  setBairro(empresa.bairro || '');
                  setCidade(empresa.cidade || '');
                  setEstado(empresa.estado || '');
                  toast.info('Dados originais restaurados.');
                }
              }}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white bg-[#23262B] hover:bg-[#2E3238] border border-[#2E3238] transition-colors"
            >
              Descartar alterações
            </button>

            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold bg-[#E4E7EC] text-[#121316] hover:bg-[#D4D8DF] transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-[#E4E7EC]/10"
            >
              {updateMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Salvando dados...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Salvar dados cadastrais
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

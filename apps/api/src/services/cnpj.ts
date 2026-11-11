import { HttpError } from '../middlewares/auth.js';

export interface CnpjLookupResult {
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
  fonte: 'w14n' | 'brasilapi';
}

type W14nCompanyResponse = {
  meta?: Record<string, unknown>;
  data?: {
    cnpj?: string;
    legal_name?: string;
    trade_name?: string | null;
    legal_nature?: {
      code?: string;
      description_en?: string;
      description_pt?: string;
    } | null;
    status?: {
      code?: string;
      description_en?: string;
      description_pt?: string;
    } | null;
    establishment_type?: string | null;
    opened_on?: string | null;
    company_size?: {
      code?: string;
      description_en?: string;
      description_pt?: string;
    } | null;
    share_capital?: {
      amount?: number | null;
      currency?: string;
      note?: string;
    } | null;
    main_activity?: {
      cnae_code?: string;
      description_en?: string;
      description_pt?: string;
    } | null;
    location?: {
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
      country?: string | null;
    } | null;
  };
};

type BrasilApiCnpjResponse = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string | null;
  descricao_situacao_cadastral?: string | null;
  natureza_juridica?: string | null;
  porte?: string | null;
  descricao_porte?: string | null;
  capital_social?: number | null;
  data_inicio_atividade?: string | null;
  cnae_fiscal?: number | string | null;
  cnae_fiscal_descricao?: string | null;
  ddd_telefone_1?: string | null;
  email?: string | null;
  cep?: string | null;
  descricao_tipo_de_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
};

const W14N_BASE_URL = process.env.W14N_API_BASE_URL || 'https://api.w14n.dev/v1';
const BRASILAPI_BASE_URL = process.env.BRASILAPI_BASE_URL || 'https://brasilapi.com.br/api/cnpj/v1';

export function normalizeCnpjDigits(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

export function isValidCnpjDigits(raw: string): boolean {
  const cnpj = normalizeCnpjDigits(raw);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calculateDigit = (digits: string) => {
    let weight = digits.length - 7;
    const sum = digits.split('').reduce((total, digit) => {
      const next = total + Number(digit) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return next;
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return (
    calculateDigit(cnpj.slice(0, 12)) === Number(cnpj[12]) &&
    calculateDigit(cnpj.slice(0, 13)) === Number(cnpj[13])
  );
}

function formatCep(raw?: string | null): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return digits;
}

function formatPhone(raw?: string | null): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return digits;
}

function translateW14nStatus(status?: W14nCompanyResponse['data'] extends infer D ? D extends { status?: infer S } ? S : never : never): string | null {
  if (!status) return null;
  if (status.description_pt) return status.description_pt;
  const code = String(status.code ?? '');
  if (code === '02' || status.description_en?.toLowerCase() === 'active') return 'ATIVA';
  if (code === '03') return 'SUSPENSA';
  if (code === '04') return 'INAPTA';
  if (code === '08') return 'BAIXADA';
  return status.description_en ?? null;
}

function translateW14nSize(size?: W14nCompanyResponse['data'] extends infer D ? D extends { company_size?: infer S } ? S : never : never): string | null {
  if (!size) return null;
  if (size.description_pt) return size.description_pt;
  const code = String(size.code ?? '');
  if (code === '01') return 'Microempresa (ME)';
  if (code === '03') return 'Empresa de Pequeno Porte (EPP)';
  if (code === '05') return 'Demais';
  return size.description_en ?? null;
}

export async function lookupCnpj(
  rawCnpj: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CnpjLookupResult> {
  const cnpj = normalizeCnpjDigits(rawCnpj);
  if (!isValidCnpjDigits(cnpj)) {
    throw new HttpError(400, 'INVALID_CNPJ', 'Informe um CNPJ válido com 14 dígitos.');
  }

  // 1. Consulta principal na API https://api.w14n.dev/v1/company/{cnpj}
  try {
    const w14nResponse = await fetchImpl(`${W14N_BASE_URL}/company/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (w14nResponse.ok) {
      const payload = (await w14nResponse.json()) as W14nCompanyResponse;
      const company = payload?.data;
      if (company && company.legal_name) {
        return {
          cnpj: normalizeCnpjDigits(company.cnpj || cnpj),
          razao_social: company.legal_name,
          nome_fantasia: company.trade_name || null,
          situacao_cadastral: translateW14nStatus(company.status),
          natureza_juridica:
            company.legal_nature?.description_pt ||
            company.legal_nature?.description_en ||
            null,
          porte: translateW14nSize(company.company_size),
          capital_social:
            typeof company.share_capital?.amount === 'number'
              ? company.share_capital.amount
              : null,
          data_abertura: company.opened_on || null,
          cnae_principal: company.main_activity?.cnae_code
            ? {
                codigo: String(company.main_activity.cnae_code),
                descricao:
                  company.main_activity.description_pt ||
                  company.main_activity.description_en ||
                  '',
              }
            : null,
          telefone: null,
          email: null,
          endereco: {
            cep: formatCep(company.location?.postal_code),
            rua: '',
            numero: '',
            complemento: '',
            bairro: '',
            cidade: company.location?.city || '',
            uf: (company.location?.state || '').toUpperCase(),
          },
          fonte: 'w14n',
        };
      }
    }
  } catch {
    // Em caso de falha de rede ou timeout na w14n, segue para o fallback complementar
  }

  // 2. Fallback complementar (BrasilAPI) quando o CNPJ não consta na amostra da w14n (404) ou indisponibilidade
  let brasilApiResponse: Response;
  try {
    brasilApiResponse = await fetchImpl(`${BRASILAPI_BASE_URL}/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HttpError(
      502,
      'CNPJ_SERVICE_UNAVAILABLE',
      'Não foi possível consultar o CNPJ no momento. Tente novamente em instantes.',
    );
  }

  if (brasilApiResponse.status === 404) {
    throw new HttpError(404, 'CNPJ_NOT_FOUND', 'CNPJ não encontrado na base da Receita Federal.');
  }

  if (!brasilApiResponse.ok) {
    throw new HttpError(
      502,
      'CNPJ_LOOKUP_FAILED',
      'Não foi possível consultar os dados deste CNPJ no momento.',
    );
  }

  const b = (await brasilApiResponse.json()) as BrasilApiCnpjResponse;
  const rua = [b.descricao_tipo_de_logradouro, b.logradouro]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    cnpj: normalizeCnpjDigits(b.cnpj || cnpj),
    razao_social: b.razao_social || b.nome_fantasia || '',
    nome_fantasia: b.nome_fantasia || null,
    situacao_cadastral: b.descricao_situacao_cadastral || null,
    natureza_juridica: b.natureza_juridica || null,
    porte: b.porte || b.descricao_porte || null,
    capital_social: typeof b.capital_social === 'number' ? b.capital_social : null,
    data_abertura: b.data_inicio_atividade || null,
    cnae_principal: b.cnae_fiscal
      ? {
          codigo: String(b.cnae_fiscal),
          descricao: b.cnae_fiscal_descricao || '',
        }
      : null,
    telefone: formatPhone(b.ddd_telefone_1),
    email: b.email ? String(b.email).toLowerCase() : null,
    endereco: {
      cep: formatCep(b.cep),
      rua,
      numero: b.numero || '',
      complemento: b.complemento || '',
      bairro: b.bairro || '',
      cidade: b.municipio || '',
      uf: (b.uf || '').toUpperCase(),
    },
    fonte: 'brasilapi',
  };
}

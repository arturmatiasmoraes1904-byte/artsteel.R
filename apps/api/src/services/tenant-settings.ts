import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TenantSettings {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  telefone?: string | null;
  email?: string | null;
  inscricao_estadual?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  updated_at?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');
const dataFilePath = path.join(dataDir, 'company-settings.json');

const defaultSettings: Record<string, TenantSettings> = {
  // Locadora: d43dfc71-5f48-45a9-b905-572fa5eac08d
  'd43dfc71-5f48-45a9-b905-572fa5eac08d': {
    nome_fantasia: 'Art Steel Locações',
    razao_social: 'Art Steel Locações LTDA',
    cnpj: '00.000.000/0001-01',
    telefone: '(11) 98765-4321',
    email: 'locacoes@artsteel.com.br',
    inscricao_estadual: 'ISENTO',
    cep: '01001-000',
    logradouro: 'Av. Industrial',
    numero: '1500',
    bairro: 'Distrito Industrial',
    cidade: 'São Paulo',
    estado: 'SP'
  },
  // Serralheria: 75f1882a-2545-444b-a2ac-60e6c62ef999
  '75f1882a-2545-444b-a2ac-60e6c62ef999': {
    nome_fantasia: 'Art Steel',
    razao_social: 'Art Steel Serralheria e Estruturas Metálicas LTDA',
    cnpj: '00.000.000/0002-02',
    telefone: '(11) 91234-5678',
    email: 'comercial@artsteel.com.br',
    inscricao_estadual: '123.456.789.110',
    cep: '01001-000',
    logradouro: 'Rua dos Metalúrgicos',
    numero: '500',
    bairro: 'Centro Industrial',
    cidade: 'São Paulo',
    estado: 'SP'
  }
};

function readAllSettings(): Record<string, TenantSettings> {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(dataFilePath)) {
      fs.writeFileSync(dataFilePath, JSON.stringify(defaultSettings, null, 2), 'utf8');
      return { ...defaultSettings };
    }
    const content = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(content);
    return { ...defaultSettings, ...parsed };
  } catch (err) {
    console.warn('[tenant-settings] Could not read file, using defaults:', err);
    return { ...defaultSettings };
  }
}

function writeAllSettings(data: Record<string, TenantSettings>): void {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[tenant-settings] Failed to save settings to disk:', err);
  }
}

export function getTenantSettings(tenantId: string, segmento?: string): TenantSettings {
  const all = readAllSettings();
  if (all[tenantId]) {
    return all[tenantId];
  }
  
  // Default based on segment or fallback
  const isLocadora = segmento === 'LOCADORA';
  const fallback: TenantSettings = {
    nome_fantasia: isLocadora ? 'Art Steel Locações' : 'Art Steel',
    razao_social: isLocadora ? 'Art Steel Locações LTDA' : 'Art Steel Serralheria e Estruturas Metálicas LTDA',
    cnpj: isLocadora ? '00.000.000/0001-01' : '00.000.000/0002-02',
    telefone: '',
    email: '',
    inscricao_estadual: '',
    cep: '',
    logradouro: '',
    numero: '',
    bairro: '',
    cidade: '',
    estado: ''
  };
  return fallback;
}

export function saveTenantSettings(tenantId: string, updates: Partial<TenantSettings>, segmento?: string): TenantSettings {
  const all = readAllSettings();
  const current = getTenantSettings(tenantId, segmento);
  const updated: TenantSettings = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString()
  };
  all[tenantId] = updated;
  writeAllSettings(all);
  return updated;
}

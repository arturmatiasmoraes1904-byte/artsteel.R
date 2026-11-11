CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  email text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), razao_social text NOT NULL, nome_fantasia text NOT NULL,
  cnpj text NOT NULL UNIQUE, segmento text NOT NULL CHECK (segmento IN ('LOCADORA','SERRALHERIA','MISTO')),
  telefone text, email text, inscricao_estadual text, cep text, logradouro text, numero text,
  bairro text, cidade text, estado text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id), role text NOT NULL CHECK (role IN ('ADMIN','OPERADOR','FINANCEIRO')),
  is_active boolean NOT NULL DEFAULT true, UNIQUE(user_id,tenant_id)
);
CREATE INDEX ON user_tenants (tenant_id,user_id);
CREATE TABLE clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL, documento text, email text, telefone text, endereco jsonb, status text NOT NULL DEFAULT 'ATIVO',
  deleted_at timestamptz, UNIQUE(tenant_id,id)
);
CREATE TABLE equipamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), nome text NOT NULL,
  numero_patrimonio text NOT NULL, numero_serie text, categoria text NOT NULL,
  status text NOT NULL DEFAULT 'DISPONIVEL' CHECK (status IN ('DISPONIVEL','LOCADO','MANUTENCAO','INATIVO')),
  horimetro_atual numeric(14,2) NOT NULL DEFAULT 0 CHECK (horimetro_atual>=0),
  valor_diaria numeric(14,2) NOT NULL CHECK (valor_diaria>=0), valor_reposicao numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_reposicao>=0),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,numero_patrimonio)
);
CREATE TABLE contratos_locacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), cliente_id uuid NOT NULL,
  data_inicio date NOT NULL, data_fim_prevista date NOT NULL CHECK (data_fim_prevista>=data_inicio),
  status text NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('RASCUNHO','ATIVO','ENCERRADO','CANCELADO')),
  valor_total numeric(14,2) NOT NULL CHECK (valor_total>=0), condicao_pagamento text NOT NULL, deleted_at timestamptz,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,cliente_id) REFERENCES clientes(tenant_id,id)
);
CREATE TABLE itens_contrato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), contrato_id uuid NOT NULL, equipamento_id uuid NOT NULL,
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade=1), valor_unitario numeric(14,2) NOT NULL CHECK (valor_unitario>=0),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,contrato_id,equipamento_id),
  FOREIGN KEY(tenant_id,contrato_id) REFERENCES contratos_locacao(tenant_id,id),
  FOREIGN KEY(tenant_id,equipamento_id) REFERENCES equipamentos(tenant_id,id)
);
CREATE TABLE ordens_manutencao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), equipamento_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('PREVENTIVA','CORRETIVA')), descricao text NOT NULL,
  custo_pecas numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_pecas>=0), custo_mao_obra numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_mao_obra>=0),
  horimetro_registro numeric(14,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA','EM_ANDAMENTO','CONCLUIDA')),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,equipamento_id) REFERENCES equipamentos(tenant_id,id)
);
CREATE TABLE materias_primas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), descricao text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('PERFIL','CHAPA','TUBO','BARRA')), liga_metalica text NOT NULL,
  peso_por_metro numeric(14,4) NOT NULL CHECK (peso_por_metro>=0), preco_por_kg numeric(14,2) NOT NULL CHECK (preco_por_kg>=0),
  estoque_atual numeric(14,3) NOT NULL DEFAULT 0 CHECK (estoque_atual>=0), UNIQUE(tenant_id,id)
);
CREATE TABLE orcamentos_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), cliente_id uuid,
  descricao_projeto text NOT NULL, peso_total_calculado_kg numeric(14,2) NOT NULL CHECK (peso_total_calculado_kg>=0),
  custo_materia_prima numeric(14,2) NOT NULL CHECK (custo_materia_prima>=0), custo_mao_obra numeric(14,2) NOT NULL CHECK (custo_mao_obra>=0),
  custo_acabamento numeric(14,2) NOT NULL CHECK (custo_acabamento>=0), margem_lucro_pct numeric(5,2) NOT NULL CHECK (margem_lucro_pct>=0 AND margem_lucro_pct<100),
  valor_final numeric(14,2) NOT NULL CHECK (valor_final>=0), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,cliente_id) REFERENCES clientes(tenant_id,id)
);
CREATE TABLE ordens_servico_serralheria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), orcamento_id uuid NOT NULL,
  status_etapa text NOT NULL DEFAULT 'CORTE' CHECK (status_etapa IN ('CORTE','SOLDA','MONTAGEM','ACABAMENTO','INSTALACAO_EXTERNA','CONCLUIDO')),
  data_entrega_prometida date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), concluido_em timestamptz,
  peso_consumido_kg numeric(14,2), peso_desperdicio_kg numeric(14,2), custo_real numeric(14,2),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,orcamento_id) REFERENCES orcamentos_projetos(tenant_id,id)
);
CREATE TABLE faturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), origem text NOT NULL CHECK (origem IN ('LOCACAO','SERRALHERIA')),
  valor numeric(14,2) NOT NULL CHECK (valor>=0), data_vencimento date NOT NULL,
  status_pagamento text NOT NULL DEFAULT 'PENDENTE' CHECK (status_pagamento IN ('PENDENTE','PAGO','ATRASADO')),
  tipo_documento text NOT NULL CHECK (tipo_documento IN ('FATURA_LOCACAO','NFE_PRODUTO','NFSE_SERVICO')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE transacoes_financeiras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL CHECK (tipo IN ('RECEITA','DESPESA','TRANSFERENCIA')), 
  descricao text NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor>=0), 
  data_competencia date NOT NULL,
  data_vencimento date NOT NULL, 
  data_pagamento date,
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PAGO','ATRASADO','CANCELADO')),
  categoria text NOT NULL, 
  conta_bancaria text DEFAULT 'Conta Principal',
  cliente_id uuid, 
  parent_id uuid REFERENCES transacoes_financeiras(id),
  anexos jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), 
  FOREIGN KEY(tenant_id,cliente_id) REFERENCES clientes(tenant_id,id)
);
CREATE TABLE financeiro_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  transacao_id uuid NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  valor_dispensado numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_dispensado >= 0),
  metodo text NOT NULL CHECK (metodo IN ('DINHEIRO','PIX','CARTAO_CREDITO','CARTAO_DEBITO','BOLETO','TRANSFERENCIA','OUTRO','LEGADO')),
  metodo_outro text,
  data_pagamento date NOT NULL,
  observacao text,
  registrado_por uuid REFERENCES users(id),
  registrado_em timestamptz NOT NULL DEFAULT now(),
  revertido_em timestamptz,
  revertido_por uuid REFERENCES users(id),
  justificativa_reversao text,
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,transacao_id) REFERENCES transacoes_financeiras(tenant_id,id),
  CHECK (metodo <> 'OUTRO' OR nullif(trim(metodo_outro),'') IS NOT NULL),
  CHECK (revertido_em IS NULL OR (revertido_por IS NOT NULL AND length(trim(justificativa_reversao)) >= 10))
);
CREATE INDEX ON equipamentos(tenant_id,status);
CREATE INDEX ON faturas(tenant_id,data_vencimento);
CREATE INDEX ON ordens_servico_serralheria(tenant_id,status_etapa);
CREATE INDEX ON transacoes_financeiras(tenant_id,data_vencimento,status);
CREATE INDEX ON financeiro_pagamentos(tenant_id,transacao_id,registrado_em);

CREATE FUNCTION current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['clientes','equipamentos','contratos_locacao','itens_contrato','ordens_manutencao','materias_primas','orcamentos_projetos','ordens_servico_serralheria','faturas','transacoes_financeiras','financeiro_pagamentos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_tenant_id()) WITH CHECK (tenant_id=current_tenant_id())',tab);
  END LOOP;
END $$;

CREATE TABLE produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL,
  sku text,
  ean text,
  ncm text,
  unidade text DEFAULT 'UN',
  custo_medio numeric(14,2) DEFAULT 0,
  preco_venda numeric(14,2) DEFAULT 0,
  estoque_atual numeric(14,3) DEFAULT 0,
  estoque_minimo numeric(14,3) DEFAULT 0,
  localizacao text,
  status text DEFAULT 'ATIVO',
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, sku)
);

CREATE TABLE movimentacoes_estoque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  produto_id uuid NOT NULL REFERENCES produtos(id),
  tipo text NOT NULL CHECK (tipo IN ('ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA')),
  quantidade numeric(14,3) NOT NULL,
  custo_unitario numeric(14,2) DEFAULT 0,
  motivo text NOT NULL,
  documento text,
  responsavel_id uuid,
  created_at timestamptz DEFAULT now()
);


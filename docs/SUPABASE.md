# Supabase e Vercel

Projeto: abwkrotpfamfkypghfxy (nexo-operacoes, São Paulo).

## Preparar a conexão local

O backend usa PostgreSQL diretamente. O login continua na nossa API; não precisamos de chaves anon/service_role no frontend.

1. No painel do projeto, abra Connect e copie a conexão Session pooler (compatível com IPv4).
2. Configure DATABASE_ADMIN_URL em apps/api/.env com essa conexão e a senha do banco. Codifique caracteres reservados na senha da URL. Não envie a conexão com senha pelo chat.
3. Configure DATABASE_APP_PASSWORD com uma senha aleatória exclusiva de pelo menos 24 caracteres para o role nexo_app.
4. Execute npm run db:migrate. As tabelas e o role restrito serão criados. Se nexo_app já existir, sua senha será preservada.
5. Copie a conexão Transaction pooler para DATABASE_URL. Substitua o usuário por nexo_app.abwkrotpfamfkypghfxy e use a senha do passo 3. Preserve o host e a porta fornecidos pelo painel. Configure SSL conforme o painel.
6. Defina JWT_SECRET aleatório, com no mínimo 32 caracteres, e WEB_ORIGIN.

A API usa prepare: false e pool pequeno. A variável de contexto RLS é definida dentro de cada transação. As tabelas do sistema, incluindo o catálogo de identidade, não ficam acessíveis aos roles anon/authenticated da Data API.

## Vercel

Use dois projetos no mesmo repositório:
- API: Root Directory apps/api; DATABASE_URL, JWT_SECRET, WEB_ORIGIN.
- Frontend: Root Directory apps/web; NEXT_PUBLIC_API_URL com a URL HTTPS da API.

WEB_ORIGIN deve ser a origem HTTPS exata do frontend. Credenciais administrativas e DATABASE_APP_PASSWORD são usadas somente no provisionamento; não colocá-las na aplicação publicada.

Antes da publicação, confirmar a detecção Fastify em src/server.ts, sem confundir com a fábrica de testes src/app.ts. A adaptação e validação do deploy serão feitas na etapa de publicação.

## Banco de produção

Não executar o seed fictício em produção. O primeiro administrador e as empresas reais ainda precisam de cadastro.
Após provisionar, validar no Supabase com o role nexo_app: leitura operacional sem contexto vazia, escrita cruzada bloqueada e login/troca de empresa funcionando.


## Assistente local

Na raiz do projeto, execute no PowerShell: .\scripts\configure-supabase.ps1
Ele pede a senha do banco de forma oculta e gera os segredos da API localmente. Não sobrescreve um .env existente e não executa migrações. Depois, execute npm run db:migrate.


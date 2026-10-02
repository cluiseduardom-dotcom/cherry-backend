# Ambientes — Cherry Backend

O backend deve operar com ambientes isolados. Nunca reutilizar banco, segredo JWT ou allowlist CORS entre staging e produção.

## Desenvolvimento

- `NODE_ENV=development`
- Banco de desenvolvimento separado.
- `JWT_SECRET` exclusivo do ambiente.
- `CORS_ORIGINS` normalmente aponta para o frontend local.

## CI

- Banco PostgreSQL dedicado ao CI.
- `DATABASE_URL` do CI nunca deve ser o banco de staging ou produção.
- O pipeline executa `npm run db:migrate` antes do seed e dos testes.
- O seed é específico da base de CI.

## Staging

Criar um serviço Render separado do serviço de produção e usar:

- banco PostgreSQL separado;
- `DATABASE_URL` separado;
- `JWT_SECRET` separado;
- `CORS_ORIGINS` apontando somente para o frontend de staging;
- `NODE_ENV=production`.

Antes de promover código para produção, validar onboarding, login, criação de produtos, venda, estoque, financeiro e cancelamentos em staging.

## Produção

Usar um serviço Render e banco PostgreSQL exclusivos de produção, sem compartilhar credenciais com staging.

Variáveis mínimas:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET` com pelo menos 32 caracteres
- `CORS_ORIGINS`

O processo de inicialização falha quando uma configuração obrigatória de produção estiver ausente.

## Promoção

`feature branch → PR/CI → master → staging → validação manual → produção`

Migrations devem ser aplicadas antes do seed de CI e antes de inicializar a aplicação em qualquer ambiente com banco persistente.

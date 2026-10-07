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
- O seed é específico da base de CI e exige `SEED_PASSWORD` (mín. 12 caracteres); o workflow gera uma senha aleatória por execução. Não há senha padrão no código e o seed recusa rodar com `NODE_ENV=production` ou `staging`.

## Staging

Criar um serviço Render separado do serviço de produção e usar:

- banco PostgreSQL separado;
- `DATABASE_URL` separado;
- `JWT_SECRET` separado, com pelo menos 32 caracteres;
- `CORS_ORIGINS` apontando somente para o frontend de staging;
- `TRUST_PROXY_HOPS` (obrigatória; ver abaixo);
- `NODE_ENV=staging`.

`staging` é um valor de `NODE_ENV` explicitamente suportado (não um apelido de `production`) e recebe o mesmo hardening de produção: `JWT_SECRET` com pelo menos 32 caracteres e `CORS_ORIGINS` obrigatórios, sem o bypass permissivo de CORS que `development`/`test` têm (ver `src/config/runtimeConfig.js` e `src/app.js`).

Antes de promover código para produção, validar onboarding, login, criação de produtos, venda, estoque, financeiro e cancelamentos em staging.

## Produção

Usar um serviço Render e banco PostgreSQL exclusivos de produção, sem compartilhar credenciais com staging.

Variáveis mínimas:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET` com pelo menos 32 caracteres
- `CORS_ORIGINS`

`TRUST_PROXY_HOPS` — **obrigatória em staging e production** (o app não sobe sem ela; não há valor padrão). É o número de proxies confiáveis à frente do app e define de onde vem `req.ip`, usado pelo rate limit de login/onboarding. Em development/test, ausente vale `0`; valor que não seja inteiro ≥ 0 é rejeitado em qualquer ambiente.

No Render, o tráfego passa pelo Cloudflare e depois pelo proxy do Render: o valor **validado em ambiente temporário foi `2`**. Com `1` o app lê o IP do nó de borda do Cloudflare, que muda a cada requisição, e o rate limit deixa de funcionar; valor maior que o real aceitaria IP forjado pelo cliente. Depois de definir a variável, validar com dois IPs reais (mesmo e-mail bloqueado em um IP não pode bloquear o outro) e repetir a validação se o serviço passar a usar domínio próprio ou outra camada de proxy.

O processo de inicialização falha quando uma configuração obrigatória de produção estiver ausente.

## Promoção

`feature branch → PR/CI → master → staging → validação manual → produção`

Migrations devem ser aplicadas antes do seed de CI e antes de inicializar a aplicação em qualquer ambiente com banco persistente.

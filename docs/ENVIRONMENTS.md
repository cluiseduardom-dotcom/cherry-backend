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
- Os testes de integração só usam `TEST_DATABASE_URL` (o Postgres descartável do job, `cherry_ci`); nenhum teste lê o `.env` nem usa o banco de dev/produção. Veja `docs/TESTES.md`.
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

## Conexão de migração separada da de runtime

Em ambientes em que o serviço roda com um papel de banco restrito (sem propriedade das tabelas), as migrations precisam de um papel com permissão de DDL. Duas variáveis, com responsabilidades distintas:

| Variável | Quem usa | Papel esperado |
|---|---|---|
| `DATABASE_URL` | todas as consultas da API (`src/config/db.js`) | papel restrito de runtime (somente SELECT/INSERT/UPDATE/DELETE e uso de sequences) |
| `DATABASE_MIGRATION_URL` (opcional) | **somente** o executor de migrations (`src/database/migrate.js`, chamado por `npm start`/`npm run db:migrate` e por `src/server.js`) | papel dono do schema, com permissão de DDL |

Comportamento:

- **`DATABASE_MIGRATION_URL` ausente ou em branco:** o executor usa `DATABASE_URL`, como sempre (compatível com CI, dev, staging e produção atuais; nada precisa mudar).
- **Sem migrations pendentes:** o executor só lê (`to_regclass` e `SELECT` em `schema_migrations`); não emite DDL, `INSERT` nem transação. Por isso o serviço sobe normalmente só com o papel restrito, sem `DATABASE_MIGRATION_URL`.
- **Com migration pendente e sem permissão** (ex.: `must be owner of table ...`): a transação da migration sofre `ROLLBACK`, a migration não é registrada, o processo encerra com código 1 e **o servidor não sobe** (`npm start` usa `&&`; `src/server.js` chama `process.exit(1)`). A mensagem de erro cita apenas o **nome** da variável de conexão usada, nunca a URL nem a senha.
- A conexão de migração é fechada ao fim do executor; o pool de runtime é separado e nunca usa `DATABASE_MIGRATION_URL`.
- Nenhum valor de connection string vai para código, logs, commits ou documentação. Configure as duas variáveis apenas no painel do serviço.

Permissões do papel de runtime (configuradas uma vez no banco, fora do código; **não** conceder `SUPERUSER`, `BYPASSRLS`, `CREATEROLE` nem propriedade das tabelas). Como as tabelas novas passam a pertencer ao papel de migração, o runtime precisa de privilégios de DML sobre elas. Modelo (substitua os nomes pelos papéis reais do ambiente):

```sql
GRANT USAGE ON SCHEMA public TO <papel_runtime>;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO <papel_runtime>;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO <papel_runtime>;
-- tabelas e sequences criadas por migrations futuras pelo papel de migração:
ALTER DEFAULT PRIVILEGES FOR ROLE <papel_migracao> IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <papel_runtime>;
ALTER DEFAULT PRIVILEGES FOR ROLE <papel_migracao> IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO <papel_runtime>;
```

Sem o `ALTER DEFAULT PRIVILEGES`, uma migration que cria tabela deixa a API sem acesso a ela (erro `permission denied for table ...` em tempo de execução) até os `GRANT`s serem reaplicados.

## Promoção

`feature branch → PR/CI → master → staging → validação manual → produção`

Migrations devem ser aplicadas antes do seed de CI e antes de inicializar a aplicação em qualquer ambiente com banco persistente.

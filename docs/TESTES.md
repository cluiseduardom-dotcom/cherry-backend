# Testes — unitários x integração (e como NÃO tocar nos bancos compartilhados)

## Regra de ouro
**Nenhum teste automatizado escreve no banco de desenvolvimento ou de produção.** Os testes que precisam de banco só rodam
contra um banco de testes **isolado**, informado de forma explícita. Isso é imposto por código (não por convenção):
veja `tests/seguranca/validarBancoDeTeste.js`, `tests/integration/globalSetup.js` e `jest.config.js`.

## Dois tipos de teste

| | Unitários | Integração |
|---|---|---|
| Comando | `npm test` (ou `npm run test:unit`) | `npm run test:integration` |
| Arquivos | todos os `*.test.js` **exceto** `*.integration.test.js` | `*.integration.test.js` + a parte "com banco" de `tests/database/migration045.test.js` |
| Banco | **nenhum**. `DATABASE_URL` vira um destino que recusa (`127.0.0.1:1`); falar com o banco falha na hora | **só** `TEST_DATABASE_URL`, validada antes de qualquer conexão |
| `.env` | nunca é lido (o `dotenv` é substituído por um stub nos dois projetos) | nunca é lido |
| Escreve no banco? | não | sim, mas só no banco de testes isolado |

Regra de nomenclatura: **toda suíte que usa o pool real (`src/config/db`) ou grava no banco é `*.integration.test.js`.**
`tests/seguranca/estrutura.test.js` falha se uma suíte unitária passar a escrever no banco.

## O que bloqueia a integração (antes de abrir qualquer conexão)
`tests/integration/globalSetup.js` roda uma vez, antes de qualquer suíte, e aborta o Jest inteiro se:

1. `TEST_DATABASE_URL` estiver ausente ou não for uma URL `postgres://`/`postgresql://`.
2. O **nome do banco** não parecer de teste (`cherry_test`, `cherry_ci`, `teste_x`… como palavra). Bancos de Neon/dev/produção
   se chamam `neondb` e são rejeitados aqui.
3. For o mesmo servidor/banco do `DATABASE_URL` habitual (o do arquivo `.env`, lido **só para bloquear**, ou o do ambiente),
   com ou sem `-pooler`, ou estiver em `BANCOS_COMPARTILHADOS_BLOQUEADOS` (lista de hosts, opcional).
4. O host for **remoto** sem a confirmação explícita `TEST_DATABASE_HOST_PERMITIDO=<mesmo host>` (loopback/`localhost` dispensa).
5. `NODE_ENV=production`.

Só depois de passar é feita **uma** conexão de identidade (`SELECT current_database()`), sem escrita. As mensagens mostram
host e banco, **nunca** usuário, senha ou a URL.

> O `DATABASE_URL` do `.env` **nunca** é usado como alternativa. `TEST_DATABASE_URL` precisa estar no ambiente do shell
> (não adianta colocá-la no `.env`: o `.env` não é lido pelos testes).

## Como configurar um banco de testes isolado (local)

1. Suba um Postgres descartável (exemplo com Docker; o nome do banco **tem** que ser de teste):
   ```bash
   docker run --name cherry-test-db -e POSTGRES_USER=cherry -e POSTGRES_PASSWORD=cherry \
     -e POSTGRES_DB=cherry_test -p 5433:5432 -d postgres:18
   ```
2. Aplique as migrations e o seed **nesse** banco. ⚠️ Cuidado: `src/database/migrate.js` e `src/database/seed.js` leem o
   `.env` e, **se a variável não estiver no ambiente, ela é preenchida a partir dele**. O `migrate.js` ainda **prefere
   `DATABASE_MIGRATION_URL`**, que pode apontar para o banco compartilhado. Defina `DATABASE_URL` e zere
   `DATABASE_MIGRATION_URL` no comando:
   - PowerShell
     ```powershell
     $env:DATABASE_URL = 'postgresql://cherry:cherry@localhost:5433/cherry_test'
     $env:DATABASE_MIGRATION_URL = ''          # impede o .env de redirecionar a migration
     npm run db:migrate
     $env:SEED_PASSWORD = '<senha-aleatoria-de-12+-caracteres>'
     node src/database/seed.js
     ```
   - bash
     ```bash
     export DATABASE_URL='postgresql://cherry:cherry@localhost:5433/cherry_test' DATABASE_MIGRATION_URL=''
     npm run db:migrate && SEED_PASSWORD="$(openssl rand -hex 16)" node src/database/seed.js
     ```
   (Mais seguro ainda: rode isso num clone/pasta **sem** `.env`.)
3. Rode a integração apontando `TEST_DATABASE_URL` para o mesmo banco (o `SEED_PASSWORD` do passo 2 também é necessário
   para `multiTenantIsolation`):
   ```powershell
   $env:TEST_DATABASE_URL = 'postgresql://cherry:cherry@localhost:5433/cherry_test'
   npm run test:integration
   ```
4. Sem `TEST_DATABASE_URL`, `npm run test:integration` falha na hora com a mensagem `TESTES DE INTEGRAÇÃO BLOQUEADOS…`.

**Banco remoto (ex.: um projeto Neon só para testes):** crie nele um **banco chamado `cherry_test`** (o padrão `neondb`
é recusado) e informe também `TEST_DATABASE_HOST_PERMITIDO=<host da URL>`. Nunca use um branch que seja cópia de produção/dev
nem o mesmo servidor do `DATABASE_URL` do `.env`.

## CI
O job sobe um Postgres próprio (`cherry_ci`, descartável) e define `TEST_DATABASE_URL` apontando para ele. Passos:
migrations → seed → `npm test` (unitários) → `npm run test:integration`.

## Escrevendo testes de integração sem deixar resíduos
Use `tests/helpers/limpezaEmpresasTeste.js`:

```js
const registro = criarRegistroDeEmpresas(db);
const id = registro.registrar((await db.query('INSERT INTO empresas ... RETURNING id')).rows[0].id); // LOGO após o INSERT
// ... login, produtos, preços... (se algo falhar aqui, o afterAll ainda sabe o que remover)
afterAll(async () => { try { await registro.limpar(); } finally { await db.end(); } });
```

- `limpar()` descobre as tabelas com `empresa_id` pelo schema, resolve a ordem das FKs por tentativas e roda numa
  transação; **só apaga empresas cujo nome comece com "Teste" ou "Empresa Teste"** (nunca uma empresa real).
- `removerEmpresasPorNome(db, 'Teste X % <sufixo>')` é a rede de segurança por nome para o que não foi registrado.
- Antes (causa dos resíduos de out/2026): a empresa só era guardada no **fim** da preparação; se um passo falhasse no meio,
  o `afterAll` percorria uma lista vazia e deixava empresa, usuário e produtos no banco.

## Limites conhecidos
- As suítes de integração só foram validadas **contra um banco de verdade na CI**; localmente, sem banco isolado, são cobertas
  por testes unitários com banco falso (`tests/seguranca/*`) e por execuções reais do Jest contra um servidor TCP falso
  que só conta conexões (`tests/seguranca/integracaoBloqueada.test.js`).
- Quem tem acesso ao shell pode, de propósito, apontar `TEST_DATABASE_URL` para um banco **local** com nome de teste que
  contenha dados reais. O guard bloqueia bancos compartilhados conhecidos, mas não consegue provar que um banco local é "vazio".
- A branch `dev` do Neon não está protegida na plataforma; considere marcá-la como protegida.

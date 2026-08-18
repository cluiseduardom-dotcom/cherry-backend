# Cherry ERP — Backend

ERP para empresa de semijoias. Este arquivo é lido a cada sessão: mantenha-o curto.

**Multi-tenant desde a migration `007_multi_tenant.sql`**: existe tabela `empresas`; toda tabela de dado de negócio tem `empresa_id` (FK NOT NULL, indexada), e toda a camada de aplicação (controllers/services/repositories) já filtra por ele. `empresa_id` vem do JWT (`req.usuario.empresa_id`, setado no login) — nunca do body/query da requisição. Toda tabela nova precisa da coluna `empresa_id` desde a criação, e toda query nova (SELECT/UPDATE/DELETE/INSERT) precisa considerar `empresa_id` — nunca confiar só no id do recurso.

## Stack

- Node.js + Express
- PostgreSQL (Neon, região sa-east-1) — acesso via `pg`
- Auth: `bcrypt` + `jsonwebtoken`
- Testes: Jest
- Deploy: Render
- Frontend separado, em pasta irmã `cherry-frontend` (React + Vite + TypeScript + Tailwind)

## Variáveis de ambiente

`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN` (8h).
`.env` está no `.gitignore` e **nunca** deve ser commitado, ecoado no terminal ou colado em log.

## Papéis e permissões

Três papéis, gravados no JWT junto com o id do usuário:

| Papel | Acesso |
|---|---|
| `admin` | Total |
| `vendedor` | Vendas e produtos |
| `estoquista` | Estoque e movimentações |

**Regra inviolável:** `vendedor` NUNCA vê `preco_custo` nem `margem`, em nenhuma resposta, em nenhum endpoint, nem dentro de objetos aninhados. Filtre no serializador antes de responder — nunca confie só no front.

Outras regras:
- `estoquista` não acessa vendas nem financeiro.
- Criação/remoção de usuários: apenas `admin`.
- Toda rota é protegida pelo middleware de auth, salvo `POST /auth/login`.

## Convenções de API

- Respostas: `{ success: true, data }` ou `{ success: false, message }`. Sem exceções.
- Códigos: 400 validação, 401 sem token/token inválido, 403 papel sem permissão, 404 não encontrado, 409 conflito de regra de negócio, 500 erro inesperado.
- Listagens têm paginação simples (`page`, `limit`).
- Nomes de rotas, colunas e campos em **português**, sem acento e em snake_case (`preco_custo`, `estoque_minimo`). Isso vale também pra timestamp: colunas novas são `criado_em`/`atualizado_em`, nunca `created_at`/`updated_at` — decisão já tomada e reafirmada em fornecedores (ver abaixo), não reabrir.

## Estado atual dos módulos

Prontos:
- **Auth** — `POST /auth/login` com `bcrypt.compare`, geração de JWT (id + role), middleware de validação e middleware de autorização por papel.
- **Produtos/SKUs** — CRUD com soft delete via `ativo`. Escrita só admin, leitura para todos os papéis autenticados.
- **Movimentações de estoque** — tabela `movimentacoes_estoque` como ledger **append-only** (`produto_id`, `tipo`, `quantidade`, `estoque_resultante`, `motivo`, `usuario_id`, `criado_em`).
- **Precificação** — preço por canal (`precos_produto`), ledger append-only (nunca UPDATE, só INSERT de nova linha vigente).
- **PDV/vendas** — `POST /vendas` trava o preço vigente do canal no momento da venda; `PATCH /vendas/:id/cancelar` estorna estoque.
- **Dashboard analítico** — curva ABC, giro, cobertura em dias, margem por produto e canal. Admin-only.
- **Financeiro: contas a pagar** — primeira etapa do módulo financeiro, lançamento manual, sem vínculo com vendas. CRUD completo em `/contas-pagar`.
- **Financeiro: contas a receber** — segunda etapa, com vínculo automático a vendas (migration `009_contas_receber.sql`). Sem CRUD manual: nasce de `POST /vendas` com `forma_pagamento: 'prazo'`, é cancelada junto com a venda. `/contas-receber` só lê e marca como recebida.
- **Fornecedores** — Fase A do módulo de Produção (migration `010_fornecedores.sql`): cadastro simples, CRUD completo em `/fornecedores`, acesso admin+estoquista. Compras (Fase B) e Produção própria com ficha técnica (Fase C) ainda não implementadas.

Regras já decididas no estoque (não reabrir):
- `tipo`: `entrada` soma, `saida` subtrai, `ajuste` fixa valor absoluto (correção de contagem física).
- Escrita: admin e estoquista. Leitura: todos os papéis.
- Saída que zeraria negativo é bloqueada com 409, dentro de transação com lock de linha.
- Movimentação em produto inativo é bloqueada com 400.
- `estoque_atual` **não** pode ser alterado via `PUT /produtos/:id` — só muda por movimentação auditada.

Regras já decididas em contas a pagar (não reabrir):
- Acesso: **admin apenas** (`authMiddleware` + `requireAdmin` no mount da rota em `app.js`, igual ao dashboard). Nem vendedor nem estoquista acessam, nem para leitura.
- `status` tem só 3 valores reais: `pendente`, `pago`, `cancelado`. **`atrasado` não é status persistido** — é campo calculado na resposta (`status = 'pendente' AND data_vencimento < hoje`), no mesmo espírito de `produtosService.comMargem`. Não existe job/cron no projeto pra manter um 4º status sincronizado com a data atual; recalcular na leitura é mais simples e sempre correto.
- `PATCH /:id/pagar` e `DELETE /:id` (que **cancela**, não faz `DELETE` de linha — mesma filosofia do soft delete de produtos e do cancelamento de vendas) só funcionam a partir de `pendente`; a checagem de status mora no repository, dentro de transação com `SELECT ... FOR UPDATE`, igual a `vendasRepository.cancelar` — evita corrida entre duas requisições concorrentes.
- `fornecedor` é texto livre (`VARCHAR`), não referência a tabela: não existe entidade de fornecedor no sistema ainda.
- `PUT /:id` (editar) não tem restrição de status — pode editar conta paga ou cancelada. Não foi pedido bloqueio nisso; se quiser travar edição de conta já paga/cancelada, é decisão de negócio a confirmar antes de implementar.
- **Armadilha de fuso horário com colunas `DATE`**: o driver `pg` serializa um `Date` do Node pra uma coluna `DATE`/`TIMESTAMP` usando os métodos de **fuso horário local** do processo (`getFullYear`/`getMonth`/`getDate`), não UTC. `z.coerce.date('2026-08-10')` gera meia-noite UTC, que em qualquer servidor com fuso negativo (ex: `America/Sao_Paulo`, UTC-3) vira 09/08 21h local — grava um dia a menos. Corrigido usando `z.iso.date()` (mantém string `'YYYY-MM-DD'` do início ao fim, nunca vira `Date`). Vale lembrar disso pra qualquer coluna `DATE` futura.

Regras já decididas na migração multi-tenant (não reabrir):
- Tabela `empresas`: `id`, `nome`, `cnpj` (opcional), `status` (`ativa`/`inativa`), `criado_em`. Campo pedido como `created_at` foi renomeado pra `criado_em` pra seguir a convenção de nomes do projeto (português, snake_case) já usada em todas as outras tabelas.
- `empresa_id` foi adicionado (FK NOT NULL + índice) em `usuarios`, `clientes`, `produtos`, `vendas`, `itens_venda`, `movimentacoes_estoque`, `contas_pagar` (lista original) **e também** em `canais_venda` e `precos_produto` (não estavam na lista original, mas ficaram de fora seria inconsistente: canal de venda pode variar por empresa no futuro, e `precos_produto` é dado transacional). Confirmado com o usuário antes de implementar.
- Todas as linhas existentes foram migradas pra um registro seed único em `empresas`: nome "Cherry Semijoias" (placeholder, nome real não encontrado no repo), `cnpj` NULL. **Pendência:** ajustar nome/CNPJ reais quando o usuário informar.
- **Não foram alteradas** as UNIQUE constraints existentes (`usuarios.email`, `produtos.sku`) para incluir `empresa_id` — continuam únicas globalmente, não por empresa. Isso significa que duas empresas diferentes não podem ter usuário com o mesmo email, nem produto com o mesmo SKU. Ainda é decisão de regra de negócio a confirmar antes de mudar (não reabrir sem decisão explícita).
- **`canais_venda.nome` foi corrigido** (migration `008_canais_venda_unique_por_empresa.sql`): a constraint `UNIQUE(nome)` global ficou pra trás na migration 007 e travava qualquer empresa além da primeira — como não existe endpoint pra criar `canais_venda` e os dois canais padrão (`loja_fisica`, `online`) já pertenciam à empresa 1, nenhuma segunda empresa conseguia ter canal com esses nomes, o que quebrava produtos (listagem resolve canal sempre), vendas/PDV e precificação inteiros pra qualquer empresa nova — não era só uma questão de isolamento, era módulo não-funcional. Agora é `UNIQUE(empresa_id, nome)`. Achado e corrigido durante a validação de isolamento multi-tenant (2026-07-29), antes de rodar o teste de isolamento.
- Continua **não existindo endpoint pra criar `empresas` nem `canais_venda`** — toda empresa/canal usado em teste ou onboarding real precisa ser inserido direto no banco por enquanto. Fora do escopo desta tarefa criar esses endpoints.

Regras já decididas no filtro de `empresa_id` na aplicação (não reabrir):
- `empresa_id` só existe no JWT (setado em `authService.login`, lido em `authMiddleware` como `req.usuario.empresa_id`). Controllers sempre passam `req.usuario.empresa_id` explicitamente pros services — nunca inferido de outro lugar.
- `POST /auth/register`: o novo usuário é criado na **mesma empresa do admin que está logado** (não existe campo de escolher empresa no body). Não há endpoint de "criar empresa" ainda — só o registro seed da migration.
- Toda leitura por id (`buscarPorId`, `FOR UPDATE`, etc.) filtra por `id AND empresa_id` na mesma query, nunca busca por id e checa depois em JS — evita corrida e é mais barato.
- Referência cruzada (ex: `cliente_id` numa venda, `produto_id` num item, `canal_id` num preço) é validada contra a mesma `empresa_id` de quem está fazendo a requisição, dentro da própria transação quando aplicável (`vendasRepository.criar` valida cliente e cada produto). Referência a recurso de outra empresa responde como se o recurso não existisse (404), nunca 403 — mesmo padrão já usado em `vendasService.buscarPorId` pra vendedor vendo venda de outro usuário (não confirma a existência do id).
- `itens_venda` e `movimentacoes_estoque` recebem `empresa_id` diretamente (denormalizado), não só via join — decisão já tomada na migration 007, mantida aqui pra evitar joins extras em toda leitura.

Regras já decididas em contas a receber (não reabrir):
- Acesso: **admin apenas** (mesmo padrão de contas a pagar/dashboard). Nem vendedor nem estoquista acessam.
- Vínculo é automático, não manual: `vendas` ganhou `forma_pagamento` (`a_vista`/`prazo`, default `a_vista`). Só venda `prazo` gera uma linha em `contas_receber`, dentro da mesma transação de `vendasRepository.criar` — venda à vista já é dinheiro recebido na hora, não entra no fluxo de "a receber". Não existe `POST`/`PUT` manual em `/contas-receber`: toda linha nasce de uma venda.
- `data_vencimento` vem de `dias_prazo` (número, obrigatório só quando `forma_pagamento = 'prazo'`, validado com `.refine` em `criarVendaSchema`) somado à data da venda — não é uma data explícita no payload. Cálculo usa getters locais do `Date` (`getFullYear`/`getMonth`/`getDate`), nunca `toISOString`, pela mesma armadilha de fuso horário já documentada em contas a pagar.
- `valor` é copiado de `vendas.total` no momento da criação e travado (nunca recalculado a partir da venda depois) — mesma filosofia de `preco_unitario` em `itens_venda`.
- `PATCH /vendas/:id/cancelar` cancela a conta a receber vinculada automaticamente, mas **só se ainda estiver `pendente`**. Se já foi `recebido`, o dinheiro já entrou: o cancelamento da **venda inteira** é bloqueado com 409 (`Venda com conta a receber já recebida não pode ser cancelada`), mesmo padrão de mensagem/status code do bloqueio de edição em `contasPagarRepository.atualizar`. Essa checagem roda logo após validar que a venda está `finalizada` e antes de estornar estoque ou atualizar o status da venda (`contasReceberRepository.cancelarPorVendaId`, dentro da mesma transação, reaproveitando o client externo, mesmo padrão de `estoqueRepository.criarMovimentacao`) — se bloquear, a transação inteira roda `ROLLBACK` e nada (estoque, status da venda) fica parcialmente alterado. Venda à vista nunca gerou conta, então é no-op.
- `status` segue o mesmo padrão de contas a pagar: só 3 valores persistidos (`pendente`, `recebido`, `cancelado`); `atrasado` é campo calculado na leitura, nunca gravado.
- `PATCH /contas-receber/:id/receber` marca como recebida, só a partir de `pendente`, com `FOR UPDATE` — mesmo padrão de `contasPagarRepository.marcarComoPaga`. Não existe cancelamento manual de conta a receber fora do cancelamento da venda: se for necessário no futuro (ex: perdão de dívida), é decisão de negócio a confirmar antes de implementar.

Regras já decididas em fornecedores (não reabrir):
- Acesso: **admin e estoquista** (`authMiddleware` + `requireEstoquista` no mount da rota em `app.js` — o mesmo middleware já usado em `POST /produtos/:id/movimentacoes`). Vendedor recebe 403 em toda rota do módulo, inclusive leitura. Diferente de contas a pagar/receber (admin apenas): fornecedor é dado operacional de estoque/compras, não financeiro.
- CRUD completo em `/fornecedores`: `GET /` (paginado, filtro opcional `nome` via `ILIKE`), `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`. `DELETE` **não apaga a linha** — faz soft delete via `ativo = false`, mesma filosofia do soft delete de produtos (não a de contas a pagar/receber, que usam `status = 'cancelado'` em vez de uma flag `ativo`).
- Único campo obrigatório é `nome`; `contato`, `telefone`, `email`, `cnpj_cpf`, `observacoes` são opcionais. `cnpj_cpf` valida só quantidade de dígitos (11 = CPF, 14 = CNPJ, ignorando pontuação) — sem checar dígito verificador, decisão explícita pra não sobre-engenhar validação de documento nesta fase.
- Multi-tenancy: `fornecedoresRepository` filtra `id AND empresa_id` na mesma query em toda leitura/escrita (listar, buscar por id, atualizar, desativar), mesmo padrão do resto do sistema. Fornecedor de outra empresa responde 404 (nunca 403) em `GET/PUT/DELETE /:id`.
- **Nomenclatura de timestamp**: `criado_em`/`atualizado_em` (português), não `created_at`/`updated_at` — mesma convenção já usada em `contas_pagar`/`contas_receber` (ver `## Convenções de API`). A tarefa original pedia `created_at`/`updated_at`; segui o padrão do projeto e avisei a divergência em vez de assumir. **Vale pra qualquer tabela nova daqui pra frente, não é específico de fornecedores — não reabrir esta discussão.**
- `produtos.fornecedor` (texto livre, `VARCHAR`) **não foi tocado** — continua existindo em paralelo à nova tabela `fornecedores`. Hoje um produto não tem `fornecedor_id`; a migração de dados (ligar produto ao fornecedor por FK) fica pra uma sessão futura, depois de validação manual do cadastro.
- Esta é só a Fase A do módulo de Produção (cadastro). Compras (Fase B) e Produção própria com ficha técnica (Fase C) ainda não existem — ver `MAPA_CHERRY_ERP.md` §7/§8 pra decisões de design já tomadas pra quando forem implementadas.

## Banco

- Alterações de schema vão em migration versionada, nunca em SQL solto direto no banco.
- Toda operação que envolve estoque ou dinheiro roda em transação.
- Seed (`src/database/seed.js`) cria a empresa "Cherry Semijoias" com usuários de teste dos três papéis (senhas com hash bcrypt), clientes, produtos (com preço em `precos_produto` e estoque via movimentação auditada) e vendas. **Idempotente**: pula silenciosamente se essa empresa já existir — seguro rodar contra um banco já seedado (dev local ou o branch `ci-test` da CI, que é persistente entre runs).
- `schema.sql` é mantido como referência do estado atual consolidado (fora das migrations incrementais); ao criar uma migration nova, replicar a mudança lá também.
- Dados de teste sempre limpos do banco ao fim da tarefa — exceto o seed acima, que é dado de baseline permanente, não "dado de teste temporário".

## CI

- `.github/workflows/ci.yml`: `npm ci` → syntax check → seed (`node src/database/seed.js`, idempotente) → `npm test`. Os steps de seed e teste recebem `DATABASE_URL`/`JWT_SECRET` via secrets do GitHub, apontando pro branch `ci-test` do Neon — um banco dedicado só pra CI, separado do banco de dev. `tests/routes/multiTenantIsolation.test.js` é o único teste que fala com banco de verdade (sem mock) e por isso é o único que depende desses secrets/seed; o resto da suíte roda mockada e não precisa de banco.

## Testes

- Cada endpoint novo cobre os três papéis (permitido, negado, e o caso de borda da regra de negócio).
- Rode a suíte uma vez ao final. Não repita testes já validados só para confirmar.

## Como trabalhar comigo

- Escopo fechado: faça o que foi pedido, teste, pare. Se aparecer uma melhoria fora do escopo, anote no resumo final em vez de implementar.
- Não faça, sem eu pedir: bump de versão, licença, badges, README novo, refatoração de código não relacionado, troca de dependência.
- Decisões pequenas e reversíveis: decida e siga, documentando no commit. Decisões irreversíveis ou que mudam regra de negócio: pergunte antes.
- Commit ao final, mensagem descritiva em português. Push só quando eu pedir.
- Resumo final curto: o que mudou, decisões tomadas sozinho, o que foi testado, hash do commit.
- NUNCA faça push sem eu pedir explicitamente

## Fluxo de branches
- Nunca commitar direto em `master`.
- Todo trabalho começa com `git checkout -b feat/<modulo>` a partir de `master` atualizado.
- Push e abertura de PR são feitos manualmente por mim, no terminal.
- Merge só depois do CI verde.
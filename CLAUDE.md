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
- Nomes de rotas, colunas e campos em **português**, sem acento e em snake_case (`preco_custo`, `estoque_minimo`).

## Estado atual dos módulos

Prontos:
- **Auth** — `POST /auth/login` com `bcrypt.compare`, geração de JWT (id + role), middleware de validação e middleware de autorização por papel.
- **Produtos/SKUs** — CRUD com soft delete via `ativo`. Escrita só admin, leitura para todos os papéis autenticados.
- **Movimentações de estoque** — tabela `movimentacoes_estoque` como ledger **append-only** (`produto_id`, `tipo`, `quantidade`, `estoque_resultante`, `motivo`, `usuario_id`, `criado_em`).
- **Precificação** — preço por canal (`precos_produto`), ledger append-only (nunca UPDATE, só INSERT de nova linha vigente).
- **PDV/vendas** — `POST /vendas` trava o preço vigente do canal no momento da venda; `PATCH /vendas/:id/cancelar` estorna estoque.
- **Dashboard analítico** — curva ABC, giro, cobertura em dias, margem por produto e canal. Admin-only.
- **Financeiro: contas a pagar** — primeira etapa do módulo financeiro, lançamento manual, sem vínculo com vendas (contas a receber é etapa futura). CRUD completo em `/contas-pagar`.

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
- **Não foram alteradas** as UNIQUE constraints existentes (`usuarios.email`, `produtos.sku`, `canais_venda.nome`) para incluir `empresa_id` — hoje continuam únicas globalmente, não por empresa. Isso significa que duas empresas diferentes não podem ter usuário com o mesmo email, nem produto com o mesmo SKU. Ainda é decisão de regra de negócio a confirmar antes de mudar (não reabrir sem decisão explícita).

Regras já decididas no filtro de `empresa_id` na aplicação (não reabrir):
- `empresa_id` só existe no JWT (setado em `authService.login`, lido em `authMiddleware` como `req.usuario.empresa_id`). Controllers sempre passam `req.usuario.empresa_id` explicitamente pros services — nunca inferido de outro lugar.
- `POST /auth/register`: o novo usuário é criado na **mesma empresa do admin que está logado** (não existe campo de escolher empresa no body). Não há endpoint de "criar empresa" ainda — só o registro seed da migration.
- Toda leitura por id (`buscarPorId`, `FOR UPDATE`, etc.) filtra por `id AND empresa_id` na mesma query, nunca busca por id e checa depois em JS — evita corrida e é mais barato.
- Referência cruzada (ex: `cliente_id` numa venda, `produto_id` num item, `canal_id` num preço) é validada contra a mesma `empresa_id` de quem está fazendo a requisição, dentro da própria transação quando aplicável (`vendasRepository.criar` valida cliente e cada produto). Referência a recurso de outra empresa responde como se o recurso não existisse (404), nunca 403 — mesmo padrão já usado em `vendasService.buscarPorId` pra vendedor vendo venda de outro usuário (não confirma a existência do id).
- `itens_venda` e `movimentacoes_estoque` recebem `empresa_id` diretamente (denormalizado), não só via join — decisão já tomada na migration 007, mantida aqui pra evitar joins extras em toda leitura.

Próximo: contas a receber (vínculo com vendas).

## Banco

- Alterações de schema vão em migration versionada, nunca em SQL solto direto no banco.
- Toda operação que envolve estoque ou dinheiro roda em transação.
- Seed com usuários de teste dos três papéis já existe; senhas com hash bcrypt.
- Dados de teste sempre limpos do banco ao fim da tarefa.

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
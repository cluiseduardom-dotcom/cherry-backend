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
- **Análises de precificação de produto** (`GET /produtos/mais-vendidos`, `/curva-abc`, `/reposicao`, `/sugestao-preco`, `/giro`, `/parados`, `/pricing`, `/pricing-profissional`, `/lucro`, `/alerta-prejuizo`, `/inteligencia`, `/dashboard`) — cluster paralelo ao módulo Dashboard, montado só atrás de `authMiddleware` (sem `requireAdmin`/`requireEstoquista`); RBAC é por campo, não por rota — `produtosController.filtrarDadosAnaliticos` remove `custo`/`custo_total`/`margem_percentual`/`lucro`/`lucro_unitario` da resposta pra quem não é admin, mesmo padrão de `filtrarParaRole`. Ver `## Regras já decididas em custo congelado` pra qual fonte de custo cada rota usa. `getAcoes`/`produtosService.acoes` existe no repository/service mas não tem rota montada — função morta, candidata a limpeza numa branch própria, não removida por estar fora do escopo de quem a encontrou.
- **Movimentações de estoque** — tabela `movimentacoes_estoque` como ledger **append-only** (`produto_id`, `tipo`, `quantidade`, `estoque_resultante`, `motivo`, `usuario_id`, `criado_em`).
- **Precificação** — preço por canal (`precos_produto`), ledger append-only (nunca UPDATE, só INSERT de nova linha vigente).
- **PDV/vendas** — `POST /vendas` trava o preço vigente do canal (`preco_unitario`) **e o custo do produto** (`custo_unitario`, migration `015_custo_congelado_itens_venda.sql`) no momento da venda; `PATCH /vendas/:id/cancelar` estorna estoque. Ver `## Regras já decididas em custo congelado`.
- **Dashboard analítico** — curva ABC, giro, cobertura em dias, margem por produto e canal (margem aqui é **prospectiva**, não histórica — ver seção abaixo). Admin-only.
- **Financeiro: contas a pagar** — primeira etapa do módulo financeiro, lançamento manual, sem vínculo com vendas. CRUD completo em `/contas-pagar`.
- **Financeiro: contas a receber** — segunda etapa, com vínculo automático a vendas (migration `009_contas_receber.sql`). Sem CRUD manual: nasce de `POST /vendas` com `forma_pagamento: 'prazo'`, é cancelada junto com a venda. `/contas-receber` só lê e marca como recebida.
- **Financeiro: despesas fixas e Ponto de Equilíbrio** (migrations `011_ponto_equilibrio.sql`, `016_vigencia_despesas_fixas.sql`) — CRUD de `despesas_fixas` (categoria/descrição/valor/vigência, soft delete via `deletado_em`, pausa via `ativo`), admin-only. `GET /financeiro/ponto-equilibrio` calcula receita, custo variável (produtos, congelado — ver seção de custo congelado), custo fixo **rateado por dia dentro do período** (não soma mensal cheia) e margem de contribuição pro período informado (`data_inicio`/`data_fim`, default mês corrente). Ver `## Regras já decididas em rateio e vigência de despesas fixas` abaixo.
- **Fornecedores** — Fase A do módulo de Produção (migration `010_fornecedores.sql`): cadastro simples, CRUD completo em `/fornecedores`, acesso admin+estoquista.
- **Compras** — Fase B do módulo de Produção (migration `012_compras.sql`): entrada de mercadoria vinculada a fornecedor, CRUD em `/compras`, acesso admin+estoquista.
- **Produção própria (ficha técnica)** — Fase C do módulo de Produção (migration `013_producao.sql`): ficha técnica versionada em `/produtos/:id/ficha-tecnica`, registro de produção com consumo automático de insumos em `/producoes`, acesso admin+estoquista.
- **Relatórios (frontend, `cherry-frontend`)** — módulo completo: relatórios de Vendas, Estoque e Financeiro com dados reais e exportação em PDF (jsPDF + html2canvas). Sem rota nova no backend — reaproveita os endpoints analíticos já existentes. Mergeado em PR #6 do `cherry-frontend`.
- **Anonimização de clientes (LGPD)** — migration `014_clientes_anonimizacao.sql`: `PATCH /clientes/:id/anonimizar` remove nome/telefone/email e marca `ativo = false`, preservando `vendas.cliente_id`. Admin-only.

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
- **Bug encontrado e corrigido (29/08/2026, fora deste repo)**: a função `criarVenda` em `cherry-frontend/src/services/vendas.js` desestruturava só `canal`, `cliente_id` e `itens` — `forma_pagamento` e `dias_prazo`, já capturados pelo toggle "À vista/A prazo" da tela de Venda, nunca chegavam no payload enviado ao backend. Como `criarVendaSchema` trata `forma_pagamento` como opcional, toda venda feita pelo PDV caía no default `'a_vista'` sem erro visível na tela, e nenhuma conta a receber era gerada mesmo quando o usuário selecionava "A prazo". O backend estava correto — as regras desta seção sempre foram respeitadas; o bug era só no frontend, silenciosamente descartando os dois campos. Corrigido incluindo-os no payload; validado manualmente pelo PDV (venda a prazo grava `forma_pagamento: 'prazo'` e gera a linha em `contas_receber` com o vencimento esperado). Mergeado em PR #6 do `cherry-frontend`. Vale lembrar disso ao investigar qualquer caso futuro de "conta a receber não foi gerada" — checar primeiro se o payload do frontend está repassando os dois campos antes de suspeitar do backend.

Regras já decididas em fornecedores (não reabrir):
- Acesso: **admin e estoquista** (`authMiddleware` + `requireEstoquista` no mount da rota em `app.js` — o mesmo middleware já usado em `POST /produtos/:id/movimentacoes`). Vendedor recebe 403 em toda rota do módulo, inclusive leitura. Diferente de contas a pagar/receber (admin apenas): fornecedor é dado operacional de estoque/compras, não financeiro.
- CRUD completo em `/fornecedores`: `GET /` (paginado, filtro opcional `nome` via `ILIKE`), `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`. `DELETE` **não apaga a linha** — faz soft delete via `ativo = false`, mesma filosofia do soft delete de produtos (não a de contas a pagar/receber, que usam `status = 'cancelado'` em vez de uma flag `ativo`).
- Único campo obrigatório é `nome`; `contato`, `telefone`, `email`, `cnpj_cpf`, `observacoes` são opcionais. `cnpj_cpf` valida só quantidade de dígitos (11 = CPF, 14 = CNPJ, ignorando pontuação) — sem checar dígito verificador, decisão explícita pra não sobre-engenhar validação de documento nesta fase.
- Multi-tenancy: `fornecedoresRepository` filtra `id AND empresa_id` na mesma query em toda leitura/escrita (listar, buscar por id, atualizar, desativar), mesmo padrão do resto do sistema. Fornecedor de outra empresa responde 404 (nunca 403) em `GET/PUT/DELETE /:id`.
- **Nomenclatura de timestamp**: `criado_em`/`atualizado_em` (português), não `created_at`/`updated_at` — mesma convenção já usada em `contas_pagar`/`contas_receber` (ver `## Convenções de API`). A tarefa original pedia `created_at`/`updated_at`; segui o padrão do projeto e avisei a divergência em vez de assumir. **Vale pra qualquer tabela nova daqui pra frente, não é específico de fornecedores — não reabrir esta discussão.**
- `produtos.fornecedor` (texto livre, `VARCHAR`) **não foi tocado** — continua existindo em paralelo à nova tabela `fornecedores`. Hoje um produto não tem `fornecedor_id`; a migração de dados (ligar produto ao fornecedor por FK) fica pra uma sessão futura, depois de validação manual do cadastro.
- Esta foi a Fase A do módulo de Produção (cadastro). Compras (Fase B) e Produção própria com ficha técnica (Fase C) já foram implementadas — ver as seções "Regras já decididas em compras" e "Regras já decididas em produção própria (ficha técnica)" logo abaixo, e `MAPA_CHERRY_ERP.md` §8 pra decisões de schema mais detalhadas.

Regras já decididas na transação compartilhada (não reabrir):
- `src/repositories/shared/transacoes.js` concentra o esqueleto `BEGIN → SELECT ... FOR UPDATE → callback → COMMIT/ROLLBACK/release` que antes era reimplementado à mão em cada repository. Duas funções: `executarComLock(tabela, { coluna, valor }, empresa_id, clienteExterno, callback)` trava a linha e devolve a decisão inteira (o que fazer com not-found, com status errado, com efeitos colaterais) pra callback — o primitivo não sabe nada sobre status ou regra de negócio, só sobre lock/transação; `transicionarStatus(tabela, id, empresa_id, { statusEsperado, mensagemNaoEncontrado, mensagemStatusInvalido, sets })` é um wrapper fino sobre ele pro caso uniforme (existe → status bate → escreve `sets` fixo, senão 404/409).
- **Toda função nova que precise de `SELECT ... FOR UPDATE` dentro de uma transação usa `executarComLock`, nunca reimplementa BEGIN/COMMIT/ROLLBACK/release à mão.** Se a ramificação for o caso uniforme (um status esperado, um SET fixo), usa `transicionarStatus` direto. Se for irregular (no-op silencioso, efeitos colaterais entre o lock e a escrita, múltiplos status possíveis com comportamentos diferentes — como `contasReceberRepository.cancelarPorVendaId` ou `vendasRepository.cancelar`), chama `executarComLock` e escreve a ramificação própria na callback. Não force um caso irregular a caber em `transicionarStatus` — foi tentado deixar tudo num único helper genérico e rejeitado de propósito: a interface incharia até ficar tão complexa quanto os chamadores.
- `criarMovimentacao` (estoque) e `contasReceberRepository.criar` (INSERT puro, sem lock) **não** usam `executarComLock` — a dança `clienteExterno || await db.connect()` pra participar de transação externa em INSERTs sem lock continua ad hoc por enquanto. Unificar isso é um refactor separado (candidato 2 do `/improve-codebase-architecture`, ainda não feito), fora do escopo desta decisão.
- Migrado de `contasPagarRepository` (`marcarComoPaga`, `cancelar`, `atualizar`), `contasReceberRepository` (`marcarComoRecebida`, `cancelarPorVendaId`) e `vendasRepository` (`cancelar`) em 2026-09-01, sem mudança de comportamento. Testes: mecânica de lock/not-found/rollback é coberta uma vez em `tests/repositories/shared/transacoes.test.js`; os testes de cada repository encolheram pra wiring (mockam `executarComLock`/`transicionarStatus` e checam tabela/coluna/status/mensagem corretos), não fakeiam mais `pg.Client` sniffando SQL por string.

Regras já decididas em compras — Fase B do módulo de Produção (não reabrir):
- Acesso: **admin e estoquista** (`authMiddleware` + `requireEstoquista` no mount de `/compras` em `app.js`), mesmo padrão de fornecedores/produção — vendedor recebe 403 em toda rota do módulo.
- Uma compra registrada já é uma movimentação de estoque imediata (uma compra = uma entrada), não um pedido em aberto. `status` existe desde o schema inicial (default `'recebido'`, aceita também `'pendente'`/`'cancelado'`) pra permitir evoluir pra um fluxo de pedido formal sem reescrever a tabela depois — decisão tomada antes da implementação, `'pendente'` não é usado ainda (toda compra hoje nasce `'recebido'`).
- `DELETE` não existe; `PATCH /compras/:id/cancelar` cancela (soft, via `status`), nunca `DELETE` físico — mesma filosofia do resto do sistema (soft delete de produtos/fornecedores, cancelamento de vendas/contas).
- `contas_pagar.compra_id` (FK única) liga a compra à conta gerada, mas não há vínculo automático obrigatório: uma compra pode existir sem gerar conta a pagar.

Regras já decididas em produção própria (ficha técnica) — Fase C do módulo de Produção (não reabrir):
- Acesso: **admin e estoquista** (`authMiddleware` + `requireEstoquista` no mount de `/producoes` em `app.js`, e nas sub-rotas `/produtos/:id/ficha-tecnica`), mesmo padrão de fornecedores/compras. `GET /produtos/:id/ficha-tecnica/historico` é a única exceção, **admin apenas** (via `requireAdmin`) — histórico completo de versões é dado mais sensível que a vigente.
- **Insumo é um `produto` com `tipo = 'insumo'`, não uma tabela separada.** `produtos` ganhou a coluna `tipo` (`'acabado'` | `'insumo'`, default `'acabado'`) — insumo compartilha todo o resto do schema de produto (estoque, custo, soft delete, `empresa_id`) em vez de duplicar esse controle numa tabela `insumos` à parte.
- **Ficha técnica é versionada, ledger append-only, mas com mecanismo próprio** (não é o de `precos_produto`, que resolve "vigente" só por `criado_em` mais recente): nunca `UPDATE`, uma nova versão é sempre `INSERT` em `fichas_tecnicas` com a anterior marcada `vigente = false` na mesma transação; índice único parcial (`vigente = true` por `empresa_id + produto_id`) garante só uma vigente por produto.
- **Produção parcial é calculada automaticamente, não rejeitada**: cada insumo da ficha limita `quantidade_produzida` a `floor(estoque_atual do insumo / quantidade_necessaria)`; vence o mínimo entre todos os insumos e a `quantidade_solicitada`. Zero produzível bloqueia com 409 sem criar nada. Cancelamento (`PATCH /producoes/:id/cancelar`) estorna proporcional ao que foi **produzido**, nunca ao solicitado.
- **`custo_sugerido`/`custo_total` são calculados na leitura** (soma `quantidade × preco_custo` de cada insumo no momento da consulta) e **nunca sobrescrevem `produtos.preco_custo`** do produto acabado — ajustar o custo de venda com base nisso continua sendo decisão manual do usuário.
- **RBAC de custo aqui é decisão de negócio adicional, não extensão direta da regra inviolável**: a regra inviolável protege `vendedor`, que nem acessa este módulo (403). Quem perde `custo_sugerido`/`custo_total`/`custo_unitario`/`subtotal_custo` nas respostas é a `estoquista` (`filtrarCustoParaRole` em `fichasTecnicasController` e `producoesController`, mesmo padrão de `produtosController.filtrarParaRole`).
- `quantidade_necessaria` é `INTEGER`, igual a `produtos.estoque_atual`/`movimentacoes_estoque.quantidade` — consumo fracionário de insumo não é suportado (decisão consciente, exigiria repensar o ledger de estoque inteiro).
- Ver `MAPA_CHERRY_ERP.md` §8 pra decisões de schema mais detalhadas.

Regras já decididas em anonimização de clientes (LGPD) — migration `014_clientes_anonimizacao.sql` (não reabrir):
- Acesso: **admin apenas** (`requireAdmin` só na rota `PATCH /clientes/:id/anonimizar`, não no mount de `/clientes` em `app.js` — as outras rotas do módulo continuam abertas a todos os papéis autenticados). Ação irreversível e sensível.
- **Divergência de schema encontrada e corrigida**: a tarefa pedia `ativo → false (mesmo padrão de soft delete já usado no projeto)`, mas `clientes` não tinha coluna `ativo` (nem `criado_em`/`atualizado_em`) — só `id, empresa_id, nome, telefone, email`. Adicionada `ativo BOOLEAN NOT NULL DEFAULT true` na mesma migration que adiciona `anonimizado`/`anonimizado_em`, já que a operação depende dela. `criado_em`/`atualizado_em` não foram adicionados — fora do pedido desta tarefa.
- **`GET /clientes` não filtra por `ativo`** — mesmo padrão observado hoje em `produtos` (soft delete marca a flag, mas a listagem simples não filtra; só consultas analíticas específicas como `dashboardRepository`/`precosRepository` filtram `ativo = true`). Um cliente anonimizado continua aparecendo em `GET /clientes` (com `nome = 'Cliente removido'`) até essa decisão ser confirmada — não implementado por ser mudança de comportamento em endpoint existente, fora do escopo pedido.
- Checagem `anonimizado = true` → 409 é um caso **irregular** (não é `status` batendo um valor esperado): usa `executarComLock` direto, não `transicionarStatus` (que hardcoda a coluna `status`), mesmo critério documentado em `shared/transacoes.js`.
- Resposta é deliberadamente estreita (`{ id, anonimizado, anonimizado_em }`), montada no service, não a linha inteira do repository — evita qualquer chance de vazar campo pessoal residual na resposta, mesmo que já nulo/false no banco.
- `vendas.cliente_id` nunca é tocado — histórico de vendas e relatórios continuam intactos após a anonimização.

## Regras já decididas em custo congelado (itens_venda) — não reabrir

Migration `015_custo_congelado_itens_venda.sql`: `itens_venda` ganhou `custo_unitario` (`NUMERIC(10,2) NOT NULL CHECK >= 0`), congelando `produtos.custo` no momento da venda — mesmo padrão já usado em `preco_unitario`. Antes disso, margem e ponto de equilíbrio usavam `produtos.custo` (atual) via join, o que reescrevia resultado de vendas já fechadas toda vez que o custo de um produto mudava. Backfill da migration usou o custo atual (seguro por construção: 22 itens, 9 produtos, custo sempre preenchido, zero compras registradas na base no momento da migration — nenhum custo tinha mudado ainda).

- **`custo_unitario` é capturado no mesmo `SELECT ... FOR UPDATE` que já trava o produto pra validar/baixar estoque** (`estoqueRepository.criarMovimentacao`, que agora devolve `custo` no resultado), não numa query separada — evita janela de inconsistência entre o custo lido e o vigente no instante da baixa. `vendasRepository.criar` lê esse valor e grava junto do `INSERT INTO itens_venda`. Contrato da API não muda: o cliente nunca envia custo.
- **Existem DOIS tipos de margem no sistema, e todo cálculo novo de margem precisa declarar a qual pertence antes de escolher a fonte de custo:**
  - **Margem PROSPECTIVA** ("se eu vender hoje") = `produtos.custo` (atual) + preço vigente. Usada em: `GET /dashboard/margem` (`precosRepository.listarMargemPorProdutoECanal`), `GET /produtos/pricing`, `/pricing-profissional`, `/sugestao-preco`, `/inteligencia`, `/alerta-prejuizo`. Nenhuma dessas junta `itens_venda` — são simuladores de precificação atual, não análise de venda fechada. Congelar essas em `custo_unitario` cegaria o próprio propósito da rota (ex: `alerta-prejuizo` existe pra reagir a mudança de custo/preço *hoje*).
  - **Margem HISTÓRICA** ("o que já foi vendido") = `iv.custo_unitario` (congelado) + `iv.preco_unitario` (congelado). Usada em: `pontoEquilibrioRepository.somarCustoVariavelProdutos`, `GET /produtos/lucro` (`produtosRepository.getLucroPorProduto`), e por extensão qualquer relatório de venda no frontend que reaproveite esses endpoints (`cherry-frontend`, módulo Relatórios — sem rota própria no backend).
  - As duas fontes **não são intercambiáveis**. Trocar uma pela outra muda o significado do endpoint, não só a origem do dado — decisão de negócio, não refactor.
- **`produtosRepository.getLucroPorProduto` (`GET /produtos/lucro`) usa `iv.preco_unitario` (travado), não `p.preco_venda` (atual)**, pro cálculo de `faturamento`/`lucro`/`margem_percentual` — corrigido junto (2026-09-08), mesma mutabilidade histórica que o custo, agora fechada dos dois lados. Não precisou de migration: `preco_unitario` já existia e já era gravado desde a criação de vendas. Escopo dessa correção foi só esta função — o restante do cluster `/produtos/pricing` continua em `produtos.custo`/`preco_venda` atuais por ser margem prospectiva (ver tabela acima).
- **`GET /produtos/pricing`, `/pricing-profissional`, `/lucro`, `/alerta-prejuizo`, `/inteligencia`, `/sugestao-preco` não têm `requireAdmin`/`requireEstoquista` na rota** — RBAC é só por campo (`produtosController.filtrarDadosAnaliticos`, que remove `custo`/`custo_total`/`margem_percentual`/`lucro`/`lucro_unitario` da resposta pra quem não é admin). Confirmado (2026-09-08) que o filtro está de fato aplicado em todas as 11 funções analíticas do módulo e coberto em `tests/routes/produtos.test.js` — a nota antiga em `MAPA_CHERRY_ERP.md` §6 dizendo que essas rotas "devolvem o resultado cru sem nenhum filtro" estava desatualizada e foi corrigida.
- **RBAC de `custo_unitario` em `/vendas`**: `vendasController.filtrarParaRole` (mesmo padrão de `produtosController.filtrarParaRole`) remove `custo_unitario` de `itens` pra `vendedor`, aplicado em `POST /vendas`, `GET /vendas` e `GET /vendas/:id`. Rota não ganhou `requireAdmin` — padrão do projeto é filtrar campo, não negar rota.
- **Débito de UI conhecido, não corrigido aqui**: o rótulo "Margem" no Dashboard do frontend não indica que é prospectiva — fica pra um ajuste de UI em branch separado.
- Ver `MAPA_CHERRY_ERP.md` §8 pra mais detalhe sobre o cluster `/produtos/*` (rotas, achado de RBAC, decisão de manter/converter cada função).

## Regras já decididas em rateio e vigência de despesas fixas — não reabrir

Migration `016_vigencia_despesas_fixas.sql`: `despesas_fixas` ganhou `vigencia_inicio` (`DATE NOT NULL`) e `vigencia_fim` (`DATE`, `NULL` = em vigor, sem data de término), com `CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)`. Corrige dois bugs do Ponto de Equilíbrio: custo fixo comparava soma mensal cheia contra período arbitrário (7 dias contra um mês inteiro, ou 3 meses contra só um), e não existia vigência — cadastrar/desativar uma despesa hoje mudava o resultado de meses já fechados (mesma classe de bug já corrigida pro custo/preço de venda na migration 015).

- **`vigencia_inicio`/`vigencia_fim` são a fonte de verdade cronológica pro Ponto de Equilíbrio; `ativo` é pausa de exceção manual, e os dois convivem** (não é uma substituição): `ativo = true` é sempre checado primeiro no WHERE de `despesasFixasRepository.listarVigentesNoPeriodo` — uma despesa com `ativo = false` **nunca conta**, mesmo que a vigência cubra o período inteiro. Uma despesa com `ativo = true` e vigência cobrindo o período conta, independente de quando foi cadastrada ou alterada depois. Não existe nenhuma lógica automática que mude `vigencia_fim` ao desativar/excluir uma despesa — vigência é editada manualmente pelo usuário no formulário.
- **Caso de uso original de `ativo` (despesa sazonal, ex: 13º salário) passa a ser modelado por vigência**, não por ligar/desligar o toggle todo ano: cadastra-se a despesa com `vigencia_inicio`/`vigencia_fim` cobrindo exatamente o período em que ela existiu, e cadastra-se de novo no ciclo seguinte se for recorrente. Não muda nenhum código — é só a explicação de por que vigência manda sobre `ativo` pra fins cronológicos.
- **Custo fixo do Ponto de Equilíbrio é rateado por dia, não mais soma mensal cheia**: `src/utils/rateioCustoFixo.js` (`ratearCustoFixo`, função pura) divide o período em segmentos por mês calendário e, pra cada despesa vigente, calcula a interseção entre segmento/período/vigência, distribuindo `valor` proporcional a `dias_overlap / dias_no_mes` (dias reais do mês — fevereiro bissexto inclusive). `pontoEquilibrioService.calcular` chama `despesasFixasRepository.listarVigentesNoPeriodo` (substituiu `somarAtivas`, que não existe mais) + `ratearCustoFixo`.
- **`semDespesasFixas: true`** é campo novo na resposta de `GET /financeiro/ponto-equilibrio`: `true` quando `listarVigentesNoPeriodo` devolve lista **vazia** (zero despesas fixas vigentes no período) — não quando a soma dá zero (uma despesa cadastrada com `valor: 0`, tecnicamente permitido pelo `CHECK (valor >= 0)`, não deve disparar isso). Sem essa distinção, `custoFixoTotal = 0` faz `pontoEquilibrio = 0`, que a tela lia como "Meta batida ✅" mesmo sem nenhuma despesa fixa cadastrada — falso e enganoso. No frontend (`cherry-frontend`), `PontoEquilibrio.jsx` dá prioridade a `semDespesasFixas` sobre `inviavel`/`metaBatida`: quando `true`, não mostra valor de PE nenhum, só uma mensagem orientando o cadastro com link pra `/despesas-fixas`.
- **Armadilha de fuso timezone, agora do lado da LEITURA de uma coluna `DATE`** (a de contas a pagar/receber é do lado da escrita): o driver `pg` parseia `DATE` como `Date` à meia-noite **local** do processo, não UTC — `despesasFixasRepository` converte de volta pra string `'YYYY-MM-DD'` com getters locais (`getFullYear`/`getMonth`/`getDate`, nunca `toISOString`) antes de devolver a linha, em toda função que lê `vigencia_inicio`/`vigencia_fim` (`listar`, `criar`, `atualizar`, `deletar`, `alternarAtivo`, `listarVigentesNoPeriodo`). Sem isso, tanto o input `type="date"` do frontend quanto `ratearCustoFixo` (que espera string, não `Date`) quebrariam.
- **`ratearCustoFixo` em si usa `Date.UTC` em toda conversão, não getters locais** — diferente da regra acima: a função é aritmética pura entre datas que já chegam como string `'YYYY-MM-DD'` (não há "agora" envolvido, ao contrário de converter um `Date` de "agora" pra string), então UTC consistente nas duas pontas evita qualquer problema de fuso sem precisar de getters locais. Vale lembrar dessa distinção (getters locais só quando um `Date` de "agora"/do banco está envolvido; UTC quando é só aritmética entre strings de data já fixas) pra qualquer utilitário de data futuro.
- Testes de componente frontend não são criados pra isso — não é convenção existente no projeto (não há testes de `.jsx` na suíte atual do `cherry-frontend`).

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

## Agent skills

### Issue tracker

Issues vivem no GitHub Issues deste repo (via CLI `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulário padrão das 5 roles canônicas (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` na raiz do repo. See `docs/agents/domain.md`.
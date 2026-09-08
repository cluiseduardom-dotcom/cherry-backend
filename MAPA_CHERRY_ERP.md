# Mapa do Cherry ERP — Backend

Auditoria feita em 2026-08-01, lendo o código-fonte (controllers/services/repositories/rotas/migrations) e rodando a suíte de testes real. Este documento reflete o estado **verificado em código**, não intenção ou documentação anterior — onde não foi possível confirmar algo com certeza, está marcado como "a verificar".

Última atualização: 2026-09-05 — módulo de Produção/Fornecedores completo: Fase B (Compras, migration `012_compras.sql`) e Fase C (Produção própria com ficha técnica, migration `013_producao.sql`) implementadas e mergeadas em `master` (PR `feat/producao`, #12) (ver §3 e §8).

`package.json`: `cherry-backend@2.4.0`.

---

## 1. Migrations (em ordem)

| Arquivo | O que cria/altera |
|---|---|
| `002_produtos_sku.sql` | Adiciona a `produtos`: `sku` (UNIQUE global), `descricao`, `categoria`, `estoque_atual`, `estoque_minimo`, `ativo`. |
| `003_movimentacoes_estoque.sql` | Cria `movimentacoes_estoque` (ledger append-only: `produto_id`, `tipo`, `quantidade`, `estoque_resultante`, `motivo`, `usuario_id`, `criado_em`). |
| `004_precificacao.sql` | Cria `canais_venda` (seed `loja_fisica`/`online`) e `precos_produto` (ledger append-only de preço por canal). |
| `005_vendas_pdv.sql` | Em `vendas`: `cliente_id` vira opcional, adiciona `canal_id`, `usuario_id`, `status` (`aberta`/`finalizada`/`cancelada`). |
| `006_contas_pagar.sql` | Cria `contas_pagar` (lançamento manual, `status` `pendente`/`pago`/`cancelado`). |
| `007_multi_tenant.sql` | Cria `empresas`; adiciona `empresa_id` (NOT NULL + índice) em `usuarios`, `clientes`, `produtos`, `canais_venda`, `precos_produto`, `vendas`, `itens_venda`, `movimentacoes_estoque`, `contas_pagar`. Seed de uma empresa única ("Cherry Semijoias") para migrar dados existentes. |
| `008_canais_venda_unique_por_empresa.sql` | Troca `canais_venda.nome UNIQUE` (global) por `UNIQUE(empresa_id, nome)`. |
| `009_contas_receber.sql` | Adiciona `forma_pagamento` (`a_vista`/`prazo`) a `vendas`; cria `contas_receber` (vínculo automático via `venda_id UNIQUE`, `status` `pendente`/`recebido`/`cancelado`). |
| `010_fornecedores.sql` | Cria `fornecedores` (`empresa_id`, `nome` obrigatório, `contato`/`telefone`/`email`/`cnpj_cpf`/`observacoes` opcionais, `ativo` para soft delete, `criado_em`/`atualizado_em`). |
| `015_custo_congelado_itens_venda.sql` | Adiciona `itens_venda.custo_unitario` (`NUMERIC(10,2) NOT NULL CHECK >= 0`), congelando `produtos.custo` no momento da venda — mesmo padrão de `preco_unitario`. Backfill com o custo atual (seguro por construção nesta base, ver `## Regras já decididas em custo congelado` no CLAUDE.md). |

Tabela incompleta entre `010` e `015`: as migrations `011_ponto_equilibrio.sql`, `012_compras.sql`, `013_producao.sql` e `014_clientes_anonimizacao.sql` já existem no repo mas não foram registradas aqui quando implementadas — não preenchidas nesta tarefa por estar fora do escopo pedido (só a migration `015` foi adicionada). Ver os arquivos em `src/database/migrations/` pra conteúdo exato.

Não existe migration `001_*`: a tabela base (`empresas` já incluída, `usuarios`, `clientes`, `produtos`, `vendas`, `itens_venda`) está apenas em `src/database/schema.sql`, mantido como snapshot consolidado — `schema.sql` já reflete o schema pós-migration 009 (inclui `empresa_id` em tudo).

---

## 2. Rotas por módulo

Todas as rotas (exceto `/auth/login`) passam por `authMiddleware` (token válido obrigatório). "Papel" abaixo é a restrição *além* de estar autenticado.

### Auth (`/auth`)
| Método | Rota | Papel |
|---|---|---|
| POST | `/auth/login` | público |
| POST | `/auth/register` | admin |

### Produtos (`/produtos`)
| Método | Rota | Papel |
|---|---|---|
| GET | `/produtos` | qualquer autenticado |
| POST | `/produtos` | admin |
| GET | `/produtos/mais-vendidos`, `/curva-abc`, `/reposicao`, `/sugestao-preco`, `/giro`, `/parados`, `/pricing`, `/pricing-profissional`, `/lucro`, `/alerta-prejuizo`, `/inteligencia`, `/dashboard`, `/estoque-baixo` | qualquer autenticado (ver §6 — inclui vendedor e estoquista) |
| GET | `/produtos/:id` | qualquer autenticado |
| PUT | `/produtos/:id` | admin |
| DELETE | `/produtos/:id` | admin |
| GET | `/produtos/:id/movimentacoes` | qualquer autenticado |
| POST | `/produtos/:id/movimentacoes` | admin ou estoquista |
| GET | `/produtos/:id/precos` | qualquer autenticado |
| GET | `/produtos/:id/precos/historico` | admin |
| PUT | `/produtos/:id/precos/:canalId` | admin |

### Vendas/PDV (`/vendas`)
| Método | Rota | Papel |
|---|---|---|
| GET | `/vendas/resumo`, `/por-dia`, `/por-mes`, `/mais-vendidos` | qualquer autenticado (ver §6 — inclui estoquista) |
| GET | `/vendas` | admin ou vendedor |
| POST | `/vendas` | admin ou vendedor |
| GET | `/vendas/:id` | admin ou vendedor (vendedor só vê a própria venda — outra dá 404) |
| PATCH | `/vendas/:id/cancelar` | admin |

### Clientes (`/clientes`)
| Método | Rota | Papel |
|---|---|---|
| GET | `/clientes`, `/ranking` | qualquer autenticado |
| POST | `/clientes` | qualquer autenticado |
| GET | `/clientes/:id/total-gasto`, `/:id/historico` | qualquer autenticado |

Não há restrição de papel neste módulo — não é mencionado na tabela de papéis do CLAUDE.md, então não é uma divergência, mas vale registrar que hoje `vendedor` e `estoquista` podem tanto ler quanto criar clientes.

### Canais de venda (`/canais-venda`)
| Método | Rota | Papel |
|---|---|---|
| GET | `/canais-venda` | qualquer autenticado |

Não existe endpoint de criação/edição (confirmado — só é possível inserir canal direto no banco).

### Dashboard analítico (`/dashboard`)
Mount inteiro atrás de `authMiddleware + requireAdmin` em `app.js` — admin-only.

| Método | Rota |
|---|---|
| GET | `/dashboard`, `/curva-abc`, `/giro`, `/cobertura`, `/margem` |

### Financeiro — contas a pagar (`/contas-pagar`)
Mount inteiro atrás de `authMiddleware + requireAdmin` — admin-only.

| Método | Rota |
|---|---|
| GET | `/contas-pagar`, `/:id` |
| POST | `/contas-pagar` |
| PUT | `/contas-pagar/:id` |
| PATCH | `/contas-pagar/:id/pagar` |
| DELETE | `/contas-pagar/:id` (cancela, não apaga linha) |

### Financeiro — contas a receber (`/contas-receber`)
Mount inteiro atrás de `authMiddleware + requireAdmin` — admin-only.

| Método | Rota |
|---|---|
| GET | `/contas-receber`, `/:id` |
| PATCH | `/contas-receber/:id/receber` |

Sem `POST`/`PUT` manual, como já documentado — toda linha nasce de `POST /vendas` com `forma_pagamento: 'prazo'`.

### Fornecedores (`/fornecedores`)
Mount inteiro atrás de `authMiddleware + requireEstoquista` — admin ou estoquista (vendedor recebe 403 em toda rota do módulo, inclusive leitura).

| Método | Rota |
|---|---|
| GET | `/fornecedores` (paginado, filtro opcional `nome`), `/:id` |
| POST | `/fornecedores` |
| PUT | `/fornecedores/:id` |
| DELETE | `/fornecedores/:id` (soft delete via `ativo = false`, não apaga a linha) |

---

## 3. Status real por módulo

| Módulo | Status | Observação |
|---|---|---|
| Auth | **Implementado** | Login com bcrypt+JWT, registro admin-only, middlewares de papel. |
| Produtos/SKUs | **Implementado** | CRUD com soft delete (`ativo`). Ver §6 para uma ressalva de exposição de dado em sub-rotas analíticas. |
| Movimentações de estoque | **Implementado** | Ledger append-only, bloqueio de saída negativa (409, com lock de linha), bloqueio em produto inativo (400). |
| Precificação | **Implementado** | Ledger append-only por canal, nunca `UPDATE`. |
| PDV/vendas | **Implementado** | Preço travado no momento da venda, transação única cobrindo venda+itens+estoque+conta a receber, cancelamento com estorno. |
| Dashboard analítico (`/dashboard`) | **Implementado** | Curva ABC, giro, cobertura, margem — admin-only, como documentado. |
| Financeiro — contas a pagar | **Implementado** | CRUD completo, transições de status com lock de linha, `atrasado` calculado na leitura. **A CLAUDE.md desatualizada dizia isso como pendente — não é: está implementado e testado (87 testes).** |
| Financeiro — contas a receber | **Implementado** | Vínculo automático a vendas a prazo, sem CRUD manual, cancelamento em cascata com a venda respeitando conta já recebida. |
| Produção / Fornecedores | ✅ Completo | Fase A (Fornecedores, migration `010_fornecedores.sql`), Fase B (Compras, migration `012_compras.sql`) e Fase C (Produção própria, migration `013_producao.sql`) implementadas. Fase C entrega: ficha técnica versionada (ledger append-only, uma vigente por produto), produção com cálculo automático de produção parcial quando o estoque de algum insumo não cobre a quantidade solicitada, cancelamento com estorno proporcional ao que foi de fato produzido (não ao solicitado), e RBAC ocultando custo/margem da estoquista em toda resposta do módulo. |

Não existe nenhum módulo do backend hoje totalmente "ausente" no sentido de zero código — todos os módulos descritos no CLAUDE.md, incluindo as três fases de Produção/Fornecedores, têm código, rotas e testes. O que existe são **ressalvas dentro de módulos implementados** (ver §6) e funcionalidades fora do escopo atual (ver §7).

---

## 4. Contagem de testes (suíte rodada em 2026-09-05 — `npm test`, com banco real acessível)

**Total: 824 testes, 66 suítes, todos passando.**

Nota de correção: a contagem anterior deste documento (2026-08-18) mostrava 564 testes, mas não refletia nem o refactor de transação compartilhada (`src/repositories/shared/transacoes.js`, que centralizou testes de lock/rollback antes espalhados pelos repositories), nem os módulos de Compras e Produção mergeados desde então (PR #12). Corrigido nesta atualização.

| Módulo | Arquivos | Testes |
|---|---|---|
| Auth | `middlewares/authMiddleware`, `requireAdmin`, `requireEstoquista`, `routes/auth`, `services/authService`, `validations/authValidation` | 34 |
| Rate limiting (login) | `middlewares/loginRateLimiter`, `routes/authLoginRateLimit` | 4 |
| Produtos | `routes/produtos`, `services/produtosService`, `validations/produtosValidation`, `repositories/produtosRepository` | 113 |
| Estoque | `repositories/estoqueRepository`, `routes/estoque`, `services/estoqueService`, `validations/estoqueValidation` | 32 |
| Precificação (+ canais de venda) | `routes/precos`, `routes/canaisVenda`, `services/precosService`, `validations/precosValidation` | 46 |
| Vendas/PDV | `repositories/vendasRepository`, `routes/vendas`, `services/vendasService`, `validations/vendasValidation` | 82 |
| Clientes | `routes/clientes`, `services/clientesService`, `validations/clientesValidation` | 20 |
| Dashboard | `routes/dashboard`, `services/dashboardService` | 29 |
| Contas a pagar | `repositories/contasPagarRepository`, `routes/contasPagar`, `services/contasPagarService`, `validations/contasPagarValidation` | 89 |
| Contas a receber | `repositories/contasReceberRepository`, `routes/contasReceber`, `services/contasReceberService`, `validations/contasReceberValidation` | 45 |
| Fornecedores | `repositories/fornecedoresRepository`, `routes/fornecedores`, `services/fornecedoresService`, `validations/fornecedoresValidation` | 63 |
| Compras | `repositories/comprasRepository`, `routes/compras`, `services/comprasService`, `validations/comprasValidation` | 69 |
| Produção (fichas técnicas + produções) | `repositories/fichasTecnicasRepository`, `repositories/producoesRepository`, `routes/fichasTecnicas`, `routes/producoes`, `services/fichasTecnicasService`, `services/producoesService`, `validations/fichasTecnicasValidation`, `validations/producoesValidation` | 75 |
| Transação compartilhada (shared) | `repositories/shared/transacoes` | 9 |
| Isolamento multi-tenant (cross-módulo, banco real) | `routes/multiTenantIsolation` | 16 |
| **Não auditados neste mapa** (módulos existentes no código mas fora do escopo de auditoria até agora) | `routes/despesasFixas`, `routes/configuracoesFinanceiras`, `routes/financeiro`, `repositories/despesasFixasRepository`, `repositories/configuracoesFinanceirasRepository`, `repositories/pontoEquilibrioRepository`, `services/despesasFixasService`, `services/configuracoesFinanceirasService`, `services/pontoEquilibrioService`, `validations/despesasFixasValidation`, `validations/configuracoesFinanceirasValidation`, `validations/pontoEquilibrioValidation` | 98 |

(Soma: 34+4+113+32+46+82+20+29+89+45+63+69+75+9+16+98 = 824.)

A última linha (despesas fixas, configurações financeiras, ponto de equilíbrio) existe em código e passa na suíte, mas não foi lida linha a linha nem tem RBAC/isolamento verificados neste documento — mergeada em outra frente de trabalho (`feat/ponto-equilibrio`, `feat/despesas-fixas`) fora do escopo desta atualização. Marcar como "a verificar" se precisar da mesma garantia dada aos módulos acima.

---

## 5. Isolamento multi-tenant (`empresa_id`) por módulo

Todos os repositories foram lidos linha a linha; toda query de leitura/escrita filtra por `empresa_id` (exceto `usuarioRepository.buscarPorEmail`, que é global por design — precisa achar o usuário antes de saber a empresa, no login).

| Módulo | Isolamento por `empresa_id` | Evidência |
|---|---|---|
| Auth | Sim (onde aplicável) | `empresa_id` vem do JWT; `register` cria na empresa do admin logado. |
| Produtos | Sim | Toda query em `produtosRepository` tem `WHERE ... empresa_id = $N`. |
| Estoque | Sim | `estoqueRepository` filtra `empresa_id` inclusive no `SELECT ... FOR UPDATE`. |
| Precificação/canais | Sim | `precosRepository` filtra `empresa_id` em canais, preços vigentes e histórico. |
| Vendas/PDV | Sim | `vendasRepository` filtra em todas as queries, inclusive a validação de `cliente_id`/`produto_id` dentro da transação de criação. |
| Clientes | Sim | `clientesRepository` filtra em todas as queries. |
| Dashboard | Sim | `dashboardRepository` e `precosRepository.listarMargemPorProdutoECanal` filtram `empresa_id`. |
| Contas a pagar | Sim | `contasPagarRepository` filtra em listagem, busca por id e nas transições de status (`FOR UPDATE`). |
| Contas a receber | Sim | `contasReceberRepository` filtra em todas as queries, inclusive `cancelarPorVendaId`. |
| Fornecedores | Sim | `fornecedoresRepository` filtra `empresa_id` em todas as queries (listagem paginada, busca por id, criar, atualizar, soft delete). Confirmado por testes de repository/service/rotas com mock e, adicionalmente, validado manualmente via API contra o banco de dev (login como admin e como estoquista, criação e listagem funcionando; vendedor bloqueado com 403). |
| Compras | Sim | `comprasRepository` filtra `empresa_id` em todas as queries, inclusive a validação de `fornecedor_id`/`produto_id` dentro da transação de criação e no `FOR UPDATE` de `cancelar`. |
| Produção (fichas técnicas + produções) | Sim | `fichasTecnicasRepository` filtra `empresa_id` em toda query (criar versão, buscar vigente, histórico), inclusive na validação de tipo do produto/insumo dentro da transação. `producoesRepository` filtra `empresa_id` em toda query, inclusive no `SELECT ... FOR UPDATE` dos insumos ao registrar produção e no lock de `cancelar`. |

**Teste de isolamento ponta a ponta com banco real** (`tests/routes/multiTenantIsolation.test.js`, 16 testes) cobre: produtos, clientes, vendas, contas a pagar, movimentações de estoque — confirma que a empresa 1 não vê dados da empresa 2 e vice-versa, inclusive em busca por id (404, não 403).

**Não coberto por teste de isolamento ponta a ponta com banco real** (a filtragem foi confirmada lendo o código e por testes unitários com mock, mas não por um teste de integração com duas empresas reais, como existe para os módulos acima): contas a receber, canais de venda, preços/precificação, dashboard, fornecedores, compras, produção. Marcar como "a verificar com teste de integração" se isolamento multi-tenant nesses módulos precisar de garantia mais forte que leitura de código.

---

## 6. Achados — divergências da regra inviolável de papéis

Durante a auditoria de rotas (§2), dois pontos merecem atenção porque o código diverge do que o CLAUDE.md descreve como regra de negócio:

1. ~~**Sub-rotas analíticas de `/produtos` expõem `custo`/`margem`/`lucro` para qualquer papel autenticado.**~~ **Correção (2026-09-08): esta nota estava desatualizada.** Confirmado durante a tarefa de custo congelado (`fix/custo-congelado-itens-venda`) que `produtosController` **já aplica** `filtrarDadosAnaliticos` (que remove `custo`/`custo_total`/`margem_percentual`/`lucro`/`lucro_unitario`) nas 11 funções analíticas (`giro`, `parados`, `pricingProfissional`, `lucroPorProduto`, `alertaPrejuizo`, `maisVendidos`, `curvaABC`, `reposicao`, `sugestaoPreco`, `inteligencia`, `acoes`, `dashboard`) — não só em `listar`/`buscarPorId`. As rotas continuam **sem** `requireAdmin`/`requireEstoquista` (RBAC é por campo, não por rota, mesmo padrão do resto do sistema), mas o campo sensível é de fato removido pra quem não é admin. `tests/routes/produtos.test.js` (bloco "rotas analíticas de /produtos filtram custo/margem/lucro por papel") cobre `vendedor` e `estoquista` recebendo 200 sem os campos sensíveis. Não há vazamento — a nota original estava errada ou a checagem foi feita antes do filtro existir; sem histórico de commit que explique a divergência.
2. **Rotas analíticas de `/vendas` (`/resumo`, `/por-dia`, `/por-mes`, `/mais-vendidos`) são acessíveis a `estoquista`.** Estão montadas só atrás de `authMiddleware`, sem `requireVendedor`/`requireAdmin`. Não expõem `custo`/`margem` (confirmado em `vendasRepository`), mas contradizem a regra "estoquista não acessa vendas nem financeiro".

Nenhum código foi alterado nesta tarefa (auditoria/documentação apenas) — os dois pontos acima ficam registrados para decisão do usuário sobre como corrigir (aplicar `filtrarParaRole`/restringir rota, ou decisão de negócio de liberar esse dado mesmo).

---

## 7. O que de fato ainda não existe no backend

- Endpoint para criar/editar `empresas` — toda empresa usada em teste ou onboarding real precisa ser inserida direto no banco.
- Endpoint para criar/editar `canais_venda` — os dois canais padrão (`loja_fisica`, `online`) só existem via seed/migration; não há rota de escrita.
- CRUD manual de `contas_receber` — por design, toda linha nasce de uma venda a prazo; não existe (e não foi pedido) um jeito de lançar conta a receber manualmente, nem cancelamento manual fora do cancelamento da venda (ex: perdão de dívida).
- Qualquer job/cron agendado — o campo `atrasado` (contas a pagar e a receber) é sempre calculado na leitura porque não existe infraestrutura de job agendado no projeto.
- UNIQUE por empresa em `usuarios.email` e `produtos.sku` — continuam únicos globalmente entre empresas (decisão pendente de confirmação, não implementado).
- Nome/CNPJ reais da empresa seed — ainda usa o placeholder "Cherry Semijoias" com `cnpj` NULL.
- Qualquer autenticação/fluxo de "esqueci minha senha", refresh token, ou revogação de token antes de expirar (JWT de 8h é o único mecanismo).
- Testes de integração com banco real para isolamento multi-tenant de contas a receber, canais de venda, preços, dashboard, fornecedores, compras e produção (ver §5).

---

## 8. Decisões de arquitetura e negócio já tomadas (Fornecedores/Compras/Produção)

- **Fornecedores:** RBAC libera admin e estoquista; vendedor sem acesso (mesmo padrão de 403 usado em outras rotas restritas).
- **Nomenclatura de timestamp em tabelas novas** segue `criado_em`/`atualizado_em` (português), consistente com `contas_pagar`/`contas_receber` — não `created_at`/`updated_at`.
- **Compras** (implementado, migration `012_compras.sql`, RBAC admin+estoquista): entrada direta simples (uma compra = uma movimentação de estoque imediata), com campo `status` desde o schema inicial (default `'recebido'`, aceita também `'pendente'`/`'cancelado'`) — decisão tomada antes da implementação pra permitir evoluir pra fluxo de pedido formal (`pendente`→`recebido`) sem reescrever a tabela depois; não usado ainda (toda compra hoje já nasce `'recebido'`).
- **Produção própria — decisões de schema da Fase C** (implementado, migration `013_producao.sql`, RBAC admin+estoquista via `requireEstoquista`, vendedor recebe 403 em toda rota):
  - **Insumo é um `produto` com `tipo = 'insumo'`, não uma tabela separada.** `produtos` ganhou a coluna `tipo` (`'acabado'` | `'insumo'`, default `'acabado'`). Insumo e produto acabado compartilham todo o resto do schema (`estoque_atual`, `preco_custo`, soft delete via `ativo`, `empresa_id`) — uma tabela `insumos` separada duplicaria esse controle de estoque inteiro. Trade-off aceito: nada hoje impede cadastrar um insumo com preço de venda/canal (`precos_produto`) ou usar um produto acabado como insumo de outro; não há constraint bloqueando isso.
  - **Ficha técnica é versionada, ledger append-only — mas não é o mesmo mecanismo de `precos_produto`.** Nunca `UPDATE` numa ficha: uma nova versão é sempre um `INSERT` (`fichas_tecnicas`), com a versão anterior marcada `vigente = false` na mesma transação. Diferença de `precos_produto` (que resolve "preço atual" só por `criado_em` mais recente, sem flag): aqui existe um índice único parcial (`vigente = true` por `empresa_id + produto_id`) que torna "a ficha vigente" uma consulta direta e impõe explicitamente que só pode haver uma vigente por produto — mecanismo mais explícito, não uma repetição do de preços.
  - **Produção parcial é calculada automaticamente, não rejeitada.** Ao registrar uma produção, cada insumo da ficha limita `quantidade_produzida` a `floor(estoque_atual do insumo / quantidade_necessária)`; vence o mínimo entre todos os insumos e a `quantidade_solicitada`. Zero unidades produzíveis bloqueia com 409 sem criar nada; produção parcial (`quantidade_produzida < quantidade_solicitada`) é aceita e sinalizada (`parcial: true` na resposta), consumindo estoque só na proporção do que foi de fato produzido.
  - **Cancelamento estorna proporcional ao produzido, não ao solicitado.** `PATCH /producoes/:id/cancelar` dá saída do produto acabado (bloqueia 409 se já foi vendido/consumido, sem tocar nos insumos) e devolve ao estoque cada insumo na quantidade que realmente saiu (`quantidade_necessaria × quantidade_produzida`) — nunca a quantidade solicitada original.
  - **`custo_sugerido` (ficha técnica) e `custo_total` (produção) são calculados na leitura, nunca gravados.** Somam `quantidade × preco_custo` de cada insumo no momento da consulta; **não sobrescrevem `produtos.preco_custo`** do produto acabado — ajustar o custo de venda do acabado com base no custo sugerido continua sendo uma decisão manual do usuário, mesmo espírito de `atrasado` calculado na leitura em contas a pagar/receber.
  - **RBAC de custo é decisão de negócio (não uma extensão da regra inviolável)**: a regra inviolável do CLAUDE.md protege `vendedor`, que nem acessa este módulo (403 via `requireEstoquista`). Aqui quem perde `custo_sugerido`/`custo_total`/`custo_unitario`/`subtotal_custo` é a `estoquista` (`fichasTecnicasController.filtrarCustoParaRole` e `producoesController.filtrarCustoParaRole`, mesmo padrão de `produtosController.filtrarParaRole`) — decisão nova, consistente com o espírito da regra mas não idêntica a ela.
  - **Quantidades são `INTEGER`, não `NUMERIC`** — `quantidade_necessaria` (ficha técnica) segue o mesmo tipo de `produtos.estoque_atual`/`movimentacoes_estoque.quantidade`; suportar consumo fracionário de insumo (ex: 0.5g de prata) exigiria repensar o ledger de estoque inteiro, fora do escopo desta fase.
- **Custo congelado em `itens_venda`** (migration `015_custo_congelado_itens_venda.sql`, branch `fix/custo-congelado-itens-venda`): `custo_unitario` congela `produtos.custo` no momento da venda, capturado no mesmo `SELECT ... FOR UPDATE` que já trava o produto pra validar/baixar estoque (`estoqueRepository.criarMovimentacao` agora devolve `custo`) — não uma query separada, pra não abrir janela de inconsistência. Ver `## Regras já decididas em custo congelado` no `CLAUDE.md` pra a distinção completa entre margem prospectiva e histórica.
  - **Classificação de todo uso de `p.custo`/`produtos.custo` no backend, feita nesta tarefa:**
    | Função | Fonte de custo | Por quê |
    |---|---|---|
    | `pontoEquilibrioRepository.somarCustoVariavelProdutos` | convertido → `iv.custo_unitario` | margem histórica (vendas já fechadas) |
    | `produtosRepository.getLucroPorProduto` (`GET /produtos/lucro`) | convertido → `iv.custo_unitario` | margem histórica; `faturamento` continua com `p.preco_venda` (pendência separada, ver CLAUDE.md) |
    | `precosRepository.listarMargemPorProdutoECanal` (`GET /dashboard/margem`) | mantido `produtos.custo` | margem prospectiva — não junta `itens_venda`, é custo×preço vigente pra todo produto×canal ativo, existindo venda ou não |
    | `produtosRepository.getPricingProfissional`, `getSugestaoPreco`, `getInteligencia` | mantido `produtos.custo` | sugestão de preço futuro a partir do custo atual, não análise de venda fechada |
    | `produtosRepository.getAlertaPrejuizo` | mantido `produtos.custo` | alerta prospectivo (preço vigente < custo vigente *hoje*), sem join a `itens_venda` — congelar cegaria o alerta |
    | `produtosService.comMargem`, CRUD de produtos, `produtosRepository.ajustarPreco`, `precosService.calcularPreco`, ficha técnica/produção | mantido `produtos.custo` | CRUD/precificação de produto, não histórico de venda |
  - **`GET /produtos/pricing`, `/pricing-profissional`, `/lucro`, `/alerta-prejuizo`, `/inteligencia`, `/sugestao-preco` não têm `requireAdmin`** — confirmado que não é vazamento (RBAC por campo via `filtrarDadosAnaliticos`, já existia antes desta tarefa); corrigida a nota desatualizada em §6.
  - **`getAcoes`/`produtosService.acoes`** existe mas não tem rota montada em `routes/produtos.js` — função morta, não removida (fora do escopo desta tarefa), candidata a limpeza numa branch própria.
  - **Débito de UI não corrigido**: o rótulo "Margem" no Dashboard do `cherry-frontend` não indica que é prospectiva — fica pra ajuste de UI em branch separado.
- **Rate limiting em `POST /auth/login`** (item 6 do roteiro de profissionalização): 5 tentativas por 15 minutos, chave padrão da lib (`express-rate-limit`) = **IP**, não conta/email. Limitação conhecida e aceita: um ataque de força bruta distribuído por vários IPs diferentes mirando a mesma conta não é pego por esse limite. Rate limit por conta/email ficou fora do escopo por decisão consciente, não esquecimento. Em `NODE_ENV=test` o limite sobe pra 1000 (efetivamente desabilitado) pra não quebrar a suíte, que faz login repetidamente — ver `src/middlewares/loginRateLimiter.js`.

---

## 11. Roteiro de profissionalização (GiroOne) — status

Decisão tomada: o Cherry ERP vai virar produto vendável a outras empresas (GiroOne), não só uso interno. Isso motivou a priorização abaixo antes de continuar com módulos de negócio (Relatórios, Produção/Fornecedores).

| # | Item | Status |
|---|---|---|
| 1 | Multi-tenancy | ✅ Completo e validado |
| 2 | Ambiente de staging | ❌ Não iniciado — banco de teste dedicado no Neon (`ci-test`) já existe e pode servir de base |
| 3 | CI (GitHub Actions) | ✅ Completo — branch protection em `master` exigindo check "build" |
| 4 | Observabilidade (logs, alerta de uptime) | ❌ Não iniciado |
| 5 | Backup/DR confirmado | ✅ Completo e confirmado — ver 11.3 |
| 6 | Rate limiting no login | ✅ Completo |
| 7 | LGPD documentado | ❌ Não iniciado |

Com Produção/Fornecedores completo (as três fases — ver §3 e §8), os módulos de negócio planejados nesta fase do produto estão fechados. Restam dois fronts abertos no roteiro de profissionalização: **(a) finalização do staging** (item 2 — Git branch dedicada + configuração do serviço correspondente no Render, além do `ci-test` já existente no Neon) e **(b) observabilidade/LGPD** (itens 4 e 7).

### 11.3. Detalhe do item 5 (Backup/DR) — confirmação

**Mecanismo:** Point-in-Time Recovery (PITR) do Neon via branch — não é backup tradicional, é a capacidade de criar um branch novo a partir de um timestamp passado do branch de produção, sem risco (nunca sobrescreve o original).

**Teste realizado em 03/09/2026:**
- Confirmado em "Postgres settings" (nível de projeto, não por branch): **History retention = 6 horas** (`history_retention_seconds: 21600`). Vale para todos os branches, incluindo `production` — é limite do plano gratuito, não decisão do projeto.
- Criado branch `teste-restore-dr-v2` a partir de `production` (`br-ancient-sea-achht904`), restaurando de um ponto específico no passado (não do estado atual/"Head") — ponto de restauração: `2026-09-03T00:52:31Z`.
- Validado com `SELECT COUNT(*) FROM produtos;` no branch restaurado: **9 produtos**, batendo com o esperado.
- Branch de teste tinha auto-delete configurado (~24h) — não precisa limpeza manual.

**Limitação conhecida:** janela de recuperação é de apenas 6 horas (plano gratuito) — não serve como backup de longo prazo (ex: recuperar de 3 dias atrás não é possível). Se isso virar um requisito real (ex: cliente pagante exigindo retenção maior), é upgrade de plano no Neon, não mudança de arquitetura.

**Decisão registrada:** mecanismo funciona e está confirmado; trade-off aceito (retenção curta em troca de custo zero) enquanto o produto não tem clientes pagantes.

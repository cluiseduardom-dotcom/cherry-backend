# Mapa do Cherry ERP — Backend

Auditoria feita em 2026-08-01, lendo o código-fonte (controllers/services/repositories/rotas/migrations) e rodando a suíte de testes real. Este documento reflete o estado **verificado em código**, não intenção ou documentação anterior — onde não foi possível confirmar algo com certeza, está marcado como "a verificar".

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

Não existe nenhum módulo do backend hoje classificável como "ausente" — todos os módulos descritos no CLAUDE.md têm código, rotas e testes. O que existe são **ressalvas dentro de módulos implementados** (ver §6) e funcionalidades fora do escopo atual (ver §7).

---

## 4. Contagem de testes (suíte rodada em 2026-08-01 — `npm test`)

**Total: 453 testes, 35 suítes, todos passando.**

| Módulo | Arquivos | Testes |
|---|---|---|
| Auth | `middlewares/authMiddleware`, `requireAdmin`, `requireEstoquista`, `routes/auth`, `services/authService`, `validations/authValidation` | 34 |
| Produtos | `routes/produtos`, `services/produtosService`, `validations/produtosValidation` | 71 |
| Estoque | `repositories/estoqueRepository`, `routes/estoque`, `services/estoqueService`, `validations/estoqueValidation` | 32 |
| Precificação (+ canais de venda) | `routes/precos`, `routes/canaisVenda`, `services/precosService`, `validations/precosValidation` | 46 |
| Vendas/PDV | `repositories/vendasRepository`, `routes/vendas`, `services/vendasService`, `validations/vendasValidation` | 70 |
| Clientes | `routes/clientes`, `services/clientesService`, `validations/clientesValidation` | 20 |
| Dashboard | `routes/dashboard`, `services/dashboardService` | 29 |
| Contas a pagar | `repositories/contasPagarRepository`, `routes/contasPagar`, `services/contasPagarService`, `validations/contasPagarValidation` | 87 |
| Contas a receber | `repositories/contasReceberRepository`, `routes/contasReceber`, `services/contasReceberService`, `validations/contasReceberValidation` | 48 |
| Isolamento multi-tenant (cross-módulo, banco real) | `routes/multiTenantIsolation` | 16 |

(Soma: 34+71+32+46+70+20+29+87+48+16 = 453.)

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

**Teste de isolamento ponta a ponta com banco real** (`tests/routes/multiTenantIsolation.test.js`, 16 testes) cobre: produtos, clientes, vendas, contas a pagar, movimentações de estoque — confirma que a empresa 1 não vê dados da empresa 2 e vice-versa, inclusive em busca por id (404, não 403).

**Não coberto por teste de isolamento ponta a ponta com banco real** (a filtragem foi confirmada lendo o código e por testes unitários com mock, mas não por um teste de integração com duas empresas reais, como existe para os módulos acima): contas a receber, canais de venda, preços/precificação, dashboard. Marcar como "a verificar com teste de integração" se isolamento multi-tenant nesses módulos precisar de garantia mais forte que leitura de código.

---

## 6. Achados — divergências da regra inviolável de papéis

Durante a auditoria de rotas (§2), dois pontos merecem atenção porque o código diverge do que o CLAUDE.md descreve como regra de negócio:

1. **Sub-rotas analíticas de `/produtos` expõem `custo`/`margem`/`lucro` para qualquer papel autenticado.** As rotas `/produtos/pricing`, `/pricing-profissional`, `/lucro`, `/alerta-prejuizo`, `/sugestao-preco` e `/inteligencia` estão montadas em `app.js` só atrás de `authMiddleware` (sem `requireAdmin`), e `produtosController` só aplica o filtro `filtrarParaRole` (que remove `custo`/`margem_percentual`) nas funções `listar` e `buscarPorId` — as 11 funções analíticas (`giro`, `parados`, `pricingProfissional`, `lucroPorProduto`, `alertaPrejuizo`, `maisVendidos`, `curvaABC`, `reposicao`, `sugestaoPreco`, `inteligencia`, `acoes`, `dashboard`) devolvem o resultado cru do repository sem nenhum filtro. Confirmado lendo `produtosRepository.js`: `getPricingProfissional`, `getLucroPorProduto`, `getAlertaPrejuizo` e `getSugestaoPreco` retornam `custo`, `margem_percentual` e/ou `lucro` diretamente. Os testes existentes (`tests/routes/produtos.test.js`, bloco "read-only sub-routes") só chamam essas rotas com token de admin — não há teste que confirme bloqueio ou filtragem para `vendedor`/`estoquista`, e o código de fato não bloqueia nem filtra. Isso contradiz a regra inviolável do CLAUDE.md ("vendedor NUNCA vê preco_custo nem margem, em nenhum endpoint").
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
- Testes de integração com banco real para isolamento multi-tenant de contas a receber, canais de venda, preços e dashboard (ver §5).

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Cadastro completo de usuário (migration `057`): `usuarios_dados` (1:1, `empresa_id`, FKs compostas) guarda telefone (obrigatório), CPF (válido, único por empresa), data de nascimento, endereço, data de admissão e observações. `POST /usuarios` passa a exigir `telefone` e aceita os demais; novos `GET /usuarios/:id` (único que devolve CPF) e `PATCH /usuarios/:id/dados` (mesma hierarquia do bloqueio; o próprio usuário edita os seus). `GET /usuarios` traz `telefone`, nunca CPF. `usuarios_eventos` ganha a ação `editar` e a coluna `campos` (só nomes dos campos alterados, sem valores). Contrato em `docs/USUARIOS_API.md`.
- Usuário bloqueado nas telas de comissão: `GET /comissoes/percentuais` lista só usuários ativos; `GET /comissoes/equipe` passa a trazer `ativo` por linha e só mantém usuário bloqueado se ele tiver comissão no período (o histórico não some).
- `GET /usuarios/cargos` (capacidade `gerir_usuarios`): cargos que o ator pode atribuir ao criar usuário (ativos na empresa, nunca Admin, só de nível menor que o do ator), para a tela não oferecer cargo que o `POST /usuarios` recusaria com 409/403.
- Blindagem das tabelas de comissão (migration corretiva `056`, sem alterar a `054`): `comissoes_eventos` passa a ser imutável no banco (trigger recusa UPDATE/DELETE; exceção só para a limpeza de empresas de teste) e as referências de `comissoes_venda`, `comissoes_eventos` e `comissao_repasses` a vendas, usuários, pagamentos e repasses viram FKs compostas `(id, empresa_id)`, então o banco recusa linha de uma empresa apontando para dado de outra. As FKs entram `NOT VALID` e tentam validar o legado; se houver linha antiga inconsistente, emite WARNING em vez de derrubar o deploy. `comissao_repasses` segue mutável (o status muda).
- Gestão de usuários delegada: nova capacidade `gerir_usuarios` (padrão em diretor, gerente, coordenador e supervisor; o Admin ajusta por cargo) e rotas `GET/POST /usuarios`, `PATCH /usuarios/:id/bloqueio` e `GET /usuarios/eventos`. Só atua sobre cargos de nível estritamente menor que o do ator, nunca sobre Admin nem sobre si mesmo; bloquear sobe `token_version` (derruba as sessões) e exige motivo; criar e bloquear/desbloquear gravam evento na tabela insert-only `usuarios_eventos` (migration `055`) na mesma transação. Sem exclusão e sem reset de senha por esta via. Contrato em `docs/USUARIOS_API.md`.
- Comissão de vendedor: migration `054` cria `comissao_percentuais` (percentual por vendedor, com padrão da empresa; o percentual próprio, inclusive 0, prevalece; o padrão não vale para o cargo admin), `comissoes_venda` (uma linha por venda, congelando percentual, base e valor; mesmo padrão de `taxas_venda`), `comissoes_eventos` (histórico insert-only) e `comissao_repasses` (dinheiro recebido pelo vendedor). A comissão é apurada `pendente` na transação de `POST /vendas`, sobre subtotal − desconto (sem juros do crediário), e **liberada conforme o pagamento**: proporcional a cada parcela recebida (arredondando para baixo, sem resto no total), na hora para pix/débito, reduzida por estorno de pagamento e estornada (nunca apagada) em `PATCH /vendas/:id/cancelar`. Dinheiro do vendedor vira repasse `a_repassar` e só libera quando outra pessoa com `ver_vendas_de_todos` confirma (`POST /comissoes/repasses/:id/confirmar`; autoconfirmação bloqueada na regra e por CHECK). Novas rotas: `GET /comissoes/minhas` (vendedor/admin, só o usuário do JWT), `GET /comissoes/equipe` (`ver_vendas_de_todos`), `GET /comissoes/repasses`, `GET /comissoes/:id/historico` e `GET`/`PUT /comissoes/percentuais` (só admin). Vendas anteriores à migration não têm comissão (sem backfill). Contrato em `docs/COMISSOES_API.md`.
- Módulos habilitáveis por empresa, fatia 1 do ADR-007: migration `053` cria `empresa_modulos` (catálogo fechado `grade`, `fracionario`, `rastreio_unidade`, `fiscal`, `multi_pdv`, `servicos_agenda`; justificativa e responsável obrigatórios; um registro por empresa e módulo), com `src/constants/modulos.js`, `moduloRepository` e o middleware `exigirModulo(modulo)` (403 fail-closed, empresa sempre do JWT). Ainda não é aplicado a nenhuma rota e não há rota de escrita: ativação virá nas próximas fatias.
- Identidade visual por empresa (cherry-frontend#63): migration `049` adiciona `empresas.tema_visual` (`vertumno` padrão, `cherry`; `CHECK` fechado) e `POST /auth/login` passa a devolver `usuario.empresa = { id, tema }`, lido do banco para a empresa do próprio usuário. Aditivo: o JWT e os campos existentes não mudam; tema ausente/inválido vira `vertumno`.
- Jest + Supertest test suite (validations, middlewares, services, and routes), with the database mocked at the repository boundary so tests run without a live DB or secrets. `npm test` / `npm run test:coverage`, wired into CI.
- Produtos/SKU module: `sku`, `descricao`, `categoria`, `estoque_atual`, `estoque_minimo`, `ativo` fields on `produtos`; `GET /produtos` now paginates; new `GET /produtos/:id`; `PUT /produtos/:id` and `DELETE /produtos/:id` (soft delete via `ativo`), both admin-only.
- Stock movements module: `movimentacoes_estoque` ledger table; `POST /produtos/:id/movimentacoes` (`entrada`/`saida`/`ajuste`, admin or estoquista only); `GET /produtos/:id/movimentacoes` history; `GET /produtos/estoque-baixo` low-stock alert. Stock changes are transactional with row locking, and `saida` is rejected with 409 if it would go negative.
- Precificação module: `canais_venda` reference table (seeded with `loja_fisica` and `online`) and `precos_produto`, an append-only ledger — changing a price inserts a new row, never an `UPDATE`. `PUT /produtos/:id/precos/:canalId` (admin only) sets the price from either `markup_percentual` or `preco_venda`; the other value, plus `margem_percentual`, is always derived server-side from `custo` (a client-supplied `margem_percentual` is rejected). Blocked with 409 if the resulting price would fall below `custo`. `GET /produtos/:id/precos` returns the current price per canal (vendedor sees only `preco_venda`, never markup/margem); `GET /produtos/:id/precos/historico` (admin only) is the paginated history, with an optional canal filter. `GET /canais-venda` lists sales channels, open to all authenticated roles.
- PDV/vendas module: `vendas` now has `canal_id`, `usuario_id`, and `status` (`aberta`/`finalizada`/`cancelada`); `cliente_id` is optional. `POST /vendas` (admin or vendedor) prices each item from the current preço vigente in `precos_produto` for the given canal — never from client input — locked in at creation time, and generates a `saida` stock movement per item; the whole venda (itens, pricing, and every stock movement) runs in one transaction, so an inactive produto, a missing price, or insufficient stock rolls back the entire sale, not just the failing item. `GET /vendas` and `GET /vendas/:id` (admin or vendedor) show everything to admin, only the vendedor's own vendas to vendedor (a vendedor requesting someone else's venda gets 404, not 403); estoquista is denied (403). `PATCH /vendas/:id/cancelar` (admin only) cancels a `finalizada` venda and reverses stock item by item (`entrada`, motivo `cancelamento_venda`); only `finalizada` vendas can be cancelled (409 otherwise).
- Multi-tenant foundation: new `empresas` table (`id`, `nome`, `cnpj`, `status`, `criado_em`); every business table (`usuarios`, `clientes`, `produtos`, `canais_venda`, `precos_produto`, `vendas`, `itens_venda`, `movimentacoes_estoque`, `contas_pagar`) gained a NOT NULL, indexed `empresa_id` foreign key. Existing rows were backfilled into a single seed empresa ("Cherry Semijoias", a placeholder pending the real name/CNPJ). Migration `007_multi_tenant.sql`.

### Changed

- Every controller/service/repository now scopes reads and writes by `empresa_id`, sourced only from the authenticated user's JWT (never from request body/query). `empresa_id` is included in the JWT payload at login and exposed as `req.usuario.empresa_id`. `POST /auth/register` creates the new usuario in the same empresa as the admin making the request — there's no way to pick an empresa via the request body. Cross-tenant references (e.g. a `cliente_id` or `produto_id` belonging to a different empresa) are rejected with 404, not 403, to avoid confirming the referenced record's existence — same pattern already used for a vendedor requesting another vendedor's venda.
- `margem_percentual` is now computed at read time for each produto (not stored).
- `custo` and `margem_percentual` are stripped from all produto responses when the authenticated user has role `vendedor`.
- `estoque_atual` was removed from `PUT /produtos/:id`'s editable fields — it can now only change through an audited stock movement, not a direct catalog edit.
- `GET /produtos` and `GET /produtos/:id` now include `preco_canal`, the current price for the sales channel given by `?canal=` (defaults to `loja_fisica`), filtered by role the same way as the rest of the produto object.
- `estoqueRepository.criarMovimentacao` accepts an optional external DB client so callers (like venda creation) can fold a stock movement into their own transaction instead of it managing its own; unchanged when called without one.
- Split `src/app.js` (Express app) from a new `src/server.js` (`app.listen` bootstrap) so the app can be imported by tests without binding to a port.

### Fixed

- `npm ci` was failing in CI (`Missing: @emnapi/core@1.11.3 from lock file`) on every push since the 2.4.0 version bump — a stale `package-lock.json` whose optional platform-dependency tree (via `jest` → `jest-resolve` → `unrs-resolver`) wasn't fully resolved for the npm version used by `actions/setup-node`. Regenerated the lockfile from scratch.

## [2.3.0] - 2026-07-20

### Fixed

- `POST /clientes` returned Zod's default English message instead of a Portuguese one when `telefone` or `email` had the wrong type.

## [2.2.0] - 2026-07-20

### Added

- Admin-only `POST /auth/register` endpoint for creating new users, with bcrypt password hashing, duplicate email rejection, and role validation.

### Changed

- **Breaking:** Standardized `produtos`, `vendas`, and `clientes` routes on the same `controller -> service -> repository` pattern as `auth`, with Zod validation and the `{ success, data }` / `{ success, message }` response shape. Previously these routes returned raw arrays/objects or ad-hoc `{ error }` / `{ message }` payloads.
- `POST /vendas` now wraps the venda + itens insert in a DB transaction, so a failed item insert no longer leaves an orphaned venda row.

### Removed

- Unused dead code: `getRankingClientes` (clientesService) and `getInteligenciaSQL` (produtosService).

## [2.1.0] - 2026-07-19

### Fixed

- Moderate-severity `qs` DoS vulnerability (GHSA-q8mj-m7cp-5q26) via `npm audit fix`.

## [2.0.0] - 2026-07-19

### Added

- Initial Cherry ERP backend: Express API with auth, produtos, vendas, and clientes routes, PostgreSQL integration, and JWT-based authentication.
- `SECURITY.md` with vulnerability reporting instructions.
- `CODE_OF_CONDUCT.md`.
- `CODEOWNERS`.
- `CONTRIBUTING.md`.
- CI workflow (`.github/workflows/ci.yml`) running `npm ci` and a syntax check on push/PR to `master`.
- `LICENSE` (proprietary, all rights reserved).
- `README.md` with setup instructions and route overview.
- Branch protection on `master` requiring the CI check to pass.
- Link to `CODE_OF_CONDUCT.md` in the README.
- `CONTRIBUTORS.md`.

### Changed

- Bumped `actions/checkout` and `actions/setup-node` to v5 in the CI workflow.

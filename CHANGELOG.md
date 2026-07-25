# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Jest + Supertest test suite (validations, middlewares, services, and routes), with the database mocked at the repository boundary so tests run without a live DB or secrets. `npm test` / `npm run test:coverage`, wired into CI.
- Produtos/SKU module: `sku`, `descricao`, `categoria`, `estoque_atual`, `estoque_minimo`, `ativo` fields on `produtos`; `GET /produtos` now paginates; new `GET /produtos/:id`; `PUT /produtos/:id` and `DELETE /produtos/:id` (soft delete via `ativo`), both admin-only.
- Stock movements module: `movimentacoes_estoque` ledger table; `POST /produtos/:id/movimentacoes` (`entrada`/`saida`/`ajuste`, admin or estoquista only); `GET /produtos/:id/movimentacoes` history; `GET /produtos/estoque-baixo` low-stock alert. Stock changes are transactional with row locking, and `saida` is rejected with 409 if it would go negative.
- Precificação module: `canais_venda` reference table (seeded with `loja_fisica` and `online`) and `precos_produto`, an append-only ledger — changing a price inserts a new row, never an `UPDATE`. `PUT /produtos/:id/precos/:canalId` (admin only) sets the price from either `markup_percentual` or `preco_venda`; the other value, plus `margem_percentual`, is always derived server-side from `custo` (a client-supplied `margem_percentual` is rejected). Blocked with 409 if the resulting price would fall below `custo`. `GET /produtos/:id/precos` returns the current price per canal (vendedor sees only `preco_venda`, never markup/margem); `GET /produtos/:id/precos/historico` (admin only) is the paginated history, with an optional canal filter. `GET /canais-venda` lists sales channels, open to all authenticated roles.

### Changed

- `margem_percentual` is now computed at read time for each produto (not stored).
- `custo` and `margem_percentual` are stripped from all produto responses when the authenticated user has role `vendedor`.
- `estoque_atual` was removed from `PUT /produtos/:id`'s editable fields — it can now only change through an audited stock movement, not a direct catalog edit.
- `GET /produtos` and `GET /produtos/:id` now include `preco_canal`, the current price for the sales channel given by `?canal=` (defaults to `loja_fisica`), filtered by role the same way as the rest of the produto object.
- Split `src/app.js` (Express app) from a new `src/server.js` (`app.listen` bootstrap) so the app can be imported by tests without binding to a port.

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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Admin-only `POST /auth/register` endpoint for creating new users, with bcrypt password hashing, duplicate email rejection, and role validation.

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

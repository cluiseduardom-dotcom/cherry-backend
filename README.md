# Cherry Backend

[![CI](https://github.com/cluiseduardom-dotcom/cherry-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/cluiseduardom-dotcom/cherry-backend/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cluiseduardom-dotcom/cherry-backend)](https://github.com/cluiseduardom-dotcom/cherry-backend/releases/latest)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey)](LICENSE)
[![Node](https://img.shields.io/badge/node-20-brightgreen)](.github/workflows/ci.yml)

Cherry ERP Backend — a REST API built with Express and PostgreSQL.

## Requirements

- Node.js
- PostgreSQL database

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root with:
   ```
   DATABASE_URL=postgresql://user:password@host:port/database
   JWT_SECRET=your-secret-key
   NODE_ENV=development
   CORS_ORIGINS=http://localhost:5173
   ```
3. Run the app:
   ```bash
   npm run dev   # development, with nodemon
   npm start     # production
   ```

The server listens on port 3000 by default.

### CORS

Set `CORS_ORIGINS` as a comma-separated list of browser origins allowed to call the API (for example `https://app.exemplo.com,http://localhost:5173`). In production, browser origins not listed there are rejected. Requests without an `Origin` header (health checks, curl, server-to-server) remain allowed.

## Testing

```bash
npm test                  # unit tests: no database, the .env is never read
npm run test:coverage     # unit tests with coverage
npm run test:integration  # integration tests: require TEST_DATABASE_URL (isolated test database)
```

Unit tests use Jest and Supertest with the database layer mocked at the repository boundary — no live database or `.env` is required (a stub replaces `dotenv` and the connection is pointed at a refusing address).

Integration tests (`*.integration.test.js`) write to a real database, so they only run against an **isolated test database** passed explicitly in `TEST_DATABASE_URL`. They abort before opening any connection if the variable is missing or points at a shared development/production database. See [docs/TESTES.md](docs/TESTES.md).

## Routes

- `/auth` — authentication
- `/produtos` — products (requires auth)
- `/vendas` — sales (requires auth)
- `/clientes` — customers (requires auth)

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

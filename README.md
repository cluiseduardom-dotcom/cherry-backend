# Cherry Backend

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
   ```
3. Run the app:
   ```bash
   npm run dev   # development, with nodemon
   npm start     # production
   ```

The server listens on port 3000 by default.

## Routes

- `/auth` — authentication
- `/produtos` — products (requires auth)
- `/vendas` — sales (requires auth)
- `/clientes` — customers (requires auth)

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

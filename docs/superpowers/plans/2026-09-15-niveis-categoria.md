# Rótulos de nível de categoria (`niveis_categoria`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each empresa name what each `categorias_produto.nivel` integer means (e.g. Cherry: 1=família, 2=material, 3=gênero), via a new `niveis_categoria` table and a `/niveis-categoria` CRUD cluster, without touching SKU generation or category creation in any way.

**Architecture:** New cluster (repository/service/controller/validation/routes) mirroring the existing `categorias` cluster byte-for-byte in style. `niveis_categoria` is a **standalone table, no FK to `categorias_produto`** — see Global Constraints for why. It is purely a display lookup: `nivel` (int) → `nome` (label) per empresa.

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`), Zod validation, Jest + Supertest.

**Spec:** This plan implements the task brief given directly by the user (no separate spec file) — reproduced in full in the "Original request" section at the end of this plan. It also depends on, and must not reopen, the 9 closed decisions in `docs/superpowers/specs/2026-09-12-categorias-sku-design.md`.

## Global Constraints

- Multi-tenant: every query filters by `empresa_id` from `req.usuario.empresa_id` (never body/query). Read-by-id filters `id AND empresa_id` in the same query (project-wide rule, `CLAUDE.md`).
- Access: `/niveis-categoria` mounted behind `authMiddleware` + `requireEstoquista` (admin+estoquista; vendedor → 403), exactly like `/categorias`.
- **Decision (this plan, not previously settled): `niveis_categoria` and `categorias_produto.nivel` stay independent — no FK.** A category can be created at any nivel today without a pre-registered label; adding a FK would force registering a label before creating a category, a behavior change that could break existing data/flows (a company could already have categories at levels 1-3 with zero rows in a not-yet-created `niveis_categoria` table). Renaming or deleting a label must never affect `categorias_produto` rows or SKU generation. Document this choice in the migration comment and in CLAUDE.md.
- **Nothing in this task touches `skuService`, `sequenciasSkuRepository`, `categoriasRepository`, or SKU composition.** The label is pure display. If any diff touches those files, it's wrong — back out.
- Renaming a nivel's label must never invalidate or regenerate any existing SKU (SKU is immutable — decision 4 of the categorias-sku spec).
- `GET /categorias` and SKU generation must keep working for an empresa with zero rows in `niveis_categoria` — this is the default state for every empresa today, not an edge case.
- No soft delete on `niveis_categoria` (unlike `categorias_produto`) — a label either exists or is renamed; `DELETE` removes the row outright (no cascade to `categorias_produto`, which doesn't reference it).
- Follow `criado_em`/`atualizado_em` naming convention (not `created_at`/`updated_at`).
- Do not run `npm test` more than once per task's completion check — run the full suite once at the very end (per this project's testing convention).

---

## File Structure

New files (mirroring the `categorias` cluster exactly):

- `src/database/migrations/020_niveis_categoria.sql` — new table.
- `src/database/schema.sql` — same table added (convention: replicate migrations here too).
- `src/repositories/niveisCategoriaRepository.js` — CRUD, empresa-scoped.
- `src/services/niveisCategoriaService.js` — duplicate-nivel → 409, not-found → 404.
- `src/validations/niveisCategoriaValidation.js` — Zod schemas (`criar`, `atualizar`), both `.strict()`.
- `src/controllers/niveisCategoriaController.js` — parses pagination-free list, id, rejects `nivel` in PUT body with an explicit 400.
- `src/routes/niveisCategoria.js` — `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`.

Modified files:

- `src/app.js` — mount `/niveis-categoria` behind `authMiddleware` + `requireEstoquista`.
- `CLAUDE.md` — new module entry + a short "regras já decididas" note (FK decision, no-cascade-on-delete).

New test files:

- `tests/repositories/niveisCategoriaRepository.test.js`
- `tests/services/niveisCategoriaService.test.js`
- `tests/routes/niveisCategoria.test.js` — 3 roles, duplicate nivel → 409, PUT with `nivel` in body → 400, extra field → 400, cross-tenant isolation.
- One explicit non-regression check added into `tests/repositories/categoriasRepository.test.js` (SQL never references `niveis_categoria`) and into `tests/routes/categorias.test.js` (`GET /categorias` still 200 for an empresa with nothing in `niveis_categoria`) — see Task 7.

---

## Task 1: Migration + schema.sql

**Files:**
- Create: `src/database/migrations/020_niveis_categoria.sql`
- Modify: `src/database/schema.sql`

**Interfaces:**
- Produces: table `niveis_categoria(id, empresa_id, nivel, nome, criado_em, atualizado_em)`, `UNIQUE(empresa_id, nivel)`, index `idx_niveis_categoria_empresa_id`.

- [ ] **Step 1: Write the migration**

```sql
-- Rótulo do que cada categorias_produto.nivel significa para a empresa
-- (ex.: Cherry: 1=família, 2=material, 3=gênero; outra empresa pode usar
-- conceitos totalmente diferentes). Tabela INDEPENDENTE de categorias_produto
-- — deliberadamente sem FK de nivel para cá. Motivo: hoje é possível criar
-- uma categoria em qualquer nível sem rótulo pré-cadastrado; uma FK exigiria
-- o rótulo antes da categoria, quebrando esse fluxo e qualquer dado já
-- existente. Renomear ou remover um rótulo aqui NUNCA afeta
-- categorias_produto nem a geração de SKU (que é ancorada no texto do
-- `codigo`, nunca no rótulo do nível) — puramente display.
CREATE TABLE IF NOT EXISTS niveis_categoria (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nivel INTEGER NOT NULL CHECK (nivel > 0),
    nome VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (empresa_id, nivel)
);

CREATE INDEX IF NOT EXISTS idx_niveis_categoria_empresa_id ON niveis_categoria(empresa_id);
```

- [ ] **Step 2: Replicate in `schema.sql`**

Add the `CREATE TABLE niveis_categoria (...)` block (without `IF NOT EXISTS`, matching the style of every other table in that file) right after the `sequencias_sku` table block (around line 102, before `CREATE TABLE canais_venda`), carrying the same comment. Add `CREATE INDEX idx_niveis_categoria_empresa_id ON niveis_categoria(empresa_id);` to the indexes block at the end of the file (after line 331).

- [ ] **Step 3: Note the migration is pending manual application**

No code step — just remember (per project convention) this needs manual apply in dev/`ci-test`/prod before merge/deploy, same as migration 019. Mention it in the final summary and CLAUDE.md entry (Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/020_niveis_categoria.sql src/database/schema.sql
git commit -m "feat(categorias): adiciona tabela niveis_categoria (schema)"
```

---

## Task 2: Repository

**Files:**
- Create: `src/repositories/niveisCategoriaRepository.js`
- Test: `tests/repositories/niveisCategoriaRepository.test.js`

**Interfaces:**
- Produces:
  - `listar(empresa_id) => Promise<Array<{id, empresa_id, nivel, nome, criado_em, atualizado_em}>>` — ordered by `nivel ASC`, no pagination (spec says just "lista os níveis nomeados da empresa, ordenados por nivel ascendente" — small, bounded list, unlike categorias which can grow large).
  - `buscarPorId(id, empresa_id) => Promise<row|null>`
  - `buscarPorNivel(nivel, empresa_id) => Promise<row|null>`
  - `criar({ nivel, nome, empresa_id }) => Promise<row>`
  - `atualizarNome(id, nome, empresa_id) => Promise<row|null>`
  - `remover(id, empresa_id) => Promise<row|null>` (hard delete, `DELETE ... RETURNING *`)

- [ ] **Step 1: Write the failing tests**

```javascript
jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const niveisCategoriaRepository = require('../../src/repositories/niveisCategoriaRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('scopes by empresa_id and orders by nivel ascending', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, nome: 'Família' }] });

    const resultado = await niveisCategoriaRepository.listar(9);

    expect(resultado).toEqual([{ id: 1, nivel: 1, nome: 'Família' }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('ORDER BY nivel ASC');
    expect(sql).not.toContain('categorias_produto');
    expect(params).toEqual([9]);
  });
});

describe('buscarPorId', () => {
  test('scopes by id AND empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, empresa_id: 9 }] });

    const resultado = await niveisCategoriaRepository.buscarPorId(1, 9);

    expect(resultado).toEqual({ id: 1, empresa_id: 9 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when no row matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.buscarPorId(1, 9)).toBeNull();
  });
});

describe('buscarPorNivel', () => {
  test('scopes by nivel and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 2 }] });

    const resultado = await niveisCategoriaRepository.buscarPorNivel(2, 9);

    expect(resultado).toEqual({ id: 1, nivel: 2 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('nivel = $1 AND empresa_id = $2');
    expect(params).toEqual([2, 9]);
  });

  test('returns null when nothing matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.buscarPorNivel(9, 9)).toBeNull();
  });
});

describe('criar', () => {
  test('inserts with the given empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, nome: 'Família', empresa_id: 9 }] });

    const resultado = await niveisCategoriaRepository.criar({ nivel: 1, nome: 'Família', empresa_id: 9 });

    expect(resultado.empresa_id).toBe(9);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO niveis_categoria');
    expect(params).toEqual([1, 'Família', 9]);
  });
});

describe('atualizarNome', () => {
  test('updates nome scoped by id and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Novo Nome' }] });

    const resultado = await niveisCategoriaRepository.atualizarNome(1, 'Novo Nome', 9);

    expect(resultado.nome).toBe('Novo Nome');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('atualizado_em = NOW()');
    expect(params).toEqual(['Novo Nome', 1, 9]);
  });

  test('returns null when the nivel does not belong to this empresa', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.atualizarNome(1, 'X', 9)).toBeNull();
  });
});

describe('remover', () => {
  test('deletes scoped by id and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, nome: 'Família' }] });

    const resultado = await niveisCategoriaRepository.remover(1, 9);

    expect(resultado).toEqual({ id: 1, nivel: 1, nome: 'Família' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM niveis_categoria');
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when not found', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await niveisCategoriaRepository.remover(1, 9)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/repositories/niveisCategoriaRepository.test.js`
Expected: FAIL — `Cannot find module '../../src/repositories/niveisCategoriaRepository'`.

- [ ] **Step 3: Write the implementation**

```javascript
const db = require('../config/db');

async function listar(empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM niveis_categoria WHERE empresa_id = $1 ORDER BY nivel ASC`,
        [empresa_id]
    );
    return rows;
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM niveis_categoria WHERE id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function buscarPorNivel(nivel, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM niveis_categoria WHERE nivel = $1 AND empresa_id = $2`,
        [nivel, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function criar({ nivel, nome, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO niveis_categoria (nivel, nome, empresa_id) VALUES ($1, $2, $3) RETURNING *`,
        [nivel, nome, empresa_id]
    );
    return rows[0];
}

async function atualizarNome(id, nome, empresa_id) {
    const { rows } = await db.query(
        `UPDATE niveis_categoria SET nome = $1, atualizado_em = NOW()
         WHERE id = $2 AND empresa_id = $3
         RETURNING *`,
        [nome, id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function remover(id, empresa_id) {
    const { rows } = await db.query(
        `DELETE FROM niveis_categoria WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

module.exports = { listar, buscarPorId, buscarPorNivel, criar, atualizarNome, remover };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/repositories/niveisCategoriaRepository.test.js`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/niveisCategoriaRepository.js tests/repositories/niveisCategoriaRepository.test.js
git commit -m "feat(categorias): repository de niveis_categoria"
```

---

## Task 3: Service

**Files:**
- Create: `src/services/niveisCategoriaService.js`
- Test: `tests/services/niveisCategoriaService.test.js`

**Interfaces:**
- Consumes: `niveisCategoriaRepository.{listar, buscarPorNivel, criar, atualizarNome, remover}` from Task 2.
- Produces:
  - `listar(empresa_id) => Promise<Array<row>>`
  - `criar({ nivel, nome }, empresa_id) => Promise<row>` — throws `AppError('Já existe um rótulo para este nível', 409)` on duplicate (checked first, plus `error.code === '23505'` race safety net, same pattern as `categoriasService.criar`).
  - `atualizar(id, { nome }, empresa_id) => Promise<row>` — throws `AppError('Nível não encontrado', 404)`.
  - `remover(id, empresa_id) => Promise<row>` — throws `AppError('Nível não encontrado', 404)`.

- [ ] **Step 1: Write the failing tests**

```javascript
jest.mock('../../src/repositories/niveisCategoriaRepository');

const niveisCategoriaRepository = require('../../src/repositories/niveisCategoriaRepository');
const niveisCategoriaService = require('../../src/services/niveisCategoriaService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('forwards empresa_id', async () => {
    niveisCategoriaRepository.listar.mockResolvedValue([{ id: 1, nivel: 1, nome: 'Família' }]);

    const result = await niveisCategoriaService.listar(9);

    expect(niveisCategoriaRepository.listar).toHaveBeenCalledWith(9);
    expect(result).toEqual([{ id: 1, nivel: 1, nome: 'Família' }]);
  });
});

describe('criar', () => {
  test('creates when no duplicate nivel exists', async () => {
    niveisCategoriaRepository.buscarPorNivel.mockResolvedValue(null);
    niveisCategoriaRepository.criar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família', empresa_id: 9 });

    const result = await niveisCategoriaService.criar({ nivel: 1, nome: 'Família' }, 9);

    expect(niveisCategoriaRepository.buscarPorNivel).toHaveBeenCalledWith(1, 9);
    expect(niveisCategoriaRepository.criar).toHaveBeenCalledWith({ nivel: 1, nome: 'Família', empresa_id: 9 });
    expect(result.nivel).toBe(1);
  });

  test('throws 409 when the nivel already has a label', async () => {
    niveisCategoriaRepository.buscarPorNivel.mockResolvedValue({ id: 1 });

    await expect(
      niveisCategoriaService.criar({ nivel: 1, nome: 'Família' }, 9)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Já existe um rótulo para este nível' });

    expect(niveisCategoriaRepository.criar).not.toHaveBeenCalled();
  });

  test('converts a unique-violation race on insert into a clean 409', async () => {
    niveisCategoriaRepository.buscarPorNivel.mockResolvedValue(null);
    const erroColisao = new Error('duplicate key value violates unique constraint "niveis_categoria_empresa_id_nivel_key"');
    erroColisao.code = '23505';
    niveisCategoriaRepository.criar.mockRejectedValue(erroColisao);

    await expect(
      niveisCategoriaService.criar({ nivel: 1, nome: 'Família' }, 9)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Já existe um rótulo para este nível' });
  });
});

describe('atualizar', () => {
  test('updates nome via the repository', async () => {
    niveisCategoriaRepository.atualizarNome.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const result = await niveisCategoriaService.atualizar(1, { nome: 'Novo Nome' }, 9);

    expect(niveisCategoriaRepository.atualizarNome).toHaveBeenCalledWith(1, 'Novo Nome', 9);
    expect(result.nome).toBe('Novo Nome');
  });

  test('throws 404 when the nivel does not exist for this empresa', async () => {
    niveisCategoriaRepository.atualizarNome.mockResolvedValue(null);

    await expect(niveisCategoriaService.atualizar(999, { nome: 'X' }, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Nível não encontrado'
    });
  });
});

describe('remover', () => {
  test('deletes an existing nivel', async () => {
    niveisCategoriaRepository.remover.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const result = await niveisCategoriaService.remover(1, 9);

    expect(niveisCategoriaRepository.remover).toHaveBeenCalledWith(1, 9);
    expect(result.nivel).toBe(1);
  });

  test('throws 404 when the nivel does not exist for this empresa', async () => {
    niveisCategoriaRepository.remover.mockResolvedValue(null);

    await expect(niveisCategoriaService.remover(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Nível não encontrado'
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/services/niveisCategoriaService.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
const niveisCategoriaRepository = require('../repositories/niveisCategoriaRepository');
const AppError = require('../errors/AppError');

async function listar(empresaId) {
    return niveisCategoriaRepository.listar(empresaId);
}

async function criar(dados, empresaId) {
    const existente = await niveisCategoriaRepository.buscarPorNivel(dados.nivel, empresaId);

    if (existente) {
        throw new AppError('Já existe um rótulo para este nível', 409);
    }

    try {
        return await niveisCategoriaRepository.criar({ nivel: dados.nivel, nome: dados.nome, empresa_id: empresaId });
    } catch (error) {
        if (error.code === '23505') {
            throw new AppError('Já existe um rótulo para este nível', 409);
        }
        throw error;
    }
}

async function atualizar(id, dados, empresaId) {
    const atualizado = await niveisCategoriaRepository.atualizarNome(id, dados.nome, empresaId);

    if (!atualizado) {
        throw new AppError('Nível não encontrado', 404);
    }

    return atualizado;
}

async function remover(id, empresaId) {
    const removido = await niveisCategoriaRepository.remover(id, empresaId);

    if (!removido) {
        throw new AppError('Nível não encontrado', 404);
    }

    return removido;
}

module.exports = { listar, criar, atualizar, remover };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/niveisCategoriaService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/niveisCategoriaService.js tests/services/niveisCategoriaService.test.js
git commit -m "feat(categorias): service de niveis_categoria"
```

---

## Task 4: Validation, Controller, Routes + mount

**Files:**
- Create: `src/validations/niveisCategoriaValidation.js`
- Create: `src/controllers/niveisCategoriaController.js`
- Create: `src/routes/niveisCategoria.js`
- Modify: `src/app.js`
- Test: `tests/routes/niveisCategoria.test.js`

**Interfaces:**
- Consumes: `niveisCategoriaService.{listar, criar, atualizar, remover}` from Task 3.
- Produces: mounted router at `/niveis-categoria`.

- [ ] **Step 1: Write the failing route tests**

```javascript
jest.mock('../../src/services/niveisCategoriaService');

const request = require('supertest');
const niveisCategoriaService = require('../../src/services/niveisCategoriaService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });
const outraEmpresaAdminToken = makeToken({ id: 4, role: 'admin', empresa_id: 2 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('access control (admin + estoquista only)', () => {
  const requests = [
    ['get', '/niveis-categoria'],
    ['post', '/niveis-categoria'],
    ['put', '/niveis-categoria/1'],
    ['delete', '/niveis-categoria/1']
  ];

  test.each(requests)('%s %s returns 401 without a token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  test.each(requests)('%s %s returns 403 for a vendedor', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /niveis-categoria', () => {
  test('returns 200 for an admin', async () => {
    niveisCategoriaService.listar.mockResolvedValue([{ id: 1, nivel: 1, nome: 'Família' }]);

    const res = await request(app).get('/niveis-categoria').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: 1, nivel: 1, nome: 'Família' }] });
    expect(niveisCategoriaService.listar).toHaveBeenCalledWith(1);
  });

  test('returns 200 for an estoquista', async () => {
    niveisCategoriaService.listar.mockResolvedValue([]);

    const res = await request(app).get('/niveis-categoria').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(200);
  });

  test('scopes strictly by the caller empresa_id (isolation)', async () => {
    niveisCategoriaService.listar.mockResolvedValue([]);

    await request(app).get('/niveis-categoria').set('Authorization', `Bearer ${outraEmpresaAdminToken}`);

    expect(niveisCategoriaService.listar).toHaveBeenCalledWith(2);
  });
});

describe('POST /niveis-categoria', () => {
  test('returns 400 for a missing nome', async () => {
    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1 });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for a missing nivel', async () => {
    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Família' });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.criar).not.toHaveBeenCalled();
  });

  test('returns 400 for an extra unknown field (strict schema)', async () => {
    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Família', codigo: 'ZZ' });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for an admin', async () => {
    niveisCategoriaService.criar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Família' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
  });

  test('returns 201 for an estoquista', async () => {
    niveisCategoriaService.criar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nivel: 1, nome: 'Família' });

    expect(res.status).toBe(201);
  });

  test('returns 409 when the service reports a duplicate nivel', async () => {
    niveisCategoriaService.criar.mockRejectedValue(new AppError('Já existe um rótulo para este nível', 409));

    const res = await request(app)
      .post('/niveis-categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Família' });

    expect(res.status).toBe(409);
  });
});

describe('PUT /niveis-categoria/:id', () => {
  test('returns 200 with the updated nivel for an admin', async () => {
    niveisCategoriaService.atualizar.mockResolvedValue({ id: 1, nivel: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(niveisCategoriaService.atualizar).toHaveBeenCalledWith(1, { nome: 'Novo Nome' }, 1);
  });

  test('returns 200 for an estoquista', async () => {
    niveisCategoriaService.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
  });

  test('returns 400 with an explicit message when nivel is in the body', async () => {
    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', nivel: 2 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não pode ser alterado/);
    expect(niveisCategoriaService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 400 for an extra unknown field (strict schema)', async () => {
    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', codigo: 'ZZ' });

    expect(res.status).toBe(400);
    expect(niveisCategoriaService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 404 when the nivel does not belong to this empresa', async () => {
    niveisCategoriaService.atualizar.mockRejectedValue(new AppError('Nível não encontrado', 404));

    const res = await request(app)
      .put('/niveis-categoria/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /niveis-categoria/:id', () => {
  test('returns 200 for an admin', async () => {
    niveisCategoriaService.remover.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app).delete('/niveis-categoria/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  test('returns 200 for an estoquista', async () => {
    niveisCategoriaService.remover.mockResolvedValue({ id: 1, nivel: 1, nome: 'Família' });

    const res = await request(app).delete('/niveis-categoria/1').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(200);
  });

  test('returns 404 when the nivel does not belong to this empresa', async () => {
    niveisCategoriaService.remover.mockRejectedValue(new AppError('Nível não encontrado', 404));

    const res = await request(app).delete('/niveis-categoria/1').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/routes/niveisCategoria.test.js`
Expected: FAIL — route not mounted / modules not found (404s or `Cannot find module`).

- [ ] **Step 3: Write the validation**

`src/validations/niveisCategoriaValidation.js`:

```javascript
const { z } = require('zod');

const criarNivelCategoriaSchema = z.object({
    nivel: z.coerce.number({ error: 'Nível é obrigatório' }).int('Nível inválido').positive('Nível inválido'),
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

const atualizarNivelCategoriaSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

module.exports = { criarNivelCategoriaSchema, atualizarNivelCategoriaSchema };
```

- [ ] **Step 4: Write the controller**

`src/controllers/niveisCategoriaController.js`:

```javascript
const niveisCategoriaService = require('../services/niveisCategoriaService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarNivelCategoriaSchema, atualizarNivelCategoriaSchema } = require('../validations/niveisCategoriaValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

async function listar(req, res, next) {
    try {
        const niveis = await niveisCategoriaService.listar(req.usuario.empresa_id);
        return response.success(res, niveis);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarNivelCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const nivel = await niveisCategoriaService.criar(parsed.data, req.usuario.empresa_id);

        return response.success(res, nivel, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        if ('nivel' in req.body) {
            throw new AppError('O nível não pode ser alterado após a criação — remova este rótulo e crie um novo', 400);
        }

        const parsed = atualizarNivelCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const nivel = await niveisCategoriaService.atualizar(id, parsed.data, req.usuario.empresa_id);

        return response.success(res, nivel);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const nivel = await niveisCategoriaService.remover(id, req.usuario.empresa_id);

        return response.success(res, nivel);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, criar, atualizar, remover };
```

Note: the `'nivel' in req.body` check must run **before** `.strict()` parsing (same order as `categoriasController.atualizar`'s `codigo`/`nivel` check), so a body with `nivel` gets the explicit message instead of the generic "unrecognized key" Zod error.

- [ ] **Step 5: Write the routes**

`src/routes/niveisCategoria.js`:

```javascript
const express = require('express');
const router = express.Router();
const controller = require('../controllers/niveisCategoriaController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.delete('/:id', controller.remover);

module.exports = router;
```

- [ ] **Step 6: Mount in `app.js`**

In `src/app.js`, add near the other route requires (after line 25, `categoriasRoutes`):

```javascript
const niveisCategoriaRoutes = require('./routes/niveisCategoria');
```

And near the other mounts (after line 46, `/categorias`):

```javascript
app.use('/niveis-categoria', authMiddleware, requireEstoquista, niveisCategoriaRoutes);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest tests/routes/niveisCategoria.test.js`
Expected: PASS (all cases green, including 401/403 access control).

- [ ] **Step 8: Commit**

```bash
git add src/validations/niveisCategoriaValidation.js src/controllers/niveisCategoriaController.js src/routes/niveisCategoria.js src/app.js tests/routes/niveisCategoria.test.js
git commit -m "feat(categorias): endpoint /niveis-categoria (CRUD, admin+estoquista)"
```

---

## Task 5: Explicit non-regression guards (GET /categorias and SKU generation unaffected)

**Files:**
- Modify: `tests/repositories/categoriasRepository.test.js` (add one test, do not touch existing ones)
- Modify: `tests/routes/categorias.test.js` (add one test, do not touch existing ones)

**Interfaces:**
- Consumes: nothing new — pure regression guard against accidental coupling introduced in Tasks 1-4.

- [ ] **Step 1: Add a repository-level guard**

Append to `tests/repositories/categoriasRepository.test.js` (inside a new `describe` block, after the existing `describe('softDelete', ...)`):

```javascript
describe('no coupling with niveis_categoria', () => {
  test('none of the categorias_produto queries reference niveis_categoria', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

    await categoriasRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });
    await categoriasRepository.buscarPorId(1, 9);
    await categoriasRepository.criar({ nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 });

    for (const call of db.query.mock.calls) {
      expect(call[0]).not.toContain('niveis_categoria');
    }
  });
});
```

This directly proves categoria listing/creation (and, by extension, SKU generation which reads categories through this same repository) never joins or depends on the new table — an empresa with zero `niveis_categoria` rows is indistinguishable to these queries from one with many.

- [ ] **Step 2: Add a route-level guard**

Append to `tests/routes/categorias.test.js`, inside the existing `describe('GET /categorias', ...)` block:

```javascript
  test('returns 200 even for an empresa with nothing registered in niveis_categoria', async () => {
    // categoriasService is mocked in this file regardless of niveis_categoria's
    // existence — this test documents the contract: GET /categorias must never
    // start requiring rows in niveis_categoria to succeed.
    categoriasService.listar.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });

    const res = await request(app).get('/categorias').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });
```

- [ ] **Step 3: Run both files to verify they pass**

Run: `npx jest tests/repositories/categoriasRepository.test.js tests/routes/categorias.test.js`
Expected: PASS, including the two new tests.

- [ ] **Step 4: Commit**

```bash
git add tests/repositories/categoriasRepository.test.js tests/routes/categorias.test.js
git commit -m "test(categorias): garante que categorias/SKU seguem funcionando sem niveis_categoria"
```

---

## Task 6: CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add to "Estado atual dos módulos"**

Insert a new bullet right after the "Categorias de produto + SKU automático" bullet:

```markdown
- **Rótulos de nível de categoria** — migration `020_niveis_categoria.sql`: tabela `niveis_categoria` (`empresa_id`, `nivel`, `nome`, `UNIQUE(empresa_id, nivel)`) permite cada empresa nomear o que cada `categorias_produto.nivel` significa (ex.: Cherry usa 1=família, 2=material, 3=gênero). CRUD em `/niveis-categoria`, admin+estoquista (mesma permissão de `/categorias`). Ver `## Regras já decididas em rótulos de nível de categoria` abaixo.
```

- [ ] **Step 2: Add a new "Regras já decididas" section**

Insert after the "Regras já decididas em categorias de produto + SKU automático" section:

```markdown
## Regras já decididas em rótulos de nível de categoria — não reabrir

Migration `020_niveis_categoria.sql`: `niveis_categoria` (`empresa_id`, `nivel`, `nome`, `UNIQUE(empresa_id, nivel)`) deixa cada empresa nomear o que um `categorias_produto.nivel` significa pra ela — Cherry usa 1=família, 2=material, 3=gênero; outra empresa do sistema (perfumes/eletrônicos) usa outros conceitos. Sem isso a UI só podia mostrar "Nível 1/2/3" ou cravar rótulos fixos no frontend, o que anularia a configurabilidade por empresa já construída em `categorias_produto`.

- **`niveis_categoria` é uma tabela INDEPENDENTE de `categorias_produto` — sem FK entre `categorias_produto.nivel` e esta tabela.** Decisão tomada nesta sessão (não havia decisão prévia). Motivo: hoje é possível criar uma categoria em qualquer nível sem rótulo pré-cadastrado; uma FK passaria a exigir o rótulo antes da categoria — mudança de comportamento que quebraria fluxos e dados já existentes (toda empresa hoje tem `niveis_categoria` vazia). Se essa decisão for revisitada no futuro (ex.: exigir rótulo obrigatório), precisa de backfill explícito e de uma decisão de negócio sobre o que fazer com níveis já em uso sem rótulo — não é automático.
- **Sem soft delete.** Diferente de `categorias_produto`, um rótulo de nível não tem histórico a preservar — `DELETE /niveis-categoria/:id` remove a linha de verdade. Não cascateia: categorias em `categorias_produto` naquele nível continuam funcionando normalmente, só voltam a aparecer sem nome (mesmo estado de hoje, antes de qualquer rótulo existir).
- **Renomear (`PUT /niveis-categoria/:id`, só `{ nome }`, `.strict()`) nunca toca SKU nem `categorias_produto`.** O rótulo é puramente display — a `chave_combinacao` da sequência de SKU continua ancorada no texto de `categorias_produto.codigo` (decisão 7 do spec de categorias/SKU), nunca no nome do nível. Mandar `nivel` no body de `PUT` é 400 explícito (mesmo padrão de `PUT /categorias/:id` rejeitando `codigo`/`nivel`), não ignorado em silêncio.
- **Acesso: admin+estoquista** (`requireEstoquista`, mesmo padrão de `/categorias`) — vendedor recebe 403 em toda rota do módulo, princípio de não divergir de um recurso irmão sem motivo.
- **`GET /categorias` e a geração de SKU continuam funcionando para empresa sem nenhum rótulo cadastrado** — nível sem rótulo não é erro, é o estado padrão de toda empresa hoje (inclusive todas as que já usam categorias antes desta migration). Coberto por teste dedicado em `tests/repositories/categoriasRepository.test.js` e `tests/routes/categorias.test.js`.
- Mesmo padrão de nomenclatura do projeto: `criado_em`/`atualizado_em`, não `created_at`/`updated_at`.
- **Migration pendente de aplicação manual** em `ci-test`, dev e produção — mesma rotina de sempre (não existe runner automático de migration neste projeto).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: registra módulo niveis_categoria no CLAUDE.md"
```

---

## Task 7: Full suite + wrap-up

- [ ] **Step 1: Apply migration 020 to the local dev database**

Run whatever this project's existing manual-apply approach is (there is no migration runner — see CLAUDE.md "Banco" section). Confirm `niveis_categoria` exists before relying on it for any manual/local verification.

- [ ] **Step 2: Run the full test suite once**

Run: `npm test`
Expected: all suites green, no regressions (baseline before this branch was reported as 973/989 passing in memory — confirm the new tests bring the total up with zero new failures elsewhere).

- [ ] **Step 3: If everything is green, prepare the final summary**

Confirm the branch is `feat/niveis-categoria` (created from an up-to-date `master`, per this project's branch-flow rule), all commits are in place, and no `git push` / PR has been made (per "Como trabalhar comigo": push and PR are always done manually by the user).

- [ ] **Step 4: Final summary to the user**

Report: what changed (files list), decisions made solo (FK vs. independent — with the one-line reason), what was tested (`npm test` result), and the final commit hash (`git log -1 --format=%H`).

---

## Original request (verbatim brief this plan implements)

> Repo: cherry-backend. O PR #22 entregou categorias de produto configuráveis por empresa (categorias_produto, com nivel/codigo/nome) e geração automática de SKU (sequencias_sku, PATCH /produtos/:id/categoria). categorias_produto.nivel é só um inteiro, sem registro do que cada nível significa por empresa (Cherry: 1=família, 2=material, 3=gênero; outro cliente terá outros conceitos). Objetivo: permitir que cada empresa nomeie seus níveis de categoria, via nova tabela `niveis_categoria` (id, empresa_id, nivel, nome, criado_em, atualizado_em, UNIQUE(empresa_id, nivel)) e cluster `/niveis-categoria` (GET/POST/PUT/DELETE), admin+estoquista, seguindo exatamente o padrão do cluster `categorias`. Decidir e documentar no PR se `categorias_produto.nivel` ganha FK para `niveis_categoria` ou se seguem independentes (preferir a opção que não quebra o que já existe). Nada pode tocar `skuService`/geração de SKU. `GET /categorias` deve continuar funcionando para empresa sem nenhum rótulo cadastrado. Testes cobrindo os três papéis, duplicata → 409, `PUT` com `nivel` no body → 400, payload extra → 400, isolamento entre empresas, e teste explícito de não-regressão em `/categorias`/SKU. `npm test` inteiro deve passar. Nota no CLAUDE.md. Commit em branch própria (`feat/niveis-categoria`), sem push nem PR.

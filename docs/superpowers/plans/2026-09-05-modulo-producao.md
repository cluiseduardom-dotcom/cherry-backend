# Módulo de Produção (Fase C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ficha técnica (bill of materials) and produção (manufacturing run) to the Cherry ERP backend, so an `acabado` product can declare which `insumo` products it consumes, and a production run auto-consumes insumo stock and generates finished-good stock, with full/partial/blocked outcomes based on available insumo stock.

**Architecture:** Two new sub-modules following the existing `compras` pattern exactly: `fichas_tecnicas`/`itens_ficha_tecnica` (append-a-new-version ledger, mounted under `/produtos/:id/ficha-tecnica`) and `producoes` (its own top-level resource at `/producoes`, mirroring `compras` end-to-end: single-transaction creation, `estoqueRepository.criarMovimentacao` reused for every stock change, soft cancellation with stock estorno, no physical DELETE anywhere).

**Tech Stack:** Node/Express, `pg` (raw SQL, no ORM), Zod validation, Jest + Supertest, bcrypt/JWT already wired.

**Spec:** This plan is a direct decomposition of the task brief the user gave in this session (module de Produção: ficha técnica + produções). There is no separate spec file — the full brief is reproduced in context below each task where it drives a decision.

## Global Constraints

- Multi-tenant: every table gets `empresa_id` (FK NOT NULL, indexed); every query filters by it; `empresa_id` always comes from `req.usuario.empresa_id`, never body/query.
- Cross-tenant or missing resource → **404**, never 403 (403 is role-based only, from the `requireEstoquista`/`requireAdmin` middlewares).
- No physical `DELETE` anywhere in this module — cancellation is a status flip (`producoes.status`) or an append-only version flip (`fichas_tecnicas.vigente`).
- Timestamps: `criado_em`/`atualizado_em` (Portuguese), never `created_at`/`updated_at`.
- API responses: `{ success: true, data }` / `{ success: false, message }` via `src/utils/response.js`. Status codes: 400 validation, 401 no/invalid token, 403 role, 404 not found, 409 business-rule conflict, 500 unexpected.
- **Divergence #1 (confirmed by reading the schema, not assumed):** the task brief says "esconder `preco_custo`" — the real column on `produtos` is `custo` (see `002_produtos_sku.sql` / `schema.sql`). Every task below uses `custo`, not `preco_custo`.
- **Divergence #2:** `produtos.estoque_atual` and `movimentacoes_estoque.quantidade` are both `INTEGER` everywhere in the existing schema. The brief describes `itens_ficha_tecnica.quantidade_necessaria` as "numeric, > 0" — but a fractional value here would make `estoqueRepository.criarMovimentacao` try to write a non-integer into an `INTEGER` column when consumption is computed (`quantidade_necessaria × quantidade_produzida`), which either errors or silently truncates. `quantidade_necessaria` is declared `INTEGER NOT NULL CHECK (> 0)` instead. Supporting fractional insumo consumption would mean reworking the whole stock ledger — out of scope here. Flagged to the user in the final summary, not assumed silently.
- **Divergence #3:** the brief asks to "confirme como `precos_produto` resolve vigência antes de replicar" — checked: `precos_produto` has **no** `vigente` flag at all; it resolves "current price" purely by recency (`ORDER BY criado_em DESC LIMIT 1`, no unique index). The brief's own schema for `fichas_tecnicas` explicitly asks for a `vigente BOOLEAN` + partial unique index, which is a different (and more explicit) mechanism than what `precos_produto` actually does. Implemented as explicitly specified in the brief (boolean + partial unique index), not as a copy of `precos_produto`'s recency-only approach — noted so this isn't mistaken for a repeated pattern later.
- **Decision (small, reversible, documented in commit):** "vendor validation must be 404" in the brief is read as: not-found-or-other-tenant → 404 (matches project-wide idiom, e.g. `compras`' "Fornecedor não encontrado"); the resource *exists in the same empresa but has the wrong `tipo`* → 400, following the exact precedent of `compras`' "Produto inativo não pode receber movimentações de estoque" (400, not 404) for a same-tenant business-rule violation.
- Next available migration number confirmed by listing `src/database/migrations/`: **`013_producao.sql`** (last is `012_compras.sql`).

---

### Task 1: Migration `013_producao.sql` + `schema.sql` sync

**Files:**
- Create: `src/database/migrations/013_producao.sql`
- Modify: `src/database/schema.sql` (append the same DDL, no `IF NOT EXISTS`, matching the file's existing consolidated style)

**Interfaces:**
- Produces: tables `fichas_tecnicas`, `itens_ficha_tecnica`, `producoes`; column `produtos.tipo`. All later tasks read/write these exact names.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 013: Módulo de Produção (Fase C — ver MAPA_CHERRY_ERP.md §7/§8).
-- fichas_tecnicas é o "receituário" de um produto acabado: quais insumos e em
-- que quantidade ele consome pra ser fabricado. Nunca UPDATE pra alterar uma
-- ficha: uma nova versão é um INSERT com vigente = true, e a versão anterior
-- é marcada vigente = false na mesma transação (repositório cuida da ordem:
-- primeiro derruba a antiga, depois insere a nova, pra nunca violar o índice
-- único parcial abaixo mesmo que por um instante).
--
-- Divergência: o índice único parcial (vigente = true por produto_id+empresa_id)
-- foi pedido explicitamente no brief. precos_produto, que o brief citou como
-- inspiração, NA VERDADE não usa flag de vigência nenhuma — resolve "preço
-- atual" só por ordem de criado_em (linha mais recente vence). Aqui é um
-- mecanismo novo e mais explícito, não uma repetição do que já existe.
--
-- quantidade_necessaria é INTEGER, não NUMERIC: produtos.estoque_atual e
-- movimentacoes_estoque.quantidade já são INTEGER em todo o sistema. Um
-- consumo fracionário de insumo quebraria estoqueRepository.criarMovimentacao
-- na hora de gravar a movimentação (INTEGER não aceita fração). Suportar
-- consumo fracionário exigiria repensar o ledger de estoque inteiro — fora
-- do escopo desta tarefa.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'acabado' CHECK (tipo IN ('acabado', 'insumo'));

CREATE TABLE IF NOT EXISTS fichas_tecnicas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    vigente BOOLEAN NOT NULL DEFAULT true,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_vigente_unica ON fichas_tecnicas(empresa_id, produto_id) WHERE vigente = true;
CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_empresa_id ON fichas_tecnicas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_produto_id ON fichas_tecnicas(produto_id);

CREATE TABLE IF NOT EXISTS itens_ficha_tecnica (
    id SERIAL PRIMARY KEY,
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    insumo_produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade_necessaria INTEGER NOT NULL CHECK (quantidade_necessaria > 0),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id)
);

CREATE INDEX IF NOT EXISTS idx_itens_ficha_tecnica_ficha_tecnica_id ON itens_ficha_tecnica(ficha_tecnica_id);
CREATE INDEX IF NOT EXISTS idx_itens_ficha_tecnica_insumo_produto_id ON itens_ficha_tecnica(insumo_produto_id);
CREATE INDEX IF NOT EXISTS idx_itens_ficha_tecnica_empresa_id ON itens_ficha_tecnica(empresa_id);

CREATE TABLE IF NOT EXISTS producoes (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    quantidade_solicitada INTEGER NOT NULL CHECK (quantidade_solicitada > 0),
    quantidade_produzida INTEGER NOT NULL CHECK (quantidade_produzida >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida', 'cancelada')),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_producoes_empresa_id ON producoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_producoes_produto_id ON producoes(produto_id);
CREATE INDEX IF NOT EXISTS idx_producoes_ficha_tecnica_id ON producoes(ficha_tecnica_id);
```

- [ ] **Step 2: Apply it to the dev database and confirm it's idempotent**

Run: `node -e "require('./src/config/db').query(require('fs').readFileSync('./src/database/migrations/013_producao.sql', 'utf8')).then(() => console.log('OK')).catch(e => { console.error(e); process.exit(1); })"`
Run it a second time — must print `OK` both times (every statement is `IF NOT EXISTS`/`CHECK`-safe).

- [ ] **Step 3: Append the same DDL to `schema.sql`**

Append after the existing `itens_compra`/`contas_pagar.compra_id` block, matching the file's plain style (no `IF NOT EXISTS` — this file is a snapshot, not a re-runnable migration):

```sql
ALTER TABLE produtos ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'acabado' CHECK (tipo IN ('acabado', 'insumo'));

CREATE TABLE fichas_tecnicas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    vigente BOOLEAN NOT NULL DEFAULT true,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_fichas_tecnicas_vigente_unica ON fichas_tecnicas(empresa_id, produto_id) WHERE vigente = true;

CREATE TABLE itens_ficha_tecnica (
    id SERIAL PRIMARY KEY,
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    insumo_produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade_necessaria INTEGER NOT NULL CHECK (quantidade_necessaria > 0),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id)
);

CREATE TABLE producoes (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    quantidade_solicitada INTEGER NOT NULL CHECK (quantidade_solicitada > 0),
    quantidade_produzida INTEGER NOT NULL CHECK (quantidade_produzida >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida', 'cancelada')),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fichas_tecnicas_empresa_id ON fichas_tecnicas(empresa_id);
CREATE INDEX idx_fichas_tecnicas_produto_id ON fichas_tecnicas(produto_id);
CREATE INDEX idx_itens_ficha_tecnica_ficha_tecnica_id ON itens_ficha_tecnica(ficha_tecnica_id);
CREATE INDEX idx_itens_ficha_tecnica_insumo_produto_id ON itens_ficha_tecnica(insumo_produto_id);
CREATE INDEX idx_itens_ficha_tecnica_empresa_id ON itens_ficha_tecnica(empresa_id);
CREATE INDEX idx_producoes_empresa_id ON producoes(empresa_id);
CREATE INDEX idx_producoes_produto_id ON producoes(produto_id);
CREATE INDEX idx_producoes_ficha_tecnica_id ON producoes(ficha_tecnica_id);
```

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/013_producao.sql src/database/schema.sql
git commit -m "$(cat <<'EOF'
feat: migration do módulo de produção (fichas_tecnicas, itens_ficha_tecnica, producoes, produtos.tipo)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 2: `produtos.tipo` — validation + repository support

**Why this task exists:** the brief never asks explicitly to expose `tipo` on the existing `POST/PUT /produtos` endpoints, but without it no product could ever be created as `insumo` — the whole module would be unusable. This is the minimal wiring needed, folded into its own task because it touches existing, already-tested files.

**Files:**
- Modify: `src/validations/produtosValidation.js`
- Modify: `src/repositories/produtosRepository.js`
- Test: `tests/validations/produtosValidation.test.js` (exists already — add cases to it)
- Test: `tests/repositories/produtosRepository.test.js` (exists already — add cases to it)

**Interfaces:**
- Produces: `criarProdutoSchema`/`atualizarProdutoSchema` accept an optional `tipo: 'acabado' | 'insumo'`; `produtosRepository.criar`/`atualizar` persist it (default `'acabado'` when omitted on create).

- [ ] **Step 1: Write the failing tests**

Add to `tests/validations/produtosValidation.test.js`, inside the existing `describe('criarProdutoSchema', ...)` block:

```javascript
test('accepts an optional tipo of acabado or insumo', () => {
  expect(criarProdutoSchema.safeParse({ ...valid, tipo: 'insumo' }).success).toBe(true);
  expect(criarProdutoSchema.safeParse({ ...valid, tipo: 'acabado' }).success).toBe(true);
});

test('rejects an invalid tipo', () => {
  const result = criarProdutoSchema.safeParse({ ...valid, tipo: 'outro' });
  expect(result.success).toBe(false);
});
```

And a matching pair inside `describe('atualizarProdutoSchema', ...)`:

```javascript
test('accepts an optional tipo update', () => {
  expect(atualizarProdutoSchema.safeParse({ tipo: 'insumo' }).success).toBe(true);
});
```

Add to `tests/repositories/produtosRepository.test.js` (find the existing `describe('criar', ...)` block and add a sibling test near it):

```javascript
test('defaults tipo to acabado when not provided', async () => {
  const produto = await produtosRepository.criar({
    sku: 'SKU-1', nome: 'Anel', preco_venda: 100, custo: 40, empresa_id: 1
  });
  expect(produto.tipo).toBe('acabado');
});

test('persists tipo when provided as insumo', async () => {
  const produto = await produtosRepository.criar({
    sku: 'SKU-2', nome: 'Prata 950g', preco_venda: 10, custo: 5, tipo: 'insumo', empresa_id: 1
  });
  expect(produto.tipo).toBe('insumo');
});
```

(These run against the real test DB per the existing file's setup — check the top of `tests/repositories/produtosRepository.test.js` for how it connects/cleans up and follow the same pattern, e.g. wrapping in the same `beforeEach`/`afterEach` transaction-rollback or cleanup helper already used there.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/validations/produtosValidation.test.js tests/repositories/produtosRepository.test.js -t "tipo"`
Expected: FAIL — `criarProdutoSchema`/`atualizarProdutoSchema` don't declare `tipo` yet, so today it's silently an unknown key (zod's default object mode strips it without erroring), meaning "rejects an invalid tipo" wrongly reports `success: true`; and the repository test finds `produto.tipo` is `undefined` (the column exists from Task 1's migration, but the repository doesn't write it yet).

- [ ] **Step 3: Implement**

In `src/validations/produtosValidation.js`, add to both schemas:

```javascript
// in criarProdutoSchema:
tipo: z.enum(['acabado', 'insumo'], { error: 'Tipo inválido' }).optional(),

// in atualizarProdutoSchema:
tipo: z.enum(['acabado', 'insumo'], { error: 'Tipo inválido' }).optional(),
```

In `src/repositories/produtosRepository.js`, update `criar`:

```javascript
async function criar({ sku, nome, descricao, categoria, preco_venda, custo, estoque_atual, estoque_minimo, ativo, tipo, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (sku, nome, descricao, categoria, preco_venda, custo, estoque_atual, estoque_minimo, ativo, tipo, empresa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
            sku,
            nome,
            descricao ?? null,
            categoria ?? null,
            preco_venda,
            custo,
            estoque_atual ?? 0,
            estoque_minimo ?? 0,
            ativo ?? true,
            tipo ?? 'acabado',
            empresa_id
        ]
    );

    return rows[0];
}
```

And add `'tipo'` to the editable `campos` array inside `atualizar`:

```javascript
const campos = ['sku', 'nome', 'descricao', 'categoria', 'preco_venda', 'custo', 'estoque_minimo', 'ativo', 'tipo'];
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest tests/validations/produtosValidation.test.js tests/repositories/produtosRepository.test.js`
Expected: PASS, and no pre-existing test in either file regresses.

- [ ] **Step 5: Commit**

```bash
git add src/validations/produtosValidation.js src/repositories/produtosRepository.js tests/validations/produtosValidation.test.js tests/repositories/produtosRepository.test.js
git commit -m "$(cat <<'EOF'
feat: adiciona campo tipo (acabado/insumo) a produtos

Necessário como base pro módulo de produção: sem isso nenhum produto
poderia ser cadastrado como insumo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 3: `fichasTecnicasRepository`

**Files:**
- Create: `src/repositories/fichasTecnicasRepository.js`
- Test: `tests/repositories/fichasTecnicasRepository.test.js`

**Interfaces:**
- Consumes: `db` (`src/config/db.js`), `AppError` (`src/errors/AppError.js`).
- Produces:
  - `criarVersao({ produto_id, itens, usuario_id, empresa_id }) → { id, empresa_id, produto_id, vigente: true, criado_por, criado_em, itens: [{ id, insumo_produto_id, quantidade_necessaria, custo_unitario, subtotal_custo }], custo_sugerido }`
  - `buscarVigentePorProduto(produtoId, empresaId) → ficha shaped like above, or null`
  - `buscarHistoricoPorProduto(produtoId, empresaId) → [ficha, ...]` ordered `criado_em DESC`, same shape as above, most recent first.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/repositories/fichasTecnicasRepository.test.js
jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const fichasTecnicasRepository = require('../../src/repositories/fichasTecnicasRepository');
const AppError = require('../../src/errors/AppError');

function makeFakeClient({ produto = { existe: true, tipo: 'acabado' }, insumos = {}, fichaAnterior = null } = {}) {
  const client = { query: jest.fn(), release: jest.fn() };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});

    if (sql.includes('SELECT id, tipo FROM produtos WHERE id = $1 AND empresa_id = $2')) {
      return Promise.resolve({ rows: produto.existe === false ? [] : [{ id: params[0], tipo: produto.tipo }] });
    }

    if (sql.includes('SELECT id, tipo, custo FROM produtos WHERE id = $1 AND empresa_id = $2')) {
      const insumo = insumos[params[0]];
      return Promise.resolve({ rows: insumo ? [{ id: params[0], tipo: insumo.tipo, custo: insumo.custo }] : [] });
    }

    if (sql.includes('UPDATE fichas_tecnicas SET vigente = false')) {
      return Promise.resolve({});
    }

    if (sql.includes('INSERT INTO fichas_tecnicas')) {
      return Promise.resolve({ rows: [{ id: 10, empresa_id: params[0], produto_id: params[1], vigente: true, criado_por: params[2], criado_em: new Date() }] });
    }

    if (sql.includes('INSERT INTO itens_ficha_tecnica')) {
      const itens = [];
      for (let i = 0; i < params.length; i += 4) {
        itens.push({ id: itens.length + 1, insumo_produto_id: params[i + 1], quantidade_necessaria: params[i + 2] });
      }
      return Promise.resolve({ rows: itens });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => jest.clearAllMocks());

describe('criarVersao', () => {
  test('throws 404 when produto does not exist in this empresa', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ produto: { existe: false } }));

    await expect(fichasTecnicasRepository.criarVersao({
      produto_id: 1, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 1, empresa_id: 1
    })).rejects.toMatchObject({ statusCode: 404, message: 'Produto não encontrado' });
  });

  test('throws 400 when produto exists but is not tipo acabado', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ produto: { existe: true, tipo: 'insumo' } }));

    await expect(fichasTecnicasRepository.criarVersao({
      produto_id: 1, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 1, empresa_id: 1
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 400 when an item is not tipo insumo', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({
      produto: { existe: true, tipo: 'acabado' },
      insumos: { 2: { tipo: 'acabado', custo: 5 } }
    }));

    await expect(fichasTecnicasRepository.criarVersao({
      produto_id: 1, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 1, empresa_id: 1
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('computes custo_sugerido as the sum of quantidade_necessaria * custo, and marks the previous version não vigente', async () => {
    const fakeClient = makeFakeClient({
      produto: { existe: true, tipo: 'acabado' },
      insumos: { 2: { tipo: 'insumo', custo: 10 }, 3: { tipo: 'insumo', custo: 4 } }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    const ficha = await fichasTecnicasRepository.criarVersao({
      produto_id: 1,
      itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }, { insumo_produto_id: 3, quantidade_necessaria: 5 }],
      usuario_id: 1,
      empresa_id: 1
    });

    expect(ficha.custo_sugerido).toBe(40); // 2*10 + 5*4
    expect(ficha.itens).toHaveLength(2);
    expect(fakeClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE fichas_tecnicas SET vigente = false'),
      [1, 1]
    );
    expect(fakeClient.query).toHaveBeenCalledWith('COMMIT');
  });
});

describe('buscarVigentePorProduto', () => {
  test('returns null when there is no vigente ficha', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    const result = await fichasTecnicasRepository.buscarVigentePorProduto(1, 1);
    expect(result).toBeNull();
  });

  test('returns the ficha with itens and custo_sugerido', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 10, produto_id: 1, vigente: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 3, custo_unitario: '10.00', insumo_nome: 'Prata' }] });

    const result = await fichasTecnicasRepository.buscarVigentePorProduto(1, 1);

    expect(result.custo_sugerido).toBe(30);
    expect(result.itens[0].subtotal_custo).toBe(30);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/repositories/fichasTecnicasRepository.test.js`
Expected: FAIL with "Cannot find module '../../src/repositories/fichasTecnicasRepository'".

- [ ] **Step 3: Implement**

```javascript
// src/repositories/fichasTecnicasRepository.js
const db = require('../config/db');
const AppError = require('../errors/AppError');

function montarResposta(ficha, itensRows) {
    let custo_sugerido = 0;

    const itens = itensRows.map((item) => {
        const custo_unitario = Number(item.custo_unitario);
        const quantidade_necessaria = Number(item.quantidade_necessaria);
        const subtotal_custo = Number((quantidade_necessaria * custo_unitario).toFixed(2));
        custo_sugerido += subtotal_custo;

        return {
            id: item.id,
            insumo_produto_id: item.insumo_produto_id,
            insumo_nome: item.insumo_nome,
            quantidade_necessaria,
            custo_unitario,
            subtotal_custo
        };
    });

    return { ...ficha, itens, custo_sugerido: Number(custo_sugerido.toFixed(2)) };
}

// Uma única transação: valida produto (tipo 'acabado') e cada insumo (tipo
// 'insumo'), ambos da mesma empresa — 404 se não existir/empresa errada
// (mesmo padrão do resto do projeto), 400 se existir mas o tipo estiver
// errado (mesmo padrão de "produto inativo" em compras/estoque). Nunca faz
// UPDATE pra "editar" uma ficha: deriva a antiga (vigente = false) e insere
// a nova (vigente = true) na mesma transação, NESSA ORDEM — inserir a nova
// antes de derrubar a antiga violaria o índice único parcial mesmo que só
// por um instante.
async function criarVersao({ produto_id, itens, usuario_id, empresa_id }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, tipo FROM produtos WHERE id = $1 AND empresa_id = $2',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            throw new AppError('Produto não encontrado', 404);
        }

        if (produtoRows[0].tipo !== 'acabado') {
            throw new AppError("Produto deve ser do tipo 'acabado' para ter ficha técnica", 400);
        }

        const insumosValidados = [];

        for (const item of itens) {
            const { rows: insumoRows } = await client.query(
                'SELECT id, tipo, custo FROM produtos WHERE id = $1 AND empresa_id = $2',
                [item.insumo_produto_id, empresa_id]
            );

            if (!insumoRows.length) {
                throw new AppError('Insumo não encontrado', 404);
            }

            if (insumoRows[0].tipo !== 'insumo') {
                throw new AppError(`Produto ${item.insumo_produto_id} deve ser do tipo 'insumo'`, 400);
            }

            insumosValidados.push({
                insumo_produto_id: item.insumo_produto_id,
                quantidade_necessaria: item.quantidade_necessaria,
                custo: Number(insumoRows[0].custo)
            });
        }

        await client.query(
            'UPDATE fichas_tecnicas SET vigente = false WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
            [produto_id, empresa_id]
        );

        const { rows: fichaRows } = await client.query(
            `INSERT INTO fichas_tecnicas (empresa_id, produto_id, vigente, criado_por)
             VALUES ($1, $2, true, $3)
             RETURNING *`,
            [empresa_id, produto_id, usuario_id]
        );

        const ficha = fichaRows[0];

        const valores = insumosValidados.map((item) => [ficha.id, item.insumo_produto_id, item.quantidade_necessaria, empresa_id]);
        const placeholders = valores
            .map((_, i) => {
                const base = i * 4;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
            })
            .join(', ');

        const { rows: itensRows } = await client.query(
            `INSERT INTO itens_ficha_tecnica (ficha_tecnica_id, insumo_produto_id, quantidade_necessaria, empresa_id)
             VALUES ${placeholders}
             RETURNING id, insumo_produto_id, quantidade_necessaria`,
            valores.flat()
        );

        await client.query('COMMIT');

        const itensComCusto = itensRows.map((row) => {
            const validado = insumosValidados.find((v) => v.insumo_produto_id === row.insumo_produto_id);
            return { ...row, custo_unitario: validado.custo };
        });

        return montarResposta(ficha, itensComCusto);

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function buscarVigentePorProduto(produto_id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
        [produto_id, empresa_id]
    );

    if (!rows.length) return null;

    const ficha = rows[0];

    const { rows: itensRows } = await db.query(
        `SELECT itf.id, itf.insumo_produto_id, itf.quantidade_necessaria, p.custo AS custo_unitario, p.nome AS insumo_nome
         FROM itens_ficha_tecnica itf
         JOIN produtos p ON p.id = itf.insumo_produto_id
         WHERE itf.ficha_tecnica_id = $1
         ORDER BY itf.id`,
        [ficha.id]
    );

    return montarResposta(ficha, itensRows);
}

async function buscarHistoricoPorProduto(produto_id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 ORDER BY criado_em DESC, id DESC',
        [produto_id, empresa_id]
    );

    const fichas = [];

    for (const ficha of rows) {
        const { rows: itensRows } = await db.query(
            `SELECT itf.id, itf.insumo_produto_id, itf.quantidade_necessaria, p.custo AS custo_unitario, p.nome AS insumo_nome
             FROM itens_ficha_tecnica itf
             JOIN produtos p ON p.id = itf.insumo_produto_id
             WHERE itf.ficha_tecnica_id = $1
             ORDER BY itf.id`,
            [ficha.id]
        );

        fichas.push(montarResposta(ficha, itensRows));
    }

    return fichas;
}

module.exports = {
    criarVersao,
    buscarVigentePorProduto,
    buscarHistoricoPorProduto
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/repositories/fichasTecnicasRepository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/fichasTecnicasRepository.js tests/repositories/fichasTecnicasRepository.test.js
git commit -m "$(cat <<'EOF'
feat: repository de fichas técnicas (versionamento append-only)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 4: `fichasTecnicasValidation` + `fichasTecnicasService`

**Files:**
- Create: `src/validations/fichasTecnicasValidation.js`
- Create: `src/services/fichasTecnicasService.js`
- Test: `tests/services/fichasTecnicasService.test.js`

**Interfaces:**
- Consumes: `fichasTecnicasRepository` (Task 3), `produtosRepository.buscarPorId` (existing), `AppError`.
- Produces: `criarFichaTecnicaSchema`; `fichasTecnicasService.{criar, buscarVigente, historico}`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/services/fichasTecnicasService.test.js
jest.mock('../../src/repositories/fichasTecnicasRepository');
jest.mock('../../src/repositories/produtosRepository');

const fichasTecnicasRepository = require('../../src/repositories/fichasTecnicasRepository');
const produtosRepository = require('../../src/repositories/produtosRepository');
const fichasTecnicasService = require('../../src/services/fichasTecnicasService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => jest.clearAllMocks());

describe('criar', () => {
  test('delegates to the repository with produto_id/usuario_id/empresa_id attached', async () => {
    fichasTecnicasRepository.criarVersao.mockResolvedValue({ id: 1, custo_sugerido: 40 });

    const result = await fichasTecnicasService.criar(5, { itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }] }, 7, 9);

    expect(fichasTecnicasRepository.criarVersao).toHaveBeenCalledWith({
      produto_id: 5, itens: [{ insumo_produto_id: 2, quantidade_necessaria: 3 }], usuario_id: 7, empresa_id: 9
    });
    expect(result.id).toBe(1);
  });
});

describe('buscarVigente', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(fichasTecnicasService.buscarVigente(5, 9)).rejects.toMatchObject({
      statusCode: 404, message: 'Produto não encontrado'
    });
    expect(fichasTecnicasRepository.buscarVigentePorProduto).not.toHaveBeenCalled();
  });

  test('throws 404 when the produto exists but has no vigente ficha', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 5 });
    fichasTecnicasRepository.buscarVigentePorProduto.mockResolvedValue(null);

    await expect(fichasTecnicasService.buscarVigente(5, 9)).rejects.toMatchObject({
      statusCode: 404, message: 'Ficha técnica não encontrada'
    });
  });

  test('returns the ficha when found', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 5 });
    fichasTecnicasRepository.buscarVigentePorProduto.mockResolvedValue({ id: 1, custo_sugerido: 40 });

    const result = await fichasTecnicasService.buscarVigente(5, 9);
    expect(result.custo_sugerido).toBe(40);
  });
});

describe('historico', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);
    await expect(fichasTecnicasService.historico(5, 9)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('returns the list (possibly empty) when the produto exists', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 5 });
    fichasTecnicasRepository.buscarHistoricoPorProduto.mockResolvedValue([]);

    const result = await fichasTecnicasService.historico(5, 9);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/services/fichasTecnicasService.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```javascript
// src/validations/fichasTecnicasValidation.js
const { z } = require('zod');

const criarFichaTecnicaSchema = z.object({
    itens: z.array(
        z.object({
            insumo_produto_id: z.coerce.number({ error: 'Insumo inválido' }).int().positive('Insumo inválido'),
            quantidade_necessaria: z.coerce.number({ error: 'Quantidade necessária deve ser maior que zero' }).int('Quantidade necessária deve ser maior que zero').positive('Quantidade necessária deve ser maior que zero')
        }).strict()
    ).min(1, 'A ficha técnica deve ter ao menos um item')
}).strict();

module.exports = { criarFichaTecnicaSchema };
```

```javascript
// src/services/fichasTecnicasService.js
const fichasTecnicasRepository = require('../repositories/fichasTecnicasRepository');
const produtosRepository = require('../repositories/produtosRepository');
const AppError = require('../errors/AppError');

async function criar(produtoId, dados, usuarioId, empresaId) {
    return fichasTecnicasRepository.criarVersao({
        produto_id: produtoId,
        itens: dados.itens,
        usuario_id: usuarioId,
        empresa_id: empresaId
    });
}

async function buscarVigente(produtoId, empresaId) {
    const produto = await produtosRepository.buscarPorId(produtoId, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const ficha = await fichasTecnicasRepository.buscarVigentePorProduto(produtoId, empresaId);

    if (!ficha) {
        throw new AppError('Ficha técnica não encontrada', 404);
    }

    return ficha;
}

async function historico(produtoId, empresaId) {
    const produto = await produtosRepository.buscarPorId(produtoId, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    return fichasTecnicasRepository.buscarHistoricoPorProduto(produtoId, empresaId);
}

module.exports = { criar, buscarVigente, historico };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/services/fichasTecnicasService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validations/fichasTecnicasValidation.js src/services/fichasTecnicasService.js tests/services/fichasTecnicasService.test.js
git commit -m "$(cat <<'EOF'
feat: validation e service de fichas técnicas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 5: `fichasTecnicasController` + routes wiring under `/produtos`

**Files:**
- Create: `src/controllers/fichasTecnicasController.js`
- Modify: `src/routes/produtos.js`
- Test: `tests/routes/fichasTecnicas.test.js`

**Interfaces:**
- Consumes: `fichasTecnicasService` (Task 4), `requireAdmin`/`requireEstoquista` (existing middlewares).
- Produces: `POST /produtos/:id/ficha-tecnica`, `GET /produtos/:id/ficha-tecnica`, `GET /produtos/:id/ficha-tecnica/historico`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/routes/fichasTecnicas.test.js
jest.mock('../../src/services/fichasTecnicasService');

const request = require('supertest');
const fichasTecnicasService = require('../../src/services/fichasTecnicasService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => jest.clearAllMocks());

describe('access control', () => {
  const requests = [
    ['post', '/produtos/1/ficha-tecnica'],
    ['get', '/produtos/1/ficha-tecnica'],
    ['get', '/produtos/1/ficha-tecnica/historico']
  ];

  test.each(requests)('%s %s returns 403 for a vendedor', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });

  test('GET .../historico returns 403 for an estoquista (admin only)', async () => {
    const res = await request(app).get('/produtos/1/ficha-tecnica/historico').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /produtos/:id/ficha-tecnica', () => {
  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [] });

    expect(res.status).toBe(400);
    expect(fichasTecnicasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for an admin, with custo_sugerido visible', async () => {
    fichasTecnicasService.criar.mockResolvedValue({
      id: 1, produto_id: 1, vigente: true, custo_sugerido: 40,
      itens: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 2, custo_unitario: 10, subtotal_custo: 20 }]
    });

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.custo_sugerido).toBe(40);
  });

  test('returns 201 for an estoquista, with custo_sugerido and item custo hidden', async () => {
    fichasTecnicasService.criar.mockResolvedValue({
      id: 1, produto_id: 1, vigente: true, custo_sugerido: 40,
      itens: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 2, custo_unitario: 10, subtotal_custo: 20 }]
    });

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.custo_sugerido).toBeUndefined();
    expect(res.body.data.itens[0].custo_unitario).toBeUndefined();
    expect(res.body.data.itens[0].subtotal_custo).toBeUndefined();
    expect(res.body.data.itens[0].insumo_produto_id).toBe(2);
  });

  test('returns 404 when the produto belongs to another empresa', async () => {
    fichasTecnicasService.criar.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(404);
  });

  test('returns 400 when the produto is not tipo acabado', async () => {
    fichasTecnicasService.criar.mockRejectedValue(new AppError("Produto deve ser do tipo 'acabado' para ter ficha técnica", 400));

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(400);
  });
});

describe('GET /produtos/:id/ficha-tecnica', () => {
  test('returns 404 when there is no vigente ficha', async () => {
    fichasTecnicasService.buscarVigente.mockRejectedValue(new AppError('Ficha técnica não encontrada', 404));

    const res = await request(app).get('/produtos/1/ficha-tecnica').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with custo hidden for an estoquista', async () => {
    fichasTecnicasService.buscarVigente.mockResolvedValue({
      id: 1, produto_id: 1, custo_sugerido: 40, itens: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 2, custo_unitario: 10, subtotal_custo: 20 }]
    });

    const res = await request(app).get('/produtos/1/ficha-tecnica').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.custo_sugerido).toBeUndefined();
  });
});

describe('GET /produtos/:id/ficha-tecnica/historico', () => {
  test('returns 200 with the full version list for an admin', async () => {
    fichasTecnicasService.historico.mockResolvedValue([
      { id: 2, vigente: true, custo_sugerido: 40 },
      { id: 1, vigente: false, custo_sugerido: 35 }
    ]);

    const res = await request(app).get('/produtos/1/ficha-tecnica/historico').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].custo_sugerido).toBe(40);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/routes/fichasTecnicas.test.js`
Expected: FAIL (routes don't exist yet → 404 from Express' default handler instead of the expected statuses).

- [ ] **Step 3: Implement**

```javascript
// src/controllers/fichasTecnicasController.js
const fichasTecnicasService = require('../services/fichasTecnicasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarFichaTecnicaSchema } = require('../validations/fichasTecnicasValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

// Espelha filtrarParaRole de produtosController: aqui quem perde visibilidade
// de custo é a estoquista (não a vendedor — vendedor já é barrada em 403 pelo
// requireEstoquista antes de chegar aqui).
function filtrarCustoParaRole(ficha, role) {
    if (role === 'admin') return ficha;

    const { custo_sugerido, itens, ...resto } = ficha;

    return {
        ...resto,
        itens: itens.map(({ custo_unitario, subtotal_custo, ...item }) => item)
    };
}

async function criar(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);

        const parsed = criarFichaTecnicaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const ficha = await fichasTecnicasService.criar(produtoId, parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(ficha, req.usuario.role), 201);
    } catch (error) {
        next(error);
    }
}

async function buscarVigente(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const ficha = await fichasTecnicasService.buscarVigente(produtoId, req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(ficha, req.usuario.role));
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const produtoId = parseId(req.params.id);
        const fichas = await fichasTecnicasService.historico(produtoId, req.usuario.empresa_id);

        return response.success(res, fichas);
    } catch (error) {
        next(error);
    }
}

module.exports = { criar, buscarVigente, historico };
```

In `src/routes/produtos.js`, add the import and three routes (near the existing `/:id/precos` block):

```javascript
const fichasTecnicasController = require('../controllers/fichasTecnicasController');
```

```javascript
router.post('/:id/ficha-tecnica', requireEstoquista, fichasTecnicasController.criar);
router.get('/:id/ficha-tecnica', requireEstoquista, fichasTecnicasController.buscarVigente);
router.get('/:id/ficha-tecnica/historico', requireAdmin, fichasTecnicasController.historico);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/routes/fichasTecnicas.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/fichasTecnicasController.js src/routes/produtos.js tests/routes/fichasTecnicas.test.js
git commit -m "$(cat <<'EOF'
feat: rotas de ficha técnica em /produtos/:id/ficha-tecnica

Escrita e leitura: admin + estoquista (custo escondido da estoquista).
Histórico: admin only. Vendedor recebe 403 em tudo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 6: `producoesRepository`

This is the core of the module. Model it directly on `comprasRepository.js` (Task-adjacent file already read in full during planning): single transaction, `estoqueRepository.criarMovimentacao` reused for every stock change, `executarComLock` reused for the irregular cancel-with-side-effects case (same shape as `vendasRepository.cancelar`).

**Files:**
- Create: `src/repositories/producoesRepository.js`
- Test: `tests/repositories/producoesRepository.test.js`

**Interfaces:**
- Consumes: `estoqueRepository.criarMovimentacao` (existing, signature `({ produto_id, tipo, quantidade, motivo, usuario_id, empresa_id }, clienteExterno) → { movimentacao } | { erro }`), `executarComLock` from `src/repositories/shared/transacoes.js` (existing).
- Produces:
  - `criar({ produto_id, quantidade_solicitada, usuario_id, empresa_id }) → producao row + { itens: undefined }` (raises `AppError` 404/400/409 as below)
  - `listarPaginado({ limit, offset, produto_id, dataDe, dataAte, empresa_id }) → { items, total }`
  - `buscarPorId(id, empresa_id) → { ...producao, produto_nome, produto_sku, itens: [{ insumo_produto_id, insumo_nome, quantidade_necessaria, quantidade_consumida, custo_unitario, subtotal_custo }], custo_total } | null`
  - `cancelar(id, usuario_id, empresa_id) → producao row with status 'cancelada'`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/repositories/producoesRepository.test.js
jest.mock('../../src/config/db');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/repositories/shared/transacoes');

const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const { executarComLock } = require('../../src/repositories/shared/transacoes');
const producoesRepository = require('../../src/repositories/producoesRepository');
const AppError = require('../../src/errors/AppError');

function makeFakeClient({
  produto = { existe: true, tipo: 'acabado', ativo: true },
  ficha = { existe: true, id: 20 },
  itensFicha = [],
  estoqueInsumos = {},
  producaoInsert = { id: 100 }
} = {}) {
  const client = { query: jest.fn(), release: jest.fn() };

  client.query.mockImplementation((sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});

    if (sql.includes('SELECT id, tipo, ativo FROM produtos WHERE id = $1 AND empresa_id = $2')) {
      return Promise.resolve({ rows: produto.existe === false ? [] : [{ id: params[0], tipo: produto.tipo, ativo: produto.ativo }] });
    }

    if (sql.includes("FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true")) {
      return Promise.resolve({ rows: ficha.existe === false ? [] : [{ id: ficha.id }] });
    }

    if (sql.includes('FROM itens_ficha_tecnica WHERE ficha_tecnica_id = $1')) {
      return Promise.resolve({ rows: itensFicha });
    }

    if (sql.includes('FOR UPDATE') && sql.includes('WHERE id = ANY(')) {
      const ids = params[0];
      return Promise.resolve({ rows: ids.map((id) => ({ id, estoque_atual: estoqueInsumos[id] ?? 0 })) });
    }

    if (sql.includes('INSERT INTO producoes')) {
      return Promise.resolve({ rows: [{ id: producaoInsert.id, empresa_id: params[0], produto_id: params[1], ficha_tecnica_id: params[2], quantidade_solicitada: params[3], quantidade_produzida: params[4], status: 'concluida' }] });
    }

    return Promise.resolve({ rows: [] });
  });

  return client;
}

beforeEach(() => jest.clearAllMocks());

describe('criar', () => {
  test('throws 400 when produto is not tipo acabado', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ produto: { existe: true, tipo: 'insumo', ativo: true } }));

    await expect(producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 5, usuario_id: 1, empresa_id: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('throws 400 when produto has no ficha técnica vigente', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({ ficha: { existe: false } }));

    await expect(producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 5, usuario_id: 1, empresa_id: 1 }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('ficha técnica') });
  });

  test('produces the full quantidade_solicitada when stock is sufficient for every insumo', async () => {
    const fakeClient = makeFakeClient({
      itensFicha: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }, { insumo_produto_id: 3, quantidade_necessaria: 1 }],
      estoqueInsumos: { 2: 100, 3: 100 }
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const producao = await producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 10, usuario_id: 1, empresa_id: 1 });

    expect(producao.quantidade_produzida).toBe(10);
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 2, tipo: 'saida', quantidade: 20 }), fakeClient
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledWith(
      expect.objectContaining({ produto_id: 1, tipo: 'entrada', quantidade: 10 }), fakeClient
    );
  });

  test('produces a partial quantidade when one insumo is the bottleneck', async () => {
    db.connect = jest.fn().mockResolvedValue(makeFakeClient({
      itensFicha: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }],
      estoqueInsumos: { 2: 12 } // só dá pra fazer 6 (12/2), mesmo pedindo 10
    }));
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const producao = await producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 10, usuario_id: 1, empresa_id: 1 });

    expect(producao.quantidade_produzida).toBe(6);
  });

  test('throws 409 and never inserts a producao row when no insumo has stock for even 1 unit', async () => {
    const fakeClient = makeFakeClient({
      itensFicha: [{ insumo_produto_id: 2, quantidade_necessaria: 5 }],
      estoqueInsumos: { 2: 3 } // floor(3/5) = 0
    });
    db.connect = jest.fn().mockResolvedValue(fakeClient);

    await expect(producoesRepository.criar({ produto_id: 1, quantidade_solicitada: 10, usuario_id: 1, empresa_id: 1 }))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(fakeClient.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO producoes'), expect.anything());
    expect(estoqueRepository.criarMovimentacao).not.toHaveBeenCalled();
  });
});

describe('cancelar', () => {
  test('returns 404 when producao does not exist', async () => {
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) => callback(null, {}));

    await expect(producoesRepository.cancelar(1, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('returns 409 when producao is already cancelada', async () => {
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) =>
      callback({ id: 1, status: 'cancelada' }, {})
    );

    await expect(producoesRepository.cancelar(1, 1, 1)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('returns 409 without touching insumos when acabado stock cannot absorb the estorno saída', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] }) };
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) =>
      callback({ id: 1, status: 'concluida', produto_id: 1, quantidade_produzida: 5, ficha_tecnica_id: 20 }, client)
    );
    estoqueRepository.criarMovimentacao.mockResolvedValueOnce({ erro: 'ESTOQUE_INSUFICIENTE' });

    await expect(producoesRepository.cancelar(1, 1, 1)).rejects.toMatchObject({ statusCode: 409 });
    expect(estoqueRepository.criarMovimentacao).toHaveBeenCalledTimes(1); // só tentou o acabado, nunca chegou nos insumos
  });

  test('estorna saída do acabado e entrada de cada insumo, então marca cancelada', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'cancelada' }] })
    };
    executarComLock.mockImplementation(async (tabela, filtro, empresaId, clienteExterno, callback) =>
      callback({ id: 1, status: 'concluida', produto_id: 1, quantidade_produzida: 5, ficha_tecnica_id: 20 }, client)
    );
    estoqueRepository.criarMovimentacao.mockResolvedValue({ movimentacao: { id: 1 } });

    const result = await producoesRepository.cancelar(1, 7, 1);

    expect(result.status).toBe('cancelada');
    expect(estoqueRepository.criarMovimentacao).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ produto_id: 1, tipo: 'saida', quantidade: 5 }), client
    );
    expect(estoqueRepository.criarMovimentacao).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ produto_id: 2, tipo: 'entrada', quantidade: 10 }), client // 2 * 5
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/repositories/producoesRepository.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```javascript
// src/repositories/producoesRepository.js
const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const { executarComLock } = require('./shared/transacoes');
const AppError = require('../errors/AppError');

// Uma única transação: valida produto (tipo 'acabado', ativo) e a existência
// de uma ficha técnica vigente pra ele; trava (FOR UPDATE) o estoque de cada
// insumo envolvido numa única query antes de decidir quanto dá pra produzir
// — precisa ser uma leitura travada separada de estoqueRepository.
// criarMovimentacao porque a decisão (quantidade_produzida) tem que ser
// tomada ANTES de qualquer baixa de estoque acontecer, e criarMovimentacao já
// escreve a baixa no mesmo passo em que lê. Cada insumo limita
// quantidade_produzida a floor(estoque_atual / quantidade_necessaria); o
// mínimo entre todos os insumos e quantidade_solicitada vence. 0 producido
// bloqueia com 409 e não cria nada (nem a linha producoes, nem movimentação
// nenhuma) — só dali em diante é que estoqueRepository.criarMovimentacao
// entra pra realmente gravar saída dos insumos e entrada do acabado.
async function criar({ produto_id, quantidade_solicitada, usuario_id, empresa_id }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, tipo, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            throw new AppError('Produto não encontrado', 404);
        }

        if (produtoRows[0].tipo !== 'acabado') {
            throw new AppError("Produto deve ser do tipo 'acabado' para ser produzido", 400);
        }

        if (!produtoRows[0].ativo) {
            throw new AppError('Produto inativo não pode receber movimentações de estoque', 400);
        }

        const { rows: fichaRows } = await client.query(
            'SELECT id FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
            [produto_id, empresa_id]
        );

        if (!fichaRows.length) {
            throw new AppError('Produto não possui ficha técnica cadastrada', 400);
        }

        const ficha_tecnica_id = fichaRows[0].id;

        const { rows: itensFicha } = await client.query(
            'SELECT insumo_produto_id, quantidade_necessaria FROM itens_ficha_tecnica WHERE ficha_tecnica_id = $1 ORDER BY id',
            [ficha_tecnica_id]
        );

        const insumoIds = itensFicha.map((item) => item.insumo_produto_id);

        const { rows: estoqueRows } = await client.query(
            'SELECT id, estoque_atual FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2 FOR UPDATE',
            [insumoIds, empresa_id]
        );

        const estoquePorInsumo = new Map(estoqueRows.map((row) => [row.id, row.estoque_atual]));

        let quantidade_produzida = quantidade_solicitada;

        for (const item of itensFicha) {
            const estoqueAtual = estoquePorInsumo.get(item.insumo_produto_id) ?? 0;
            const possivel = Math.floor(estoqueAtual / item.quantidade_necessaria);
            quantidade_produzida = Math.min(quantidade_produzida, possivel);
        }

        quantidade_produzida = Math.max(0, quantidade_produzida);

        if (quantidade_produzida === 0) {
            throw new AppError('Estoque insuficiente para produzir ao menos uma unidade', 409);
        }

        const { rows: producaoRows } = await client.query(
            `INSERT INTO producoes (empresa_id, produto_id, ficha_tecnica_id, quantidade_solicitada, quantidade_produzida, status, usuario_id)
             VALUES ($1, $2, $3, $4, $5, 'concluida', $6)
             RETURNING *`,
            [empresa_id, produto_id, ficha_tecnica_id, quantidade_solicitada, quantidade_produzida, usuario_id]
        );

        const producao = producaoRows[0];

        for (const item of itensFicha) {
            await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.insumo_produto_id,
                    tipo: 'saida',
                    quantidade: item.quantidade_necessaria * quantidade_produzida,
                    motivo: `Produção #${producao.id}`,
                    usuario_id,
                    empresa_id
                },
                client
            );
        }

        await estoqueRepository.criarMovimentacao(
            {
                produto_id,
                tipo: 'entrada',
                quantidade: quantidade_produzida,
                motivo: `Produção #${producao.id}`,
                usuario_id,
                empresa_id
            },
            client
        );

        await client.query('COMMIT');

        return { ...producao, parcial: quantidade_produzida < quantidade_solicitada };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listarPaginado({ limit, offset, produto_id, dataDe, dataAte, empresa_id }) {
    const condicoes = ['pr.empresa_id = $1'];
    const valores = [empresa_id];

    if (produto_id !== undefined) {
        valores.push(produto_id);
        condicoes.push(`pr.produto_id = $${valores.length}`);
    }

    if (dataDe !== undefined) {
        valores.push(dataDe);
        condicoes.push(`pr.criado_em::date >= $${valores.length}`);
    }

    if (dataAte !== undefined) {
        valores.push(dataAte);
        condicoes.push(`pr.criado_em::date <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT pr.*, p.nome AS produto_nome
         FROM producoes pr
         JOIN produtos p ON p.id = pr.produto_id
         ${where}
         ORDER BY pr.criado_em DESC, pr.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM producoes pr ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT pr.*, p.nome AS produto_nome, p.sku AS produto_sku
         FROM producoes pr
         JOIN produtos p ON p.id = pr.produto_id
         WHERE pr.id = $1 AND pr.empresa_id = $2`,
        [id, empresa_id]
    );

    if (!rows.length) return null;

    const producao = rows[0];

    const { rows: itensRows } = await db.query(
        `SELECT itf.insumo_produto_id, itf.quantidade_necessaria, p.nome AS insumo_nome, p.custo AS custo_unitario
         FROM itens_ficha_tecnica itf
         JOIN produtos p ON p.id = itf.insumo_produto_id
         WHERE itf.ficha_tecnica_id = $1
         ORDER BY itf.id`,
        [producao.ficha_tecnica_id]
    );

    let custo_total = 0;

    const itens = itensRows.map((item) => {
        const quantidade_consumida = item.quantidade_necessaria * producao.quantidade_produzida;
        const custo_unitario = Number(item.custo_unitario);
        const subtotal_custo = Number((quantidade_consumida * custo_unitario).toFixed(2));
        custo_total += subtotal_custo;

        return {
            insumo_produto_id: item.insumo_produto_id,
            insumo_nome: item.insumo_nome,
            quantidade_necessaria: item.quantidade_necessaria,
            quantidade_consumida,
            custo_unitario,
            subtotal_custo
        };
    });

    return { ...producao, itens, custo_total: Number(custo_total.toFixed(2)) };
}

// Estorna: saída do acabado primeiro (se não houver estoque suficiente —
// ex: já foi vendido — bloqueia 409 SEM tocar nos insumos, mesma regra de
// estoque negativo que já existe em estoqueRepository.criarMovimentacao),
// depois entrada de volta em cada insumo (proporcional a
// quantidade_produzida, não quantidade_solicitada — é o que de fato saiu do
// estoque). Usa executarComLock direto (não transicionarStatus) porque há
// efeitos colaterais entre o lock e a escrita final, mesmo padrão de
// vendasRepository.cancelar.
async function cancelar(id, usuario_id, empresa_id) {
    return executarComLock('producoes', { coluna: 'id', valor: id }, empresa_id, undefined, async (producao, client) => {
        if (!producao) {
            throw new AppError('Produção não encontrada', 404);
        }

        if (producao.status !== 'concluida') {
            throw new AppError('Somente produções concluídas podem ser canceladas', 409);
        }

        const resultadoAcabado = await estoqueRepository.criarMovimentacao(
            {
                produto_id: producao.produto_id,
                tipo: 'saida',
                quantidade: producao.quantidade_produzida,
                motivo: `Cancelamento produção #${producao.id}`,
                usuario_id,
                empresa_id
            },
            client
        );

        if (resultadoAcabado.erro === 'ESTOQUE_INSUFICIENTE') {
            throw new AppError('Estoque insuficiente para estornar esta produção', 409);
        }

        const { rows: itensRows } = await client.query(
            'SELECT insumo_produto_id, quantidade_necessaria FROM itens_ficha_tecnica WHERE ficha_tecnica_id = $1',
            [producao.ficha_tecnica_id]
        );

        for (const item of itensRows) {
            await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.insumo_produto_id,
                    tipo: 'entrada',
                    quantidade: item.quantidade_necessaria * producao.quantidade_produzida,
                    motivo: `Cancelamento produção #${producao.id}`,
                    usuario_id,
                    empresa_id
                },
                client
            );
        }

        const { rows: atualizadaRows } = await client.query(
            `UPDATE producoes SET status = 'cancelada', atualizado_em = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );

        return atualizadaRows[0];
    });
}

module.exports = {
    criar,
    listarPaginado,
    buscarPorId,
    cancelar
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/repositories/producoesRepository.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/producoesRepository.js tests/repositories/producoesRepository.test.js
git commit -m "$(cat <<'EOF'
feat: repository de produções (consumo de insumos, parcial/bloqueio, cancelamento com estorno)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 7: `producoesValidation` + `producoesService`

**Files:**
- Create: `src/validations/producoesValidation.js`
- Create: `src/services/producoesService.js`
- Test: `tests/services/producoesService.test.js`

**Interfaces:**
- Consumes: `producoesRepository` (Task 6), `AppError`.
- Produces: `criarProducaoSchema`, `listarProducoesSchema`; `producoesService.{criar, listar, buscarPorId, cancelar}` (same shape as `comprasService`).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/services/producoesService.test.js
jest.mock('../../src/repositories/producoesRepository');

const producoesRepository = require('../../src/repositories/producoesRepository');
const producoesService = require('../../src/services/producoesService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => jest.clearAllMocks());

describe('criar', () => {
  test('attaches usuario_id and empresa_id and delegates to the repository', async () => {
    producoesRepository.criar.mockResolvedValue({ id: 1, quantidade_produzida: 10, parcial: false });

    const result = await producoesService.criar({ produto_id: 5, quantidade_solicitada: 10 }, 7, 9);

    expect(producoesRepository.criar).toHaveBeenCalledWith({ produto_id: 5, quantidade_solicitada: 10, usuario_id: 7, empresa_id: 9 });
    expect(result.id).toBe(1);
  });

  test('propagates the 409 thrown when there is no stock for even 1 unit', async () => {
    producoesRepository.criar.mockRejectedValue(new AppError('Estoque insuficiente para produzir ao menos uma unidade', 409));

    await expect(producoesService.criar({ produto_id: 5, quantidade_solicitada: 10 }, 7, 9))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('listar', () => {
  test('paginates and forwards filters to the repository', async () => {
    producoesRepository.listarPaginado.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await producoesService.listar({ page: 1, pageSize: 20, produto_id: 5 }, 9);

    expect(producoesRepository.listarPaginado).toHaveBeenCalledWith({
      limit: 20, offset: 0, produto_id: 5, dataDe: undefined, dataAte: undefined, empresa_id: 9
    });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });
});

describe('buscarPorId', () => {
  test('throws 404 when the producao does not exist', async () => {
    producoesRepository.buscarPorId.mockResolvedValue(null);

    await expect(producoesService.buscarPorId(999, 9)).rejects.toMatchObject({ statusCode: 404, message: 'Produção não encontrada' });
  });

  test('returns the producao when found', async () => {
    producoesRepository.buscarPorId.mockResolvedValue({ id: 1, custo_total: 40 });

    const result = await producoesService.buscarPorId(1, 9);
    expect(result.custo_total).toBe(40);
  });
});

describe('cancelar', () => {
  test('delegates the guarded cancellation to the repository', async () => {
    producoesRepository.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });

    const result = await producoesService.cancelar(1, 7, 9);

    expect(producoesRepository.cancelar).toHaveBeenCalledWith(1, 7, 9);
    expect(result.status).toBe('cancelada');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/services/producoesService.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```javascript
// src/validations/producoesValidation.js
const { z } = require('zod');

const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const criarProducaoSchema = z.object({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
    quantidade_solicitada: z.coerce.number({ error: 'Quantidade solicitada deve ser maior que zero' }).int('Quantidade solicitada deve ser maior que zero').positive('Quantidade solicitada deve ser maior que zero')
}).strict();

const listarProducoesSchema = z.object({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido').optional(),
    data_de: dataISO('Data inicial inválida').optional(),
    data_ate: dataISO('Data final inválida').optional()
});

module.exports = { criarProducaoSchema, listarProducoesSchema };
```

```javascript
// src/services/producoesService.js
const producoesRepository = require('../repositories/producoesRepository');
const AppError = require('../errors/AppError');

async function criar(dados, usuarioId, empresaId) {
    return producoesRepository.criar({ ...dados, usuario_id: usuarioId, empresa_id: empresaId });
}

async function listar({ page, pageSize, produto_id, dataDe, dataAte }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await producoesRepository.listarPaginado({
        limit, offset, produto_id, dataDe, dataAte, empresa_id: empresaId
    });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, empresaId) {
    const producao = await producoesRepository.buscarPorId(id, empresaId);

    if (!producao) {
        throw new AppError('Produção não encontrada', 404);
    }

    return producao;
}

async function cancelar(id, usuarioId, empresaId) {
    return producoesRepository.cancelar(id, usuarioId, empresaId);
}

module.exports = { criar, listar, buscarPorId, cancelar };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/services/producoesService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validations/producoesValidation.js src/services/producoesService.js tests/services/producoesService.test.js
git commit -m "$(cat <<'EOF'
feat: validation e service de produções

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 8: `producoesController` + `/producoes` routes + `app.js` mount

**Files:**
- Create: `src/controllers/producoesController.js`
- Create: `src/routes/producoes.js`
- Modify: `src/app.js`
- Test: `tests/routes/producoes.test.js`

**Interfaces:**
- Consumes: `producoesService` (Task 7), `authMiddleware`, `requireEstoquista` (existing).
- Produces: `GET/POST /producoes`, `GET /producoes/:id`, `PATCH /producoes/:id/cancelar` — vendedor 403 on all (mount-level, like `/compras`).

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/routes/producoes.test.js
jest.mock('../../src/services/producoesService');

const request = require('supertest');
const producoesService = require('../../src/services/producoesService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => jest.clearAllMocks());

describe('access control (admin + estoquista only)', () => {
  const requests = [
    ['get', '/producoes'],
    ['post', '/producoes'],
    ['get', '/producoes/1'],
    ['patch', '/producoes/1/cancelar']
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

describe('POST /producoes', () => {
  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 1 });

    expect(res.status).toBe(400);
    expect(producoesService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 with a full quantidade_produzida for an admin', async () => {
    producoesService.criar.mockResolvedValue({ id: 1, quantidade_solicitada: 10, quantidade_produzida: 10, parcial: false });

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data.parcial).toBe(false);
  });

  test('returns 201 flagged parcial for an estoquista when stock only allows part of it', async () => {
    producoesService.criar.mockResolvedValue({ id: 1, quantidade_solicitada: 10, quantidade_produzida: 6, parcial: true });

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data.quantidade_produzida).toBe(6);
    expect(res.body.data.parcial).toBe(true);
  });

  test('returns 409 when no insumo has stock for even 1 unit', async () => {
    producoesService.criar.mockRejectedValue(new AppError('Estoque insuficiente para produzir ao menos uma unidade', 409));

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(409);
  });

  test('returns 400 when the produto has no ficha técnica cadastrada', async () => {
    producoesService.criar.mockRejectedValue(new AppError('Produto não possui ficha técnica cadastrada', 400));

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(400);
  });
});

describe('GET /producoes/:id', () => {
  test('returns 404 when the producao does not exist (or belongs to another empresa)', async () => {
    producoesService.buscarPorId.mockRejectedValue(new AppError('Produção não encontrada', 404));

    const res = await request(app).get('/producoes/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with custo_total visible for an admin', async () => {
    producoesService.buscarPorId.mockResolvedValue({
      id: 1, produto_id: 5, custo_total: 60,
      itens: [{ insumo_produto_id: 2, custo_unitario: 10, subtotal_custo: 60 }]
    });

    const res = await request(app).get('/producoes/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.custo_total).toBe(60);
  });

  test('returns 200 with custo_total and item custo hidden for an estoquista', async () => {
    producoesService.buscarPorId.mockResolvedValue({
      id: 1, produto_id: 5, custo_total: 60,
      itens: [{ insumo_produto_id: 2, custo_unitario: 10, subtotal_custo: 60 }]
    });

    const res = await request(app).get('/producoes/1').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.custo_total).toBeUndefined();
    expect(res.body.data.itens[0].custo_unitario).toBeUndefined();
    expect(res.body.data.itens[0].insumo_produto_id).toBe(2);
  });
});

describe('PATCH /producoes/:id/cancelar', () => {
  test('returns 200 and cancels for an admin', async () => {
    producoesService.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });

    const res = await request(app).patch('/producoes/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelada');
  });

  test('returns 409 when the acabado stock cannot absorb the estorno', async () => {
    producoesService.cancelar.mockRejectedValue(new AppError('Estoque insuficiente para estornar esta produção', 409));

    const res = await request(app).patch('/producoes/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/routes/producoes.test.js`
Expected: FAIL (route not mounted yet).

- [ ] **Step 3: Implement**

```javascript
// src/controllers/producoesController.js
const producoesService = require('../services/producoesService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarProducaoSchema, listarProducoesSchema } = require('../validations/producoesValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

function parsePaginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;

    return { page, pageSize };
}

// A estoquista nunca vê o custo total consumido nem o custo unitário de cada
// insumo — mesmo filtro de fichasTecnicasController.filtrarCustoParaRole.
function filtrarCustoParaRole(producao, role) {
    if (role === 'admin') return producao;

    const { custo_total, itens, ...resto } = producao;

    return {
        ...resto,
        ...(itens && { itens: itens.map(({ custo_unitario, subtotal_custo, ...item }) => item) })
    };
}

async function criar(req, res, next) {
    try {
        const parsed = criarProducaoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const producao = await producoesService.criar(parsed.data, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, producao, 201);
    } catch (error) {
        next(error);
    }
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);

        const parsedFiltros = listarProducoesSchema.safeParse({
            produto_id: req.query.produto_id,
            data_de: req.query.data_de,
            data_ate: req.query.data_ate
        });

        if (!parsedFiltros.success) {
            throw new AppError(parsedFiltros.error.issues[0].message, 400);
        }

        const resultado = await producoesService.listar({
            ...paginacao,
            produto_id: parsedFiltros.data.produto_id,
            dataDe: parsedFiltros.data.data_de,
            dataAte: parsedFiltros.data.data_ate
        }, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const producao = await producoesService.buscarPorId(id, req.usuario.empresa_id);

        return response.success(res, filtrarCustoParaRole(producao, req.usuario.role));
    } catch (error) {
        next(error);
    }
}

async function cancelar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const producao = await producoesService.cancelar(id, req.usuario.id, req.usuario.empresa_id);

        return response.success(res, producao);
    } catch (error) {
        next(error);
    }
}

module.exports = { criar, listar, buscarPorId, cancelar };
```

```javascript
// src/routes/producoes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/producoesController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.get('/:id', controller.buscarPorId);
router.patch('/:id/cancelar', controller.cancelar);

module.exports = router;
```

In `src/app.js`, add near the `comprasRoutes` import/mount:

```javascript
const producoesRoutes = require('./routes/producoes');
```

```javascript
app.use('/producoes', authMiddleware, requireEstoquista, producoesRoutes);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/routes/producoes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/producoesController.js src/routes/producoes.js src/app.js tests/routes/producoes.test.js
git commit -m "$(cat <<'EOF'
feat: rotas de produções em /producoes

Escrita e leitura: admin + estoquista (custo total/unitário escondido
da estoquista, mesmo padrão de ficha técnica). Vendedor recebe 403 em
tudo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

---

### Task 9: Full suite run + final check

**Files:** none created — verification only.

- [ ] **Step 1: Run the entire test suite once**

Run: `npm test`
Expected: every test passes, including the pre-existing suites for `produtos`, `estoque`, `compras`, `vendas`, `dashboard` (zero regression) and all the new files from Tasks 2–8.

- [ ] **Step 2: If anything regressed, fix it in place (do not re-run unrelated suites you already confirmed green)**

Re-run only the specific failing file(s) with `npx jest <path>` until green, then re-run `npm test` once more to confirm the whole suite is clean.

- [ ] **Step 3: Confirm `schema.sql` and `013_producao.sql` agree**

Run: `diff <(grep -A2 'CREATE TABLE fichas_tecnicas\|CREATE TABLE itens_ficha_tecnica\|CREATE TABLE producoes' src/database/migrations/013_producao.sql) <(grep -A2 'CREATE TABLE fichas_tecnicas\|CREATE TABLE itens_ficha_tecnica\|CREATE TABLE producoes' src/database/schema.sql)`

This is a sanity spot-check, not a strict requirement to match line-for-line (the migration has `IF NOT EXISTS`, the schema snapshot doesn't) — just confirm no column was added to one and forgotten in the other.

- [ ] **Step 4: Final commit if Step 2 produced any fixes**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: ajustes finais pós-suíte completa do módulo de produção

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcMEa4AUWv2sFKuQ7SN6c1
EOF
)"
```

(Skip this commit entirely if Step 1 was already green with no fixes needed.)

---

## What this plan deliberately leaves out (per the session's brief)

- No `git push` — commits only, per every task above and per the session rule "NUNCA faça push sem eu pedir explicitamente."
- No isolation test added to `tests/routes/multiTenantIsolation.test.js` — that file currently has zero references to `compras` or `fornecedores` either (confirmed by grep before writing this plan), so extending it is not this module's established precedent. Cross-tenant 404 behavior is instead covered at the repository/route unit-test level in Tasks 3, 6, 5 and 8, matching how `compras`/`fornecedores` actually test it today.
- Fase B (Compras ligadas a fornecedor de insumo) already exists independently; this plan does not touch it.
- `produtos.fornecedor` / `fornecedor_id` linkage is untouched, same as the fornecedores module's own note in `CLAUDE.md`.

# Categorias de Produto + SKU Automático Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable, per-empresa product categories (with `nivel`/`codigo`/`nome`) and automatic, immutable SKU generation from the combination of categories assigned to a product, with an atomic per-combination sequence that never collides even across soft-delete + código reuse.

**Architecture:** Two new tables (`categorias_produto`, `sequencias_sku`) plus a link table (`produtos_categorias`). A small pure `skuService` module formats the SKU string and orchestrates an atomic upsert-based counter (`sequenciasSkuRepository`) keyed on **código text**, not category id, to prevent the collision described in the design spec. A new `categoriasService` module owns category CRUD. `produtosService.categorizar` ties it together: link the product to categories, generate the SKU once (immutably) if none exists yet.

**Tech Stack:** Node.js, Express, PostgreSQL (`pg`), Zod, Jest, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-12-categorias-sku-design.md` — this plan implements that spec; read both.

## Global Constraints

- Every new table has `empresa_id` (FK NOT NULL, indexed); every new query filters by it — never trust a resource id alone.
- API responses are always `{ success: true, data }` or `{ success: false, message }`.
- HTTP codes: 400 validation, 401 no/invalid token, 403 role without permission, 404 not found, 409 business-rule conflict, 500 unexpected.
- Route names, columns, fields: Portuguese, no accents, snake_case. Timestamps are `criado_em`/`atualizado_em`.
- `sku`, once written to `produtos.sku`, is never rewritten by any code path — enforced in the service/repository layer, not just the UI.
- `categorias_produto.codigo` and `.nivel` are immutable after creation — only `nome` is editable via `PUT /categorias/:id`; sending `codigo`/`nivel` in that body is a 400, not a silent strip.
- The sequence key (`sequencias_sku.chave_combinacao`) is the **texto** of the categories' códigos (uppercased, ordered by nível), never the category `id` — this is the fix for the collision described in the spec's "Análise de colisão" section.
- `PATCH /produtos/:id/categoria` and all of `/categorias` are `admin`+`estoquista` (`requireEstoquista` middleware); `vendedor` gets 403.
- Every new endpoint's tests cover the three roles (allowed, denied, edge case), per project convention.
- Run the full test suite once at the end of the plan, not after every task.

---

## File Structure

New files:
- `src/database/migrations/019_categorias_produto.sql`
- `src/repositories/categoriasRepository.js`, `src/services/categoriasService.js`, `src/controllers/categoriasController.js`, `src/validations/categoriasValidation.js`, `src/routes/categorias.js`
- `src/repositories/sequenciasSkuRepository.js`, `src/services/skuService.js`
- `tests/repositories/categoriasRepository.test.js`, `tests/services/categoriasService.test.js`, `tests/validations/categoriasValidation.test.js`, `tests/routes/categorias.test.js`
- `tests/repositories/sequenciasSkuRepository.test.js`, `tests/services/skuService.test.js`

Modified files:
- `schema.sql` — mirror the migration
- `src/app.js` — mount `/categorias`
- `src/repositories/produtosRepository.js` — remove dead `buscarPorSku`; add category-link + SKU-write functions; `sku ?? null` in `criar`
- `src/services/produtosService.js` — remove manual-SKU duplicate checks; add `categorizar`; include `categorias` in `buscarPorId`/`listar`
- `src/validations/produtosValidation.js` — remove `sku` from create/update schemas; add `categorizarProdutoSchema`
- `src/controllers/produtosController.js` — add `categorizar` handler
- `src/routes/produtos.js` — add `PATCH /:id/categoria`
- `tests/repositories/produtosRepository.test.js`, `tests/services/produtosService.test.js`, `tests/routes/produtos.test.js` — updated/added cases
- `CLAUDE.md` — deprecation note for `produtos.categoria`, reversal note for the migration-007 global-SKU-uniqueness decision, closed SKU-format rule, module entry

---

### Task 1: Migration 019 + schema.sql + CLAUDE.md schema notes

**Files:**
- Create: `src/database/migrations/019_categorias_produto.sql`
- Modify: `schema.sql`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: tables `categorias_produto(id, empresa_id, nivel, codigo, nome, criado_em, atualizado_em, deletado_em)`, `produtos_categorias(produto_id, categoria_id, empresa_id)`, `sequencias_sku(id, empresa_id, chave_combinacao, contador)`; `produtos.sku` nullable with partial unique `(empresa_id, sku) WHERE sku IS NOT NULL`, old global `produtos_sku_key` constraint dropped.

- [ ] **Step 1: Write the migration**

Verified against the dev DB: `produtos.sku` is already `is_nullable = YES` (migration 002 never added `NOT NULL`), and the existing global unique constraint is named `produtos_sku_key`. No `DROP NOT NULL` is needed; only the constraint swap.

```sql
-- Categorias de produto configuráveis por empresa (nível = posição no SKU,
-- ex.: nível 1 = família, nível 2 = material) + geração automática de SKU.
-- Ver docs/superpowers/specs/2026-09-12-categorias-sku-design.md.

CREATE TABLE IF NOT EXISTS categorias_produto (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nivel INTEGER NOT NULL CHECK (nivel > 0),
    codigo VARCHAR(3) NOT NULL,
    nome VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    deletado_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categorias_produto_empresa_id ON categorias_produto(empresa_id);

-- Único por (empresa, nível, código em maiúsculas) entre categorias ativas.
-- Código PODE ser reaproveitado depois que a categoria antiga é soft-deletada
-- — seguro porque a sequência de SKU (ver sequencias_sku) é ancorada no TEXTO
-- do código, não no id: uma categoria nova com o mesmo código continua a
-- mesma sequência em vez de reiniciar e colidir. codigo/nivel são imutáveis
-- após a criação (aplicação, não constraint) — exatamente para não reabrir
-- esse mesmo risco de colisão por edição.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_produto_codigo_unico
    ON categorias_produto (empresa_id, nivel, UPPER(codigo))
    WHERE deletado_em IS NULL;

-- Vínculo produto <-> categoria. Tabela de junção necessária porque o número
-- de níveis é configurável por empresa (não fixo) — não dá pra representar
-- isso com colunas fixas categoria_nivel1_id/categoria_nivel2_id em produtos.
-- Deletar uma categoria (soft delete) NÃO apaga vínculos existentes nem afeta
-- SKUs já gerados.
CREATE TABLE IF NOT EXISTS produtos_categorias (
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    categoria_id INTEGER NOT NULL REFERENCES categorias_produto(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    PRIMARY KEY (produto_id, categoria_id)
);

CREATE INDEX IF NOT EXISTS idx_produtos_categorias_produto_id ON produtos_categorias(produto_id);

-- Contador atômico por combinação de códigos de categoria, isolado por
-- empresa. chave_combinacao = códigos das categorias atribuídas (maiúsculo),
-- ordenados por nível ascendente, unidos por "-" (ex.: "BR-01"). Upsert
-- (INSERT ... ON CONFLICT DO UPDATE) garante atomicidade sem lock explícito.
CREATE TABLE IF NOT EXISTS sequencias_sku (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    chave_combinacao VARCHAR(255) NOT NULL,
    contador INTEGER NOT NULL DEFAULT 0,
    UNIQUE (empresa_id, chave_combinacao)
);

-- sku deixa de ser único GLOBALMENTE e vira único POR EMPRESA (nullable já
-- era o caso — migration 002 nunca adicionou NOT NULL). Isso reverte,
-- deliberadamente, a decisão preservada na migration 007 ("produtos.sku
-- continua único globalmente, não por empresa") — motivo documentado no
-- CLAUDE.md: com SKU sempre gerado a partir de uma sequência isolada por
-- empresa, manter unicidade global bloquearia uma empresa de gerar um SKU só
-- porque outra empresa, sem nenhuma relação, gerou o mesmo texto antes.
ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_sku_unico
    ON produtos (empresa_id, sku)
    WHERE sku IS NOT NULL;

COMMENT ON COLUMN produtos.categoria IS
    'Deprecado: campo de texto livre substituído pela categorização estruturada (categorias_produto/produtos_categorias). Não ler nem escrever em código novo. Remoção planejada para uma etapa futura, antes do carregamento do catálogo real.';
```

- [ ] **Step 2: Mirror the change in `schema.sql`**

Add the three `CREATE TABLE`/index blocks above (identical SQL) to `schema.sql` in the position matching its existing table ordering (after the `produtos` block), and apply the same `produtos.sku` constraint swap + column comment to `schema.sql`'s `produtos` table definition.

- [ ] **Step 3: Apply the migration to the dev database**

```bash
node -e "require('dotenv').config({quiet:true});const fs=require('fs');const db=require('./src/config/db');fs.promises.readFile('src/database/migrations/019_categorias_produto.sql','utf8').then(sql=>db.query(sql)).then(()=>{console.log('Migration 019 aplicada');process.exit(0);}).catch(e=>{console.error(e);process.exit(1);});"
```

Expected: prints `Migration 019 aplicada`, exit code 0.

- [ ] **Step 4: Verify the schema landed correctly**

```bash
node -e "require('dotenv').config({quiet:true});const db=require('./src/config/db');Promise.all([db.query(\"SELECT conname FROM pg_constraint WHERE conrelid='produtos'::regclass AND contype='u'\"),db.query(\"SELECT indexname FROM pg_indexes WHERE tablename IN ('categorias_produto','produtos_categorias','sequencias_sku','produtos') AND indexname LIKE '%sku%' OR indexname LIKE '%categoria%'\")]).then(([a,b])=>{console.log(JSON.stringify(a.rows));console.log(JSON.stringify(b.rows));process.exit(0);}).catch(e=>{console.error(e);process.exit(1);});"
```

Expected: `produtos_sku_key` is gone from the first result; `idx_produtos_sku_unico`, `idx_categorias_produto_codigo_unico`, `idx_produtos_categorias_produto_id` appear in the second.

- [ ] **Step 5: Update `CLAUDE.md`**

In the "Regras já decididas na migração multi-tenant (não reabrir)" section, replace the bullet:

```
- **Não foram alteradas** as UNIQUE constraints existentes (`usuarios.email`, `produtos.sku`) para incluir `empresa_id` — continuam únicas globalmente, não por empresa. Isso significa que duas empresas diferentes não podem ter usuário com o mesmo email, nem produto com o mesmo SKU. Ainda é decisão de regra de negócio a confirmar antes de mudar (não reabrir sem decisão explícita).
```

with:

```
- **Não foram alteradas** as UNIQUE constraints existentes (`usuarios.email`, `produtos.sku`) para incluir `empresa_id` — continuavam únicas globalmente, não por empresa, até a migration `019_categorias_produto.sql` (2026-09-12), que tornou **`produtos.sku` único por empresa** (`(empresa_id, sku) WHERE sku IS NOT NULL`, constraint global `produtos_sku_key` removida). Motivo: SKU passou a ser gerado automaticamente por uma sequência isolada por empresa (ver módulo "Categorias de produto + SKU automático" abaixo) — manter unicidade global bloquearia uma empresa de gerar um SKU só porque outra empresa, sem relação alguma, já tinha gerado o mesmo texto. `usuarios.email` continua único globalmente, decisão não reaberta.
```

Also, in "Estado atual dos módulos", append this new line directly after the existing "**Produtos/SKUs**" bullet:

```
- **`produtos.categoria` (texto livre) está deprecado** desde a migration `019_categorias_produto.sql` — substituído pela categorização estruturada (`categorias_produto`/`produtos_categorias`, ver módulo abaixo). Não ler nem escrever esse campo em código novo; a coluna continua existindo só por compatibilidade de contrato de API, sem UI própria. Remoção planejada para antes do carregamento do catálogo real.
```

- [ ] **Step 6: Commit**

```bash
git add src/database/migrations/019_categorias_produto.sql schema.sql CLAUDE.md
git commit -m "feat(produtos): adiciona schema de categorias configuraveis e SKU automatico

Introduz categorias_produto, produtos_categorias e sequencias_sku.
produtos.sku passa a ser unico por empresa (era global desde a
migration 007) para suportar a sequencia de SKU isolada por empresa."
```

---

### Task 2: Remove manual SKU entry from produtos (validation, service, repository)

**Files:**
- Modify: `src/validations/produtosValidation.js`
- Modify: `src/services/produtosService.js`
- Modify: `src/repositories/produtosRepository.js`
- Modify: `tests/services/produtosService.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `criarProdutoSchema`/`atualizarProdutoSchema` no longer accept `sku`; `produtosRepository.criar` inserts `sku: null` when absent; `produtosRepository.buscarPorSku` removed (fully unused after this task).

- [ ] **Step 1: Remove `sku` from the product validation schemas**

In `src/validations/produtosValidation.js`, delete the `sku:` line from both `criarProdutoSchema` and `atualizarProdutoSchema`. Result:

```js
const criarProdutoSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório'),
    descricao: z.string().optional(),
    categoria: z.string().optional(),
    preco_venda: z.coerce.number({ error: 'Preço de venda é obrigatório' }).positive('Preço de venda é obrigatório'),
    custo: z.coerce.number({ error: 'Custo é obrigatório' }).positive('Custo é obrigatório'),
    estoque_atual: z.coerce.number({ error: 'Estoque atual inválido' }).int('Estoque atual inválido').nonnegative('Estoque atual inválido').optional(),
    estoque_minimo: z.coerce.number({ error: 'Estoque mínimo inválido' }).int('Estoque mínimo inválido').nonnegative('Estoque mínimo inválido').optional(),
    ativo: z.boolean().optional(),
    tipo: z.enum(['acabado', 'insumo'], { error: 'Tipo inválido' }).optional(),
    unidade: z.enum(['UN', 'PAR', 'CX', 'PCT'], { error: 'Unidade inválida' }).optional()
});

const atualizarProdutoSchema = z.object({
    nome: z.string().min(1, 'Nome é obrigatório').optional(),
    descricao: z.string().optional(),
    categoria: z.string().optional(),
    preco_venda: z.coerce.number().positive('Preço de venda deve ser maior que zero').optional(),
    custo: z.coerce.number().positive('Custo deve ser maior que zero').optional(),
    estoque_minimo: z.coerce.number().int('Estoque mínimo inválido').nonnegative('Estoque mínimo inválido').optional(),
    ativo: z.boolean().optional(),
    tipo: z.enum(['acabado', 'insumo'], { error: 'Tipo inválido' }).optional(),
    unidade: z.enum(['UN', 'PAR', 'CX', 'PCT'], { error: 'Unidade inválida' }).optional()
}).refine((data) => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para atualizar' });
```

(`sku` sent by an old client is now silently stripped by Zod's default non-strict mode, same as any other unknown field these schemas already ignore.)

- [ ] **Step 2: Remove the dead SKU-duplicate checks from `produtosService.js`**

In `criar`, replace:
```js
async function criar(dados, empresaId) {
    const existente = await produtosRepository.buscarPorSku(dados.sku, empresaId);

    if (existente) {
        throw new AppError('SKU já cadastrado', 409);
    }

    const produto = await produtosRepository.criar({ ...dados, empresa_id: empresaId });

    return comMargem(produto);
}
```
with:
```js
async function criar(dados, empresaId) {
    const produto = await produtosRepository.criar({ ...dados, empresa_id: empresaId });

    return comMargem(produto);
}
```

In `atualizar`, replace:
```js
async function atualizar(id, dados, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    if (dados.sku && dados.sku !== produto.sku) {
        const existente = await produtosRepository.buscarPorSku(dados.sku, empresaId);

        if (existente) {
            throw new AppError('SKU já cadastrado', 409);
        }
    }

    const atualizado = await produtosRepository.atualizar(id, dados, empresaId);

    return comMargem(atualizado);
}
```
with:
```js
async function atualizar(id, dados, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const atualizado = await produtosRepository.atualizar(id, dados, empresaId);

    return comMargem(atualizado);
}
```

- [ ] **Step 3: Remove the now-dead `buscarPorSku` from `produtosRepository.js`, default `sku` to null on insert**

Delete the `buscarPorSku` function and its entry in `module.exports`. In `criar`, change the values array entry `sku,` to `sku ?? null,` (matching the `?? null` style already used for `descricao`/`categoria` on the same line).

- [ ] **Step 4: Update `tests/services/produtosService.test.js` to drop the dead-behavior tests**

Replace the whole `describe('criar', ...)` block:
```js
describe('criar', () => {
  test('creates the produto and attaches margem_percentual', async () => {
    const dados = { nome: 'X', preco_venda: 10, custo: 5 };
    produtosRepository.criar.mockResolvedValue({ id: 1, ...dados });

    const result = await produtosService.criar(dados);

    expect(produtosRepository.criar).toHaveBeenCalledWith(dados);
    expect(result.margem_percentual).toBe(50);
  });
});
```

Replace the whole `describe('atualizar', ...)` block:
```js
describe('atualizar', () => {
  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.atualizar(999, { nome: 'Y' })).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test('updates the produto', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
    produtosRepository.atualizar.mockResolvedValue({ id: 1, preco_venda: '20.00', custo: '10.00' });

    const result = await produtosService.atualizar(1, { preco_venda: 20 });

    expect(result.margem_percentual).toBe(50);
  });
});
```

(Leave every other `describe` block in the file untouched at this step — `remover`, `ajustarPreco`, etc. are unaffected.)

- [ ] **Step 5: Run the affected test files**

```bash
npx jest tests/services/produtosService.test.js tests/repositories/produtosRepository.test.js tests/validations/produtosValidation.test.js
```

Expected: all pass. (No `buscarPorSku` reference remains anywhere in `tests/repositories/produtosRepository.test.js` — confirmed empty grep during planning, so nothing else to touch there.)

- [ ] **Step 6: Commit**

```bash
git add src/validations/produtosValidation.js src/services/produtosService.js src/repositories/produtosRepository.js tests/services/produtosService.test.js
git commit -m "refactor(produtos): remove entrada manual de SKU

SKU passa a ser sempre gerado automaticamente a partir de categoria
(proxima tarefa). Remove o campo do payload de criacao/edicao e a
checagem de duplicidade manual, que ficam mortos com essa mudanca."
```

---

### Task 3: `categoriasRepository`

**Files:**
- Create: `src/repositories/categoriasRepository.js`
- Test: `tests/repositories/categoriasRepository.test.js`

**Interfaces:**
- Produces: `listarPaginado({ limit, offset, empresa_id }) => { items, total }`, `buscarPorId(id, empresa_id) => row|null`, `buscarPorCodigoNivel(nivel, codigoMaiusculo, empresa_id) => row|null`, `buscarPorIds(ids, empresa_id) => row[]`, `criar({ nivel, codigo, nome, empresa_id }) => row`, `atualizarNome(id, nome, empresa_id) => row|null`, `softDelete(id, empresa_id) => row|null`. All exclude `deletado_em IS NOT NULL` rows except where noted.

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const categoriasRepository = require('../../src/repositories/categoriasRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listarPaginado', () => {
  test('filters by empresa_id and excludes soft-deleted rows', async () => {
    db.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const resultado = await categoriasRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

    expect(resultado).toEqual({ items: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }], total: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([9, 20, 0]);
  });
});

describe('buscarPorId', () => {
  test('scopes by id AND empresa_id and excludes soft-deleted rows', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, empresa_id: 9 }] });

    const resultado = await categoriasRepository.buscarPorId(1, 9);

    expect(resultado).toEqual({ id: 1, empresa_id: 9 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when no row matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.buscarPorId(1, 9)).toBeNull();
  });
});

describe('buscarPorCodigoNivel', () => {
  test('compares codigo case-insensitively, scoped by nivel and empresa_id, active only', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, codigo: 'BR' }] });

    const resultado = await categoriasRepository.buscarPorCodigoNivel(1, 'BR', 9);

    expect(resultado).toEqual({ id: 1, codigo: 'BR' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('UPPER(codigo)');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([1, 'BR', 9]);
  });

  test('returns null when nothing matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.buscarPorCodigoNivel(1, 'ZZ', 9)).toBeNull();
  });
});

describe('buscarPorIds', () => {
  test('returns active rows matching the given ids and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });

    const resultado = await categoriasRepository.buscarPorIds([1, 2], 9);

    expect(resultado).toEqual([{ id: 1 }, { id: 2 }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([[1, 2], 9]);
  });

  test('returns an empty array without querying when ids is empty', async () => {
    db.query = jest.fn();
    expect(await categoriasRepository.buscarPorIds([], 9)).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('criar', () => {
  test('inserts with the given empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 }] });

    const resultado = await categoriasRepository.criar({ nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 });

    expect(resultado.empresa_id).toBe(9);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO categorias_produto');
    expect(params).toEqual([1, 'BR', 'Brinco', 9]);
  });
});

describe('atualizarNome', () => {
  test('updates nome scoped by id, empresa_id, and only active rows', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nome: 'Novo Nome' }] });

    const resultado = await categoriasRepository.atualizarNome(1, 'Novo Nome', 9);

    expect(resultado.nome).toBe('Novo Nome');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual(['Novo Nome', 1, 9]);
  });

  test('returns null when the categoria does not belong to this empresa or is deleted', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.atualizarNome(1, 'X', 9)).toBeNull();
  });
});

describe('softDelete', () => {
  test('sets deletado_em scoped by id and empresa_id', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, deletado_em: '2026-09-12T00:00:00.000Z' }] });

    const resultado = await categoriasRepository.softDelete(1, 9);

    expect(resultado.deletado_em).toBeTruthy();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('deletado_em = NOW()');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when already deleted or not found', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });
    expect(await categoriasRepository.softDelete(1, 9)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/repositories/categoriasRepository.test.js
```

Expected: `Cannot find module '../../src/repositories/categoriasRepository'`.

- [ ] **Step 3: Implement `categoriasRepository.js`**

```js
const db = require('../config/db');

async function listarPaginado({ limit, offset, empresa_id }) {
    const { rows } = await db.query(
        `SELECT * FROM categorias_produto
         WHERE empresa_id = $1 AND deletado_em IS NULL
         ORDER BY nivel ASC, codigo ASC
         LIMIT $2 OFFSET $3`,
        [empresa_id, limit, offset]
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM categorias_produto WHERE empresa_id = $1 AND deletado_em IS NULL`,
        [empresa_id]
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM categorias_produto WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function buscarPorCodigoNivel(nivel, codigo, empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM categorias_produto
         WHERE nivel = $1 AND UPPER(codigo) = $2 AND empresa_id = $3 AND deletado_em IS NULL`,
        [nivel, codigo, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function buscarPorIds(ids, empresa_id) {
    if (!ids.length) return [];

    const { rows } = await db.query(
        `SELECT * FROM categorias_produto WHERE id = ANY($1::int[]) AND empresa_id = $2 AND deletado_em IS NULL`,
        [ids, empresa_id]
    );
    return rows;
}

async function criar({ nivel, codigo, nome, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO categorias_produto (nivel, codigo, nome, empresa_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [nivel, codigo, nome, empresa_id]
    );
    return rows[0];
}

async function atualizarNome(id, nome, empresa_id) {
    const { rows } = await db.query(
        `UPDATE categorias_produto SET nome = $1, atualizado_em = NOW()
         WHERE id = $2 AND empresa_id = $3 AND deletado_em IS NULL
         RETURNING *`,
        [nome, id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function softDelete(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE categorias_produto SET deletado_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL
         RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

module.exports = {
    listarPaginado,
    buscarPorId,
    buscarPorCodigoNivel,
    buscarPorIds,
    criar,
    atualizarNome,
    softDelete
};
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/repositories/categoriasRepository.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/categoriasRepository.js tests/repositories/categoriasRepository.test.js
git commit -m "feat(categorias): adiciona categoriasRepository"
```

---

### Task 4: `categoriasValidation`

**Files:**
- Create: `src/validations/categoriasValidation.js`
- Test: `tests/validations/categoriasValidation.test.js`

**Interfaces:**
- Produces: `criarCategoriaSchema` (strict; `nivel` int positive, `codigo` string 1-3 chars, `nome` string min 1), `atualizarCategoriaSchema` (strict; only `nome`, string min 1).

- [ ] **Step 1: Write the failing tests**

```js
const { criarCategoriaSchema, atualizarCategoriaSchema } = require('../../src/validations/categoriasValidation');

describe('criarCategoriaSchema', () => {
  const valid = { nivel: 1, codigo: 'BR', nome: 'Brinco' };

  test('accepts a valid payload', () => {
    expect(criarCategoriaSchema.safeParse(valid).success).toBe(true);
  });

  test('accepts a single-character alphanumeric codigo', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, codigo: '1' }).success).toBe(true);
  });

  test('rejects a missing nivel', () => {
    const { nivel, ...semNivel } = valid;
    const result = criarCategoriaSchema.safeParse(semNivel);
    expect(result.success).toBe(false);
  });

  test('rejects a zero or negative nivel', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, nivel: 0 }).success).toBe(false);
    expect(criarCategoriaSchema.safeParse({ ...valid, nivel: -1 }).success).toBe(false);
  });

  test('rejects a missing codigo', () => {
    const { codigo, ...semCodigo } = valid;
    expect(criarCategoriaSchema.safeParse(semCodigo).success).toBe(false);
  });

  test('rejects a codigo longer than 3 characters', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, codigo: 'BRIN' }).success).toBe(false);
  });

  test('rejects an empty codigo', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, codigo: '' }).success).toBe(false);
  });

  test('rejects a missing nome', () => {
    const { nome, ...semNome } = valid;
    expect(criarCategoriaSchema.safeParse(semNome).success).toBe(false);
  });

  test('rejects unknown fields', () => {
    expect(criarCategoriaSchema.safeParse({ ...valid, ativo: true }).success).toBe(false);
  });
});

describe('atualizarCategoriaSchema', () => {
  test('accepts a nome-only payload', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: 'Novo Nome' }).success).toBe(true);
  });

  test('rejects an empty nome', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: '' }).success).toBe(false);
  });

  test('rejects a missing nome', () => {
    expect(atualizarCategoriaSchema.safeParse({}).success).toBe(false);
  });

  test('rejects codigo in the body', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: 'X', codigo: 'BR' }).success).toBe(false);
  });

  test('rejects nivel in the body', () => {
    expect(atualizarCategoriaSchema.safeParse({ nome: 'X', nivel: 2 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/validations/categoriasValidation.test.js
```

Expected: `Cannot find module '../../src/validations/categoriasValidation'`.

- [ ] **Step 3: Implement `categoriasValidation.js`**

```js
const { z } = require('zod');

const criarCategoriaSchema = z.object({
    nivel: z.coerce.number({ error: 'Nível é obrigatório' }).int('Nível inválido').positive('Nível inválido'),
    codigo: z.string({ error: 'Código é obrigatório' }).min(1, 'Código é obrigatório').max(3, 'Código deve ter no máximo 3 caracteres'),
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

const atualizarCategoriaSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

module.exports = { criarCategoriaSchema, atualizarCategoriaSchema };
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/validations/categoriasValidation.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/validations/categoriasValidation.js tests/validations/categoriasValidation.test.js
git commit -m "feat(categorias): adiciona categoriasValidation"
```

---

### Task 5: `categoriasService`

**Files:**
- Create: `src/services/categoriasService.js`
- Test: `tests/services/categoriasService.test.js`

**Interfaces:**
- Consumes: `categoriasRepository.{listarPaginado, buscarPorCodigoNivel, criar, atualizarNome, softDelete}` (Task 3).
- Produces: `listar({ page, pageSize }, empresaId) => { items, page, pageSize, total, totalPages }`, `criar(dados, empresaId) => row` (dados: `{ nivel, codigo, nome }`, uppercases `codigo`, 409 on duplicate), `atualizar(id, dados, empresaId) => row` (dados: `{ nome }`, 404 if not found), `remover(id, empresaId) => row` (404 if not found).

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('../../src/repositories/categoriasRepository');

const categoriasRepository = require('../../src/repositories/categoriasRepository');
const categoriasService = require('../../src/services/categoriasService');
const AppError = require('../../src/errors/AppError');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('paginates and forwards empresa_id', async () => {
    categoriasRepository.listarPaginado.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

    const result = await categoriasService.listar({ page: 1, pageSize: 20 }, 9);

    expect(categoriasRepository.listarPaginado).toHaveBeenCalledWith({ limit: 20, offset: 0, empresa_id: 9 });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  test('computes the correct offset for page > 1', async () => {
    categoriasRepository.listarPaginado.mockResolvedValue({ items: [], total: 0 });

    await categoriasService.listar({ page: 3, pageSize: 10 }, 9);

    expect(categoriasRepository.listarPaginado).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, empresa_id: 9 })
    );
  });
});

describe('criar', () => {
  test('uppercases codigo and creates when no duplicate exists', async () => {
    categoriasRepository.buscarPorCodigoNivel.mockResolvedValue(null);
    categoriasRepository.criar.mockResolvedValue({ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 });

    const result = await categoriasService.criar({ nivel: 1, codigo: 'br', nome: 'Brinco' }, 9);

    expect(categoriasRepository.buscarPorCodigoNivel).toHaveBeenCalledWith(1, 'BR', 9);
    expect(categoriasRepository.criar).toHaveBeenCalledWith({ nivel: 1, codigo: 'BR', nome: 'Brinco', empresa_id: 9 });
    expect(result.codigo).toBe('BR');
  });

  test('throws 409 when the codigo is already taken at this nivel', async () => {
    categoriasRepository.buscarPorCodigoNivel.mockResolvedValue({ id: 1 });

    await expect(
      categoriasService.criar({ nivel: 1, codigo: 'BR', nome: 'Brinco' }, 9)
    ).rejects.toMatchObject({ statusCode: 409, message: 'Já existe uma categoria com esse código neste nível' });

    expect(categoriasRepository.criar).not.toHaveBeenCalled();
  });
});

describe('atualizar', () => {
  test('updates nome via the repository', async () => {
    categoriasRepository.atualizarNome.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const result = await categoriasService.atualizar(1, { nome: 'Novo Nome' }, 9);

    expect(categoriasRepository.atualizarNome).toHaveBeenCalledWith(1, 'Novo Nome', 9);
    expect(result.nome).toBe('Novo Nome');
  });

  test('throws 404 when the categoria does not exist for this empresa', async () => {
    categoriasRepository.atualizarNome.mockResolvedValue(null);

    await expect(categoriasService.atualizar(999, { nome: 'X' }, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Categoria não encontrada'
    });
  });
});

describe('remover', () => {
  test('soft-deletes an existing categoria', async () => {
    categoriasRepository.softDelete.mockResolvedValue({ id: 1, deletado_em: '2026-09-12T00:00:00.000Z' });

    const result = await categoriasService.remover(1, 9);

    expect(categoriasRepository.softDelete).toHaveBeenCalledWith(1, 9);
    expect(result.deletado_em).toBeTruthy();
  });

  test('throws 404 when the categoria does not exist for this empresa', async () => {
    categoriasRepository.softDelete.mockResolvedValue(null);

    await expect(categoriasService.remover(999, 9)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Categoria não encontrada'
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/services/categoriasService.test.js
```

Expected: `Cannot find module '../../src/services/categoriasService'`.

- [ ] **Step 3: Implement `categoriasService.js`**

```js
const categoriasRepository = require('../repositories/categoriasRepository');
const AppError = require('../errors/AppError');

async function listar({ page, pageSize }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await categoriasRepository.listarPaginado({ limit, offset, empresa_id: empresaId });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function criar(dados, empresaId) {
    const codigo = dados.codigo.toUpperCase();
    const existente = await categoriasRepository.buscarPorCodigoNivel(dados.nivel, codigo, empresaId);

    if (existente) {
        throw new AppError('Já existe uma categoria com esse código neste nível', 409);
    }

    return categoriasRepository.criar({ nivel: dados.nivel, codigo, nome: dados.nome, empresa_id: empresaId });
}

async function atualizar(id, dados, empresaId) {
    const atualizado = await categoriasRepository.atualizarNome(id, dados.nome, empresaId);

    if (!atualizado) {
        throw new AppError('Categoria não encontrada', 404);
    }

    return atualizado;
}

async function remover(id, empresaId) {
    const removido = await categoriasRepository.softDelete(id, empresaId);

    if (!removido) {
        throw new AppError('Categoria não encontrada', 404);
    }

    return removido;
}

module.exports = { listar, criar, atualizar, remover };
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/services/categoriasService.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/categoriasService.js tests/services/categoriasService.test.js
git commit -m "feat(categorias): adiciona categoriasService"
```

---

### Task 6: `categoriasController` + routes + mount + role tests

**Files:**
- Create: `src/controllers/categoriasController.js`, `src/routes/categorias.js`
- Modify: `src/app.js`
- Test: `tests/routes/categorias.test.js`

**Interfaces:**
- Consumes: `categoriasService.{listar, criar, atualizar, remover}` (Task 5), `categoriasValidation.{criarCategoriaSchema, atualizarCategoriaSchema}` (Task 4).
- Produces: `GET/POST /categorias`, `PUT/DELETE /categorias/:id`, mounted at `/categorias` behind `authMiddleware` + `requireEstoquista`.

- [ ] **Step 1: Write the failing route tests**

```js
jest.mock('../../src/services/categoriasService');

const request = require('supertest');
const categoriasService = require('../../src/services/categoriasService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('access control (admin + estoquista only)', () => {
  const requests = [
    ['get', '/categorias'],
    ['post', '/categorias'],
    ['put', '/categorias/1'],
    ['delete', '/categorias/1']
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

describe('GET /categorias', () => {
  const paginatedResult = { items: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }], page: 1, pageSize: 20, total: 1, totalPages: 1 };

  test('returns 200 for an admin', async () => {
    categoriasService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/categorias').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: paginatedResult });
  });

  test('returns 200 for an estoquista', async () => {
    categoriasService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/categorias').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /categorias', () => {
  test('returns 400 for a missing codigo', async () => {
    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, nome: 'Brinco' });

    expect(res.status).toBe(400);
    expect(categoriasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for an admin', async () => {
    categoriasService.criar.mockResolvedValue({ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' });

    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, codigo: 'BR', nome: 'Brinco' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(1);
  });

  test('returns 201 for an estoquista', async () => {
    categoriasService.criar.mockResolvedValue({ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' });

    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ nivel: 1, codigo: 'BR', nome: 'Brinco' });

    expect(res.status).toBe(201);
  });

  test('returns 409 when the service reports a duplicate codigo', async () => {
    categoriasService.criar.mockRejectedValue(new AppError('Já existe uma categoria com esse código neste nível', 409));

    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nivel: 1, codigo: 'BR', nome: 'Brinco' });

    expect(res.status).toBe(409);
  });
});

describe('PUT /categorias/:id', () => {
  test('returns 200 with the updated categoria for an admin', async () => {
    categoriasService.atualizar.mockResolvedValue({ id: 1, nome: 'Novo Nome' });

    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(categoriasService.atualizar).toHaveBeenCalledWith(1, { nome: 'Novo Nome' }, 1);
  });

  test('returns 400 with an explicit message when codigo is in the body', async () => {
    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', codigo: 'ZZ' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não podem ser alterados/);
    expect(categoriasService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 400 with an explicit message when nivel is in the body', async () => {
    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X', nivel: 2 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não podem ser alterados/);
    expect(categoriasService.atualizar).not.toHaveBeenCalled();
  });

  test('returns 404 when the categoria does not belong to this empresa', async () => {
    categoriasService.atualizar.mockRejectedValue(new AppError('Categoria não encontrada', 404));

    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /categorias/:id', () => {
  test('returns 200 and soft-deletes for an estoquista', async () => {
    categoriasService.remover.mockResolvedValue({ id: 1, deletado_em: '2026-09-12T00:00:00.000Z' });

    const res = await request(app).delete('/categorias/1').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deletado_em).toBeTruthy();
  });

  test('returns 404 when the categoria does not belong to this empresa', async () => {
    categoriasService.remover.mockRejectedValue(new AppError('Categoria não encontrada', 404));

    const res = await request(app).delete('/categorias/1').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/routes/categorias.test.js
```

Expected: fails — route `/categorias` doesn't exist yet (404s where 200/201/400 expected).

- [ ] **Step 3: Implement the controller, routes, and mount**

`src/controllers/categoriasController.js`:
```js
const categoriasService = require('../services/categoriasService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarCategoriaSchema, atualizarCategoriaSchema } = require('../validations/categoriasValidation');

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

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);
        const resultado = await categoriasService.listar(paginacao, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const categoria = await categoriasService.criar(parsed.data, req.usuario.empresa_id);

        return response.success(res, categoria, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        if ('codigo' in req.body || 'nivel' in req.body) {
            throw new AppError('Código e nível não podem ser alterados após a criação — crie uma nova categoria', 400);
        }

        const parsed = atualizarCategoriaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const categoria = await categoriasService.atualizar(id, parsed.data, req.usuario.empresa_id);

        return response.success(res, categoria);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const categoria = await categoriasService.remover(id, req.usuario.empresa_id);

        return response.success(res, categoria);
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, criar, atualizar, remover };
```

`src/routes/categorias.js`:
```js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/categoriasController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.delete('/:id', controller.remover);

module.exports = router;
```

In `src/app.js`, add near the other route requires:
```js
const categoriasRoutes = require('./routes/categorias');
```
and near the other `requireEstoquista`-mounted routes (alongside `/fornecedores`):
```js
app.use('/categorias', authMiddleware, requireEstoquista, categoriasRoutes);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/routes/categorias.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/categoriasController.js src/routes/categorias.js src/app.js tests/routes/categorias.test.js
git commit -m "feat(categorias): adiciona endpoints CRUD (admin+estoquista)"
```

---

### Task 7: `sequenciasSkuRepository`

**Files:**
- Create: `src/repositories/sequenciasSkuRepository.js`
- Test: `tests/repositories/sequenciasSkuRepository.test.js`

**Interfaces:**
- Produces: `incrementarContador(chaveCombinacao, empresa_id, client) => Promise<number>` — atomic upsert, returns the post-increment `contador`.

- [ ] **Step 1: Write the failing tests**

```js
const sequenciasSkuRepository = require('../../src/repositories/sequenciasSkuRepository');

describe('incrementarContador', () => {
  test('upserts and returns the incremented contador, using the given client', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ contador: 3 }] }) };

    const contador = await sequenciasSkuRepository.incrementarContador('BR-01', 9, client);

    expect(contador).toBe(3);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO sequencias_sku');
    expect(sql).toContain('ON CONFLICT (empresa_id, chave_combinacao)');
    expect(sql).toContain('contador = sequencias_sku.contador + 1');
    expect(params).toEqual([9, 'BR-01']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/repositories/sequenciasSkuRepository.test.js
```

Expected: `Cannot find module '../../src/repositories/sequenciasSkuRepository'`.

- [ ] **Step 3: Implement `sequenciasSkuRepository.js`**

```js
async function incrementarContador(chaveCombinacao, empresa_id, client) {
    const { rows } = await client.query(
        `INSERT INTO sequencias_sku (empresa_id, chave_combinacao, contador)
         VALUES ($1, $2, 1)
         ON CONFLICT (empresa_id, chave_combinacao)
         DO UPDATE SET contador = sequencias_sku.contador + 1
         RETURNING contador`,
        [empresa_id, chaveCombinacao]
    );

    return rows[0].contador;
}

module.exports = { incrementarContador };
```

(No `require('../config/db')` here — this always runs inside `produtosService.categorizar`'s transaction and always receives an explicit `client`, unlike most repositories in this codebase that fall back to the pool. A sequence increment outside a transaction that also writes the SKU would defeat the point of the upsert.)

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/repositories/sequenciasSkuRepository.test.js
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/sequenciasSkuRepository.js tests/repositories/sequenciasSkuRepository.test.js
git commit -m "feat(sku): adiciona sequenciasSkuRepository (contador atomico via upsert)"
```

---

### Task 8: `skuService` — the SKU algorithm

**Files:**
- Create: `src/services/skuService.js`
- Test: `tests/services/skuService.test.js`

**Interfaces:**
- Consumes: `sequenciasSkuRepository.incrementarContador` (Task 7).
- Produces: `montarChaveCombinacao(categorias) => string`, `formatarSku(categorias, contador) => string`, `gerar(categorias, empresaId, client) => Promise<string>`. `categorias` is `{ nivel, codigo }[]`.

This is the task that directly implements the spec's collision-analysis fix and the letras→números→sequência ordering rule — cover it thoroughly.

- [ ] **Step 1: Write the failing tests**

```js
jest.mock('../../src/repositories/sequenciasSkuRepository');

const sequenciasSkuRepository = require('../../src/repositories/sequenciasSkuRepository');
const skuService = require('../../src/services/skuService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('montarChaveCombinacao', () => {
  test('orders by nivel ascending and joins with a dash', () => {
    const chave = skuService.montarChaveCombinacao([
      { nivel: 2, codigo: '01' },
      { nivel: 1, codigo: 'BR' }
    ]);
    expect(chave).toBe('BR-01');
  });

  test('uppercases codigo', () => {
    const chave = skuService.montarChaveCombinacao([{ nivel: 1, codigo: 'br' }]);
    expect(chave).toBe('BR');
  });
});

describe('formatarSku', () => {
  test('formats a single-nivel SKU with the sequence zero-padded to 3 digits', () => {
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 7)).toBe('BR007');
  });

  test('formats a two-nivel SKU (letra + numero)', () => {
    const categorias = [{ nivel: 1, codigo: 'BR' }, { nivel: 2, codigo: '01' }];
    expect(skuService.formatarSku(categorias, 7)).toBe('BR01007');
  });

  test('puts codigos with a letter first, regardless of nivel order', () => {
    // nivel 1 is purely numeric, nivel 2 has a letter — letter block still comes first.
    const categorias = [{ nivel: 1, codigo: '02' }, { nivel: 2, codigo: 'OU' }];
    expect(skuService.formatarSku(categorias, 1)).toBe('OU02001');
  });

  test('does not pad beyond 3 digits once the sequence grows past 999', () => {
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 1000)).toBe('BR1000');
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 1001)).toBe('BR1001');
  });

  test('pads small sequence numbers to exactly 3 digits', () => {
    expect(skuService.formatarSku([{ nivel: 1, codigo: 'BR' }], 42)).toBe('BR042');
  });
});

describe('gerar', () => {
  test('builds the chave from the categorias, increments via the repository, and formats the sku', async () => {
    sequenciasSkuRepository.incrementarContador.mockResolvedValue(2);
    const client = {};

    const sku = await skuService.gerar([{ nivel: 1, codigo: 'BR' }, { nivel: 2, codigo: '01' }], 9, client);

    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenCalledWith('BR-01', 9, client);
    expect(sku).toBe('BR01002');
  });

  test('the sequence continues (does not restart) across a soft-delete + recreate of the same codigo', async () => {
    // Same chave_combinacao text ("BR") is used whether the underlying categoria
    // row is id=5 (deleted) or a brand-new id=42 with the same codigo — this is
    // exactly the fix for the collision described in the design spec: the key
    // is anchored on codigo text, so gerar() never sees or needs the id at all.
    sequenciasSkuRepository.incrementarContador.mockResolvedValueOnce(1);
    const skuPrimeiraCategoria = await skuService.gerar([{ nivel: 1, codigo: 'BR' }], 9, {});
    expect(skuPrimeiraCategoria).toBe('BR001');

    sequenciasSkuRepository.incrementarContador.mockResolvedValueOnce(2);
    const skuCategoriaRecriada = await skuService.gerar([{ nivel: 1, codigo: 'BR' }], 9, {});
    expect(skuCategoriaRecriada).toBe('BR002');

    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenNthCalledWith(1, 'BR', 9, {});
    expect(sequenciasSkuRepository.incrementarContador).toHaveBeenNthCalledWith(2, 'BR', 9, {});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/services/skuService.test.js
```

Expected: `Cannot find module '../../src/services/skuService'`.

- [ ] **Step 3: Implement `skuService.js`**

```js
const sequenciasSkuRepository = require('../repositories/sequenciasSkuRepository');

function contemLetra(codigo) {
    return /[A-Z]/.test(codigo.toUpperCase());
}

// Letras sempre na frente, números depois — cada bloco ordenado por nível
// ascendente entre si. Regra fechada no CLAUDE.md (ver Task 12).
function ordenarPorGrupo(categorias) {
    const ordenadasPorNivel = [...categorias].sort((a, b) => a.nivel - b.nivel);
    const letras = ordenadasPorNivel.filter((c) => contemLetra(c.codigo));
    const numeros = ordenadasPorNivel.filter((c) => !contemLetra(c.codigo));
    return [...letras, ...numeros];
}

function montarChaveCombinacao(categorias) {
    return ordenarPorGrupo(categorias).map((c) => c.codigo.toUpperCase()).join('-');
}

function formatarSku(categorias, contador) {
    const sequencia = String(contador).padStart(3, '0');
    return ordenarPorGrupo(categorias).map((c) => c.codigo.toUpperCase()).join('') + sequencia;
}

async function gerar(categorias, empresaId, client) {
    const chave = montarChaveCombinacao(categorias);
    const contador = await sequenciasSkuRepository.incrementarContador(chave, empresaId, client);
    return formatarSku(categorias, contador);
}

module.exports = { montarChaveCombinacao, formatarSku, gerar };
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/services/skuService.test.js
```

Expected: all pass, including the overflow (999→1000) and soft-delete-continuation cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/skuService.js tests/services/skuService.test.js
git commit -m "feat(sku): adiciona skuService (algoritmo de montagem e geracao)"
```

---

### Task 9: `produtosRepository` — category link + SKU write functions

**Files:**
- Modify: `src/repositories/produtosRepository.js`
- Modify: `tests/repositories/produtosRepository.test.js`

**Interfaces:**
- Produces: `buscarCategoriasDoProduto(produto_id, empresa_id) => { id, nivel, codigo, nome }[]` (ordered by nível, includes soft-deleted categorias so history stays visible), `buscarCategoriasPorProdutoIds(produtoIds, empresa_id) => { produto_id, id, nivel, codigo, nome }[]` (flat rows for batch grouping in the service), `substituirCategorias(produto_id, categoriaIds, empresa_id, client) => Promise<void>`, `definirSkuSeNulo(produto_id, sku, empresa_id, client) => row|null` (no-op, returns `null`, if `sku` is already set — the immutability guard).

- [ ] **Step 1: Write the failing tests**

Append to `tests/repositories/produtosRepository.test.js`:

```js
describe('buscarCategoriasDoProduto', () => {
  test('joins categorias_produto, scoped by produto_id and empresa_id, ordered by nivel', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }] });

    const resultado = await produtosRepository.buscarCategoriasDoProduto(5, 9);

    expect(resultado).toEqual([{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('produtos_categorias');
    expect(sql).toContain('ORDER BY c.nivel ASC');
    expect(params).toEqual([5, 9]);
  });
});

describe('buscarCategoriasPorProdutoIds', () => {
  test('returns flat rows tagged with produto_id for batch grouping', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ produto_id: 5, id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }] });

    const resultado = await produtosRepository.buscarCategoriasPorProdutoIds([5, 6], 9);

    expect(resultado).toEqual([{ produto_id: 5, id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([[5, 6], 9]);
  });

  test('returns an empty array without querying when produtoIds is empty', async () => {
    db.query = jest.fn();
    expect(await produtosRepository.buscarCategoriasPorProdutoIds([], 9)).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('substituirCategorias', () => {
  test('deletes existing links then inserts the new ones, using the given client', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await produtosRepository.substituirCategorias(5, [1, 2], 9, client);

    expect(client.query).toHaveBeenNthCalledWith(1, expect.stringContaining('DELETE FROM produtos_categorias'), [5, 9]);
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO produtos_categorias'), [5, 1, 9]);
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO produtos_categorias'), [5, 2, 9]);
  });

  test('only deletes when categoriaIds is empty (clears the link)', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await produtosRepository.substituirCategorias(5, [], 9, client);

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM produtos_categorias'), [5, 9]);
  });
});

describe('definirSkuSeNulo', () => {
  test('writes the sku only when it is currently null, using the given client', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 5, sku: 'BR001' }] }) };

    const resultado = await produtosRepository.definirSkuSeNulo(5, 'BR001', 9, client);

    expect(resultado).toEqual({ id: 5, sku: 'BR001' });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('AND sku IS NULL');
    expect(params).toEqual(['BR001', 5, 9]);
  });

  test('returns null (no-op) when the produto already has a sku', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    expect(await produtosRepository.definirSkuSeNulo(5, 'BR002', 9, client)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/repositories/produtosRepository.test.js
```

Expected: the four new `describe` blocks fail with "is not a function".

- [ ] **Step 3: Implement in `produtosRepository.js`**

Add near the other exported functions:

```js
async function buscarCategoriasDoProduto(produto_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT c.id, c.nivel, c.codigo, c.nome
         FROM produtos_categorias pc
         JOIN categorias_produto c ON c.id = pc.categoria_id
         WHERE pc.produto_id = $1 AND pc.empresa_id = $2
         ORDER BY c.nivel ASC`,
        [produto_id, empresa_id]
    );
    return rows;
}

async function buscarCategoriasPorProdutoIds(produtoIds, empresa_id) {
    if (!produtoIds.length) return [];

    const { rows } = await db.query(
        `SELECT pc.produto_id, c.id, c.nivel, c.codigo, c.nome
         FROM produtos_categorias pc
         JOIN categorias_produto c ON c.id = pc.categoria_id
         WHERE pc.produto_id = ANY($1::int[]) AND pc.empresa_id = $2
         ORDER BY c.nivel ASC`,
        [produtoIds, empresa_id]
    );
    return rows;
}

async function substituirCategorias(produto_id, categoriaIds, empresa_id, client) {
    await client.query('DELETE FROM produtos_categorias WHERE produto_id = $1 AND empresa_id = $2', [produto_id, empresa_id]);

    for (const categoria_id of categoriaIds) {
        await client.query(
            'INSERT INTO produtos_categorias (produto_id, categoria_id, empresa_id) VALUES ($1, $2, $3)',
            [produto_id, categoria_id, empresa_id]
        );
    }
}

async function definirSkuSeNulo(produto_id, sku, empresa_id, client) {
    const { rows } = await client.query(
        'UPDATE produtos SET sku = $1 WHERE id = $2 AND empresa_id = $3 AND sku IS NULL RETURNING *',
        [sku, produto_id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}
```

Add all four to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/repositories/produtosRepository.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/produtosRepository.js tests/repositories/produtosRepository.test.js
git commit -m "feat(produtos): adiciona funcoes de vinculo categoria-produto e escrita imutavel de sku"
```

---

### Task 10: `produtosService.categorizar` + `categorias` in read paths

**Files:**
- Modify: `src/services/produtosService.js`
- Modify: `tests/services/produtosService.test.js`

**Interfaces:**
- Consumes: `categoriasRepository.buscarPorIds` (Task 3), `skuService.gerar` (Task 8), `produtosRepository.{buscarCategoriasDoProduto, buscarCategoriasPorProdutoIds, substituirCategorias, definirSkuSeNulo}` (Task 9), `db` (`src/config/db`) for the transaction.
- Produces: `categorizar(id, categoriaIds, empresaId) => Promise<produto>` (produto includes `categorias`), `buscarPorId`/`listar` results now include a `categorias` field per product.

This is the task that enforces immutability end-to-end and proves the collision fix works through the full service, not just `skuService` in isolation.

- [ ] **Step 1: Write the failing tests**

First, `categorizar` pulls in three dependencies the test file doesn't mock yet: `categoriasRepository`, `skuService`, and `db` (for `db.connect`). Add these lines at the very top of `tests/services/produtosService.test.js`, alongside the existing `jest.mock` calls:

```js
jest.mock('../../src/repositories/categoriasRepository');
jest.mock('../../src/services/skuService');
jest.mock('../../src/config/db');
```

and these requires alongside the existing ones:

```js
const categoriasRepository = require('../../src/repositories/categoriasRepository');
const skuService = require('../../src/services/skuService');
const db = require('../../src/config/db');
```

(`db` is mocked here the same way `tests/repositories/*.test.js` mock it elsewhere in this codebase — `jest.mock` auto-mocks every export, so `db.connect` becomes a plain `jest.fn()` that each `categorizar` test configures with `db.connect.mockResolvedValue(client)`.)

Then update the shared `beforeEach` at the top of the file to mock the two new read-path repository calls (every existing test that doesn't care about categorias keeps working since it defaults to `[]`):

```js
beforeEach(() => {
  jest.clearAllMocks();
  precosRepository.buscarCanalPorNome.mockResolvedValue({ id: 1, nome: 'loja_fisica' });
  precosRepository.listarPrecosVigentesPorCanal.mockResolvedValue([]);
  precosRepository.buscarPrecoVigente.mockResolvedValue(null);
  produtosRepository.buscarCategoriasDoProduto.mockResolvedValue([]);
  produtosRepository.buscarCategoriasPorProdutoIds.mockResolvedValue([]);
});
```

Update the one full-object `toEqual` in the existing `listar` describe block (`'paginates and attaches margem_percentual and preco_canal to each item'`) to include the new field:

```js
    expect(result).toEqual({
      items: [{
        id: 1, preco_venda: '20.00', custo: '10.00', margem_percentual: 50,
        preco_canal: { canal: 'loja_fisica', preco_venda: null, markup_percentual: null, margem_percentual: null, vigente_desde: null },
        categorias: []
      }],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1
    });
```

Then add new tests (new file section, after the `listar`/`buscarPorId` describes and before `describe('criar', ...)`):

```js
describe('listar (categorias)', () => {
  test('attaches the categorias linked to each produto', async () => {
    produtosRepository.listarPaginado.mockResolvedValue({
      items: [{ id: 1, preco_venda: '20.00', custo: '10.00' }, { id: 2, preco_venda: '30.00', custo: '15.00' }],
      total: 2
    });
    produtosRepository.buscarCategoriasPorProdutoIds.mockResolvedValue([
      { produto_id: 1, id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }
    ]);

    const result = await produtosService.listar({ page: 1, pageSize: 20, canal: 'loja_fisica' });

    expect(result.items[0].categorias).toEqual([{ id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
    expect(result.items[1].categorias).toEqual([]);
  });
});

describe('buscarPorId (categorias)', () => {
  test('attaches the categorias linked to the produto', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, preco_venda: '10.00', custo: '5.00' });
    produtosRepository.buscarCategoriasDoProduto.mockResolvedValue([{ id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);

    const result = await produtosService.buscarPorId(1, 'loja_fisica');

    expect(result.categorias).toEqual([{ id: 10, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
  });
});

describe('categorizar', () => {
  let client;

  beforeEach(() => {
    client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    db.connect.mockResolvedValue(client);
  });

  test('throws 404 when the produto does not exist', async () => {
    produtosRepository.buscarPorId.mockResolvedValue(null);

    await expect(produtosService.categorizar(999, [1], 9)).rejects.toMatchObject({ statusCode: 404 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('throws 400 when a categoria_id does not resolve to an active categoria in this empresa', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR' }]);

    await expect(produtosService.categorizar(1, [1, 2], 9)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('throws 400 when two categorias share the same nivel', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null });
    categoriasRepository.buscarPorIds.mockResolvedValue([
      { id: 1, nivel: 1, codigo: 'BR' },
      { id: 2, nivel: 1, codigo: 'CO' }
    ]);

    await expect(produtosService.categorizar(1, [1, 2], 9)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Não é permitido mais de uma categoria do mesmo nível'
    });
  });

  test('generates the sku on first categorization (produto has no sku yet)', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null, preco_venda: '10.00', custo: '5.00' });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR' }]);
    skuService.gerar.mockResolvedValue('BR001');
    produtosRepository.definirSkuSeNulo.mockResolvedValue({ id: 1, sku: 'BR001', preco_venda: '10.00', custo: '5.00' });
    produtosRepository.buscarCategoriasDoProduto.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);

    const result = await produtosService.categorizar(1, [1], 9);

    expect(produtosRepository.substituirCategorias).toHaveBeenCalledWith(1, [1], 9, client);
    expect(skuService.gerar).toHaveBeenCalledWith([{ id: 1, nivel: 1, codigo: 'BR' }], 9, client);
    expect(produtosRepository.definirSkuSeNulo).toHaveBeenCalledWith(1, 'BR001', 9, client);
    expect(result.sku).toBe('BR001');
    expect(result.categorias).toEqual([{ id: 1, nivel: 1, codigo: 'BR', nome: 'Brinco' }]);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('never regenerates the sku when the produto already has one, even with new categorias', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: 'BR001', preco_venda: '10.00', custo: '5.00' });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 2, nivel: 1, codigo: 'CO' }]);

    const result = await produtosService.categorizar(1, [2], 9);

    expect(produtosRepository.substituirCategorias).toHaveBeenCalledWith(1, [2], 9, client);
    expect(skuService.gerar).not.toHaveBeenCalled();
    expect(produtosRepository.definirSkuSeNulo).not.toHaveBeenCalled();
    expect(result.sku).toBe('BR001');
  });

  test('does not generate a sku when categoriaIds is empty (clears the link, no-op on sku)', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null, preco_venda: '10.00', custo: '5.00' });

    const result = await produtosService.categorizar(1, [], 9);

    expect(categoriasRepository.buscarPorIds).not.toHaveBeenCalled();
    expect(produtosRepository.substituirCategorias).toHaveBeenCalledWith(1, [], 9, client);
    expect(skuService.gerar).not.toHaveBeenCalled();
    expect(result.sku).toBeNull();
  });

  test('rolls back and converts a unique-violation on the sku write into a clean 409', async () => {
    produtosRepository.buscarPorId.mockResolvedValue({ id: 1, sku: null, preco_venda: '10.00', custo: '5.00' });
    categoriasRepository.buscarPorIds.mockResolvedValue([{ id: 1, nivel: 1, codigo: 'BR' }]);
    skuService.gerar.mockResolvedValue('BR001');
    const erroColisao = new Error('duplicate key value violates unique constraint "idx_produtos_sku_unico"');
    erroColisao.code = '23505';
    produtosRepository.definirSkuSeNulo.mockRejectedValue(erroColisao);

    await expect(produtosService.categorizar(1, [1], 9)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Erro ao gerar SKU, tente novamente'
    });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/services/produtosService.test.js
```

Expected: the new `describe('categorizar', ...)` block fails (`produtosService.categorizar is not a function`); the updated `listar`/`buscarPorId` tests fail on the missing `categorias` field.

- [ ] **Step 3: Implement in `produtosService.js`**

Add requires at the top:
```js
const categoriasRepository = require('../repositories/categoriasRepository');
const skuService = require('./skuService');
const db = require('../config/db');
```

Update `listar` to attach categorias (insert after `precosPorProduto` is built, before the `return`):
```js
async function listar({ page, pageSize, canal }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const canalRow = await resolverCanal(canal, empresaId);
    const { items, total } = await produtosRepository.listarPaginado({ limit, offset, empresa_id: empresaId });

    const precos = await precosRepository.listarPrecosVigentesPorCanal(items.map((produto) => produto.id), canalRow.id, empresaId);
    const precosPorProduto = new Map(precos.map((preco) => [preco.produto_id, preco]));

    const categoriaLinhas = await produtosRepository.buscarCategoriasPorProdutoIds(items.map((produto) => produto.id), empresaId);
    const categoriasPorProduto = new Map();
    for (const { produto_id, ...categoria } of categoriaLinhas) {
        if (!categoriasPorProduto.has(produto_id)) categoriasPorProduto.set(produto_id, []);
        categoriasPorProduto.get(produto_id).push(categoria);
    }

    return {
        items: items.map((produto) => ({
            ...comPrecoCanal(comMargem(produto), canalRow.nome, precosPorProduto.get(produto.id)),
            categorias: categoriasPorProduto.get(produto.id) || []
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}
```

Update `buscarPorId`:
```js
async function buscarPorId(id, canal, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const canalRow = await resolverCanal(canal, empresaId);
    const precoRow = await precosRepository.buscarPrecoVigente(id, canalRow.id, empresaId);
    const categorias = await produtosRepository.buscarCategoriasDoProduto(id, empresaId);

    return { ...comPrecoCanal(comMargem(produto), canalRow.nome, precoRow), categorias };
}
```

Add `categorizar` (near `remover`/`ajustarPreco`):
```js
async function categorizar(id, categoriaIds, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    let categorias = [];

    if (categoriaIds.length > 0) {
        categorias = await categoriasRepository.buscarPorIds(categoriaIds, empresaId);

        if (categorias.length !== categoriaIds.length) {
            throw new AppError('Categoria inválida', 400);
        }

        const niveis = categorias.map((c) => c.nivel);
        if (new Set(niveis).size !== niveis.length) {
            throw new AppError('Não é permitido mais de uma categoria do mesmo nível', 400);
        }
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await produtosRepository.substituirCategorias(id, categoriaIds, empresaId, client);

        let produtoAtualizado = produto;

        if (!produto.sku && categorias.length > 0) {
            const sku = await skuService.gerar(categorias, empresaId, client);

            try {
                const atualizado = await produtosRepository.definirSkuSeNulo(id, sku, empresaId, client);
                if (atualizado) produtoAtualizado = atualizado;
            } catch (error) {
                if (error.code === '23505') {
                    throw new AppError('Erro ao gerar SKU, tente novamente', 409);
                }
                throw error;
            }
        }

        await client.query('COMMIT');

        const categoriasVinculadas = await produtosRepository.buscarCategoriasDoProduto(id, empresaId);

        return { ...comMargem(produtoAtualizado), categorias: categoriasVinculadas };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
```

Add `categorizar` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/services/produtosService.test.js
```

Expected: all pass, including the immutability test and the unique-violation-to-409 conversion.

- [ ] **Step 5: Commit**

```bash
git add src/services/produtosService.js tests/services/produtosService.test.js
git commit -m "feat(produtos): adiciona categorizar (geracao imutavel de SKU) e inclui categorias na leitura"
```

---

### Task 11: `PATCH /produtos/:id/categoria`

**Files:**
- Modify: `src/validations/produtosValidation.js`
- Modify: `src/controllers/produtosController.js`
- Modify: `src/routes/produtos.js`
- Modify: `tests/routes/produtos.test.js`

**Interfaces:**
- Consumes: `produtosService.categorizar` (Task 10).
- Produces: `categorizarProdutoSchema` (strict; `categoria_ids: number[]`, empty array allowed), `produtosController.categorizar`, route `PATCH /produtos/:id/categoria` behind `requireEstoquista`.

- [ ] **Step 1: Write the failing route tests**

Append to `tests/routes/produtos.test.js` (mirror the existing `jest.mock('../../src/services/produtosService')` / token setup already in that file):

```js
describe('PATCH /produtos/:id/categoria', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).patch('/produtos/1/categoria').send({ categoria_ids: [1] });
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ categoria_ids: [1] });
    expect(res.status).toBe(403);
  });

  test('returns 200 for an admin', async () => {
    produtosService.categorizar.mockResolvedValue({ id: 1, sku: 'BR001', categorias: [], custo: 5, margem_percentual: 50 });

    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(produtosService.categorizar).toHaveBeenCalledWith(1, [1, 2], 1);
  });

  test('returns 200 for an estoquista', async () => {
    produtosService.categorizar.mockResolvedValue({ id: 1, sku: 'BR001', categorias: [] });

    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ categoria_ids: [1] });

    expect(res.status).toBe(200);
  });

  test('returns 400 for a non-array categoria_ids', async () => {
    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_ids: 'x' });

    expect(res.status).toBe(400);
    expect(produtosService.categorizar).not.toHaveBeenCalled();
  });

  test('returns 400 for an extra field in the body (strict schema)', async () => {
    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_ids: [1], nome: 'Tentando editar outro campo' });

    expect(res.status).toBe(400);
    expect(produtosService.categorizar).not.toHaveBeenCalled();
  });

  test('accepts an empty categoria_ids array', async () => {
    produtosService.categorizar.mockResolvedValue({ id: 1, sku: null, categorias: [] });

    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_ids: [] });

    expect(res.status).toBe(200);
    expect(produtosService.categorizar).toHaveBeenCalledWith(1, [], 1);
  });

  test('includes custo and margem_percentual in the response for an admin (filtrarParaRole keeps them)', async () => {
    produtosService.categorizar.mockResolvedValue({ id: 1, sku: 'BR001', custo: 5, margem_percentual: 50, categorias: [] });

    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_ids: [1] });

    expect(res.body.data.custo).toBe(5);
    expect(res.body.data.margem_percentual).toBe(50);
  });

  test('returns 404 when the produto does not belong to this empresa', async () => {
    produtosService.categorizar.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app)
      .patch('/produtos/1/categoria')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_ids: [1] });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/routes/produtos.test.js -t "categoria"
```

Expected: fails — `PATCH /produtos/:id/categoria` doesn't exist (404s / `categorizar` undefined on the mock).

- [ ] **Step 3: Implement**

In `src/validations/produtosValidation.js`, add:
```js
const categorizarProdutoSchema = z.object({
    categoria_ids: z.array(
        z.coerce.number().int('categoria_ids deve conter apenas números inteiros').positive('categoria_ids deve conter apenas IDs positivos'),
        { error: 'categoria_ids é obrigatório' }
    )
}).strict();
```
and export it alongside the others.

In `src/controllers/produtosController.js`, import `categorizarProdutoSchema` in the destructured require at the top, and add:
```js
async function categorizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        const parsed = categorizarProdutoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const produto = await produtosService.categorizar(id, parsed.data.categoria_ids, req.usuario.empresa_id);

        return response.success(res, filtrarParaRole(produto, req.usuario.role));
    } catch (error) {
        next(error);
    }
}
```
and add `categorizar` to `module.exports`.

In `src/routes/produtos.js`, add (near the other `:id` sub-routes):
```js
router.patch('/:id/categoria', requireEstoquista, controller.categorizar);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tests/routes/produtos.test.js
```

Expected: all pass, including the pre-existing tests in that file (unaffected by this addition).

- [ ] **Step 5: Commit**

```bash
git add src/validations/produtosValidation.js src/controllers/produtosController.js src/routes/produtos.js tests/routes/produtos.test.js
git commit -m "feat(produtos): adiciona PATCH /produtos/:id/categoria (admin+estoquista)"
```

---

### Task 12: Final CLAUDE.md module entry + full suite run

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add the closed-rules section**

Add a new section right after "## Regras já decididas em rateio e vigência de despesas fixas — não reabrir" (before `## Banco`):

```markdown
## Regras já decididas em categorias de produto + SKU automático — não reabrir

Migration `019_categorias_produto.sql`: `categorias_produto` (configurável por empresa, `nivel`/`codigo`/`nome`, soft delete via `deletado_em`), `produtos_categorias` (vínculo N:N produto↔categoria), `sequencias_sku` (contador atômico por combinação). Ver `docs/superpowers/specs/2026-09-12-categorias-sku-design.md` pro racional completo.

- **SKU é sempre gerado automaticamente, nunca digitado manualmente** — `POST/PUT /produtos` não aceita mais o campo `sku`. `produtos.sku` é `NULL` até o produto ser categorizado (na criação ou retroativamente); uma vez gravado, **é imutável pra sempre**, mesmo que a categoria mude depois (`produtosRepository.definirSkuSeNulo` só escreve `WHERE sku IS NULL` — a própria query é a garantia, não só uma checagem em JS antes dela).
- **Categorizar um produto é `PATCH /produtos/:id/categoria`, admin+estoquista, schema `.strict()`** (só aceita `{ categoria_ids }` — não é caminho alternativo pra editar outros campos do produto). `PUT /produtos/:id` continua admin-only e nunca aceitou campos de categoria estruturada.
- **Formato do SKU, fechado**: concatenação sem separador — bloco de códigos com QUALQUER letra primeiro (ordenados por `nivel` ascendente entre si), depois bloco de códigos puramente numéricos (idem), depois a sequência com `padStart(3, '0')` (`007`, `042`, cresce naturalmente pra `1000+` sem migração). Ex.: nível 1 `BR`, nível 2 `01`, sequência 7 → `BR01007`.
- **A chave da sequência (`sequencias_sku.chave_combinacao`) é o TEXTO dos códigos (maiúsculo, ordenados por nível), nunca o `id` da categoria.** Isso é uma correção de bug, não estilo: ancorar no `id` permite que uma categoria soft-deletada e recriada com o mesmo código reinicie a sequência em 1 e gere um SKU visualmente idêntico a um já existente (colisão real, ver spec). Por isso `categorias_produto.codigo` e `.nivel` são **imutáveis após a criação** (só `nome` é editável via `PUT /categorias/:id`; mandar `codigo`/`nivel` no body é 400 explícito, não ignorado em silêncio) — editar esses campos numa categoria já usada reabriria a mesma classe de colisão por outro caminho. Errou o código ao cadastrar? Soft-delete + criar de novo — seguro sob este modelo.
- **`produtos.sku` passou a ser único POR EMPRESA** (`(empresa_id, sku) WHERE sku IS NOT NULL`), revertendo a decisão da migration 007 que o mantinha único globalmente — ver nota atualizada na seção da migração multi-tenant acima. Mesmo assim, o service captura qualquer violação de unicidade na escrita do SKU (`error.code === '23505'`) e responde 409 limpo (`Erro ao gerar SKU, tente novamente`) em vez de 500 — rede de segurança, não deveria ser alcançável em uso normal com a chave corrigida.
- **`produtos.categoria` (texto livre) está deprecado** — ver nota na seção "Estado atual dos módulos". Não se comunica com a categorização estruturada; as duas nunca aparecem juntas na tela de produto do frontend.
- **`GET /produtos`/`GET /produtos/:id` passam a incluir `categorias`** (`[{ id, nivel, codigo, nome }]`) por produto — necessário pra tela de edição mostrar o que já foi categorizado antes de uma nova chamada a `PATCH /:id/categoria`. Categoria soft-deletada continua aparecendo aqui se ainda vinculada a um produto (vínculo não cascade-deleta).
- **Migration pendente de aplicação manual em `ci-test`, dev (fora desta sessão) e produção** — só foi aplicada no banco de dev local usado durante esta implementação. Aplicar antes do merge/deploy, como de costume neste projeto (não existe runner automático de migration).
- Fora do escopo desta etapa: código de barras, geração de etiqueta, leitura de código de barras no PDV.
```

Also add a line to "Estado atual dos módulos" (Prontos), right after the "Anonimização de clientes (LGPD)" bullet:
```markdown
- **Categorias de produto + SKU automático** — migration `019_categorias_produto.sql`: CRUD de categorias em `/categorias` (admin+estoquista), geração automática e imutável de SKU via `PATCH /produtos/:id/categoria`. Ver `## Regras já decididas em categorias de produto + SKU automático` abaixo.
```

- [ ] **Step 2: Commit the CLAUDE.md update**

```bash
git add CLAUDE.md
git commit -m "docs: fecha regras de categorias de produto e SKU automatico no CLAUDE.md"
```

- [ ] **Step 3: Run the full test suite once**

```bash
npx jest
```

Expected: all suites pass (note: `tests/routes/multiTenantIsolation.test.js` talks to a real database per `CLAUDE.md`'s CI section — if it fails locally for a connectivity reason unrelated to this change, that's expected outside CI; every other suite must be green).

- [ ] **Step 4: Report to the user**

Summarize: what changed, decisions made solo vs. confirmed with the user (multi-tenant SKU-uniqueness reversal, categoria/nivel immutability, sequence keyed on código text), what was tested, the final commit hash, and the reminder that migration `019` still needs to be applied manually to `ci-test`, dev (other machines), and production after merge.

Also flag two items that belong to a future `cherry-frontend` session (out of scope for this repo/plan, but easy to lose track of otherwise): (1) the category form must warn, before save, that `codigo`/`nivel` can't be changed after creation (spec's "Requisito de UI" section); (2) the "Sem SKU" badge in the product listing — the backend already returns `sku: null` for uncategorized products, same pattern as the existing "sem preço definido" badge, so no backend work remains, only the frontend render.

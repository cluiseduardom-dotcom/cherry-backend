# Relatório agregado de giro e cobertura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar `GET /dashboard/giro-cobertura`, um relatório agregado (total da empresa, quebra por nível de categoria, top/menor 10 produtos por giro) construído sobre o `getGiroECobertura` existente, sem alterá-lo.

**Architecture:** Repository novo (funções puramente de leitura, sem lock — não usa `executarComLock`) devolve dados crus por produto + vínculos produto↔categoria + níveis existentes. Um util puro (`src/utils/agregacaoGiroCobertura.js`, mesmo padrão de `src/utils/rateioCustoFixo.js`) faz TODA a aritmética de soma/soma em JS — isso é o que garante (e torna testável sem banco real) a regra "giro do grupo ≠ média dos giros individuais" e a não-inflação de somas quando um produto tem categoria em vários níveis. O service compõe repository + util; controller/rota seguem o padrão existente de `dashboardController`/`dashboard.js` (mesmo `parseDias`, mesmo mount `/dashboard` já `requireAdmin`).

**Tech Stack:** Node.js/Express, `pg`, Jest + supertest.

**Spec:** Consulte a mensagem de tarefa do usuário nesta sessão (não há arquivo de spec separado — os requisitos completos, incluindo regra de agregação soma/soma, formato de resposta, casos de borda e checklist de testes, estão na issue-prompt original). Ler também `docs/superpowers/specs/2026-09-12-categorias-sku-design.md` e as seções "Regras já decididas em categorias de produto + SKU automático" e "Regras já decididas em rótulos de nível de categoria" do `CLAUDE.md` — não reabrir nenhuma decisão de lá.

## Global Constraints

- Não alterar `dashboardRepository.getGiroECobertura`, `GET /dashboard/giro`, `GET /dashboard/cobertura` — só adicionar.
- `empresa_id` sempre de `req.usuario.empresa_id`, nunca de query/body.
- Giro/cobertura de grupo = SOMA(vendido)/SOMA(estoque) e SOMA(estoque)/(SOMA(vendido)/dias) — nunca média de razões individuais.
- Mesmas regras de NULL do cálculo por produto: soma de estoque = 0 → giro NULL; soma de vendido = 0 → cobertura NULL.
- Produto sem categoria nunca some do total nem dos rankings; nas quebras por nível vira bucket explícito "Sem categoria".
- `menor_giro` exclui produtos com giro NULL (estoque zerado) — documentar no código.
- Nenhum rótulo de nível hardcoded — vem de `niveis_categoria`, pode ser `null`.
- Rota nova em `/dashboard`, portanto já atrás de `requireAdmin` via mount em `app.js` — não montar com regra própria.
- `?dias` usa o mesmo `parseDias` (padrão 90, teto 365) já existente em `dashboardController.js`.
- Nenhuma migration nova: `idx_produtos_categorias_empresa_id` e `idx_categorias_produto_empresa_id` já existem (migration `019_categorias_produto.sql`) e cobrem os padrões de acesso desta query — checado antes de escrever o plano.

---

## File Structure

- **Create:** `src/utils/agregacaoGiroCobertura.js` — funções puras: `calcularGiro`, `calcularCobertura`, `agregarGrupo`, `agregarPorNivel`, `montarRankings`.
- **Create:** `tests/utils/agregacaoGiroCobertura.test.js`.
- **Modify:** `src/repositories/dashboardRepository.js` — adiciona `getVendasEstoquePorProduto`, `getVinculosCategoriasProdutos`, `getNiveisExistentes`.
- **Create:** `tests/repositories/dashboardRepository.test.js` (não existe hoje — repository não tinha teste dedicado; este arquivo cobre só as 3 funções novas).
- **Modify:** `src/services/dashboardService.js` — adiciona `giroCoberturaAgregado(dias, empresaId)`.
- **Modify:** `tests/services/dashboardService.test.js` — adiciona testes de `giroCoberturaAgregado`.
- **Modify:** `src/controllers/dashboardController.js` — adiciona handler `giroCoberturaAgregado`.
- **Modify:** `src/routes/dashboard.js` — adiciona `GET /giro-cobertura`.
- **Modify:** `tests/routes/dashboard.test.js` — inclui `/dashboard/giro-cobertura` no `describe.each` de RBAC/200 e nos testes de `?dias`; adiciona teste de isolamento por empresa.
- **Modify:** `CLAUDE.md` — nova nota de módulo, seguindo o padrão das entradas existentes.

---

### Task 1: Util de agregação (`src/utils/agregacaoGiroCobertura.js`)

**Files:**
- Create: `src/utils/agregacaoGiroCobertura.js`
- Test: `tests/utils/agregacaoGiroCobertura.test.js`

**Interfaces:**
- Produces:
  - `calcularGiro(quantidadeVendida: number, estoqueAtual: number): number | null`
  - `calcularCobertura(quantidadeVendida: number, estoqueAtual: number, dias: number): number | null`
  - `agregarGrupo(produtos: Array<{id, nome, sku, estoque_atual: number, quantidade_vendida_periodo: number}>, dias: number): {estoque_atual: number, quantidade_vendida_periodo: number, giro: number|null, cobertura: number|null}`
  - `agregarPorNivel(produtos, vinculos: Array<{produto_id, nivel, categoria_id, categoria_nome}>, niveisExistentes: number[], rotulosPorNivel: Map<number,string>, dias: number): Array<{nivel, rotulo: string|null, categorias: Array<{categoria_id: number|null, nome, estoque_atual, quantidade_vendida_periodo, giro, cobertura}>}>`
  - `montarRankings(produtos, dias: number, limite?: number): {topGiro: Array<RankingRow>, menorGiro: Array<RankingRow>}` onde `RankingRow = {id, nome, sku, giro, cobertura, quantidade_vendida_periodo, estoque_atual, giro_alto_por_falta_de_estoque: boolean}`.
- Consumes: nada (função pura, zero dependências externas).

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/utils/agregacaoGiroCobertura.test.js
const {
  calcularGiro,
  calcularCobertura,
  agregarGrupo,
  agregarPorNivel,
  montarRankings
} = require('../../src/utils/agregacaoGiroCobertura');

describe('calcularGiro', () => {
  test('divide vendido pelo estoque e arredonda em 2 casas', () => {
    expect(calcularGiro(5, 10)).toBe(0.5);
    expect(calcularGiro(1, 3)).toBe(0.33);
  });

  test('retorna null quando estoque atual é zero', () => {
    expect(calcularGiro(5, 0)).toBeNull();
  });

  test('retorna zero (não null) quando vendido é zero mas há estoque', () => {
    expect(calcularGiro(0, 10)).toBe(0);
  });
});

describe('calcularCobertura', () => {
  test('estoque dividido pela média diária vendida, arredondado em 1 casa', () => {
    // média diária = 30/90 = 0.333..., estoque 100 / 0.333... = 300
    expect(calcularCobertura(30, 100, 90)).toBe(300);
  });

  test('retorna null quando nada foi vendido no período', () => {
    expect(calcularCobertura(0, 100, 90)).toBeNull();
  });
});

describe('agregarGrupo', () => {
  test('agrega por SOMA/SOMA, não pela média dos giros individuais', () => {
    const produtos = [
      { id: 1, estoque_atual: 10, quantidade_vendida_periodo: 5 }, // giro individual 0.5
      { id: 2, estoque_atual: 100, quantidade_vendida_periodo: 5 } // giro individual 0.05
    ];

    const resultado = agregarGrupo(produtos, 90);

    // média ingênua dos giros individuais seria (0.5 + 0.05) / 2 = 0.275
    const mediaIngenua = 0.275;
    expect(resultado.giro).not.toBe(mediaIngenua);
    // soma/soma correto: 10 vendido / 110 estoque
    expect(resultado.estoque_atual).toBe(110);
    expect(resultado.quantidade_vendida_periodo).toBe(10);
    expect(resultado.giro).toBeCloseTo(10 / 110, 2);
  });

  test('giro null quando soma do estoque do grupo é zero', () => {
    const produtos = [
      { id: 1, estoque_atual: 0, quantidade_vendida_periodo: 5 },
      { id: 2, estoque_atual: 0, quantidade_vendida_periodo: 3 }
    ];

    const resultado = agregarGrupo(produtos, 90);

    expect(resultado.giro).toBeNull();
  });

  test('cobertura null quando soma do vendido do grupo é zero', () => {
    const produtos = [
      { id: 1, estoque_atual: 10, quantidade_vendida_periodo: 0 },
      { id: 2, estoque_atual: 20, quantidade_vendida_periodo: 0 }
    ];

    const resultado = agregarGrupo(produtos, 90);

    expect(resultado.cobertura).toBeNull();
  });

  test('grupo vazio soma zero e devolve giro/cobertura null', () => {
    const resultado = agregarGrupo([], 90);

    expect(resultado).toEqual({
      estoque_atual: 0,
      quantidade_vendida_periodo: 0,
      giro: null,
      cobertura: null
    });
  });
});

describe('agregarPorNivel', () => {
  const produtos = [
    { id: 1, nome: 'Colar Prata', sku: 'A', estoque_atual: 10, quantidade_vendida_periodo: 5 },
    { id: 2, nome: 'Pingente Ouro', sku: 'B', estoque_atual: 20, quantidade_vendida_periodo: 10 },
    { id: 3, nome: 'Sem categoria nenhuma', sku: null, estoque_atual: 5, quantidade_vendida_periodo: 1 }
  ];

  // produto 1: família=Colares (nivel 1), material=Prata (nivel 2)
  // produto 2: família=Pingentes (nivel 1), material=Ouro (nivel 2)
  // produto 3: sem nenhum vínculo
  const vinculos = [
    { produto_id: 1, nivel: 1, categoria_id: 10, categoria_nome: 'Colares' },
    { produto_id: 1, nivel: 2, categoria_id: 20, categoria_nome: 'Prata' },
    { produto_id: 2, nivel: 1, categoria_id: 11, categoria_nome: 'Pingentes' },
    { produto_id: 2, nivel: 2, categoria_id: 21, categoria_nome: 'Ouro' }
  ];

  test('produto com categoria em múltiplos níveis aparece em cada quebra sem inflar somas', () => {
    const resultado = agregarPorNivel(produtos, vinculos, [1, 2], new Map(), 90);

    expect(resultado).toHaveLength(2);

    for (const grupoNivel of resultado) {
      const somaQuantidade = grupoNivel.categorias.reduce((soma, c) => soma + c.quantidade_vendida_periodo, 0);
      const somaEstoque = grupoNivel.categorias.reduce((soma, c) => soma + c.estoque_atual, 0);
      // soma de TODAS as categorias (incluindo "sem categoria") do nível
      // precisa bater com a soma de todos os produtos — nunca mais, nunca menos.
      expect(somaQuantidade).toBe(16); // 5 + 10 + 1
      expect(somaEstoque).toBe(35); // 10 + 20 + 5
    }
  });

  test('produto sem categoria vai pro bucket explícito "Sem categoria" em todo nível existente', () => {
    const resultado = agregarPorNivel(produtos, vinculos, [1, 2], new Map(), 90);

    for (const grupoNivel of resultado) {
      const semCategoria = grupoNivel.categorias.find((c) => c.categoria_id === null);
      expect(semCategoria).toBeDefined();
      expect(semCategoria.nome).toBe('Sem categoria');
      expect(semCategoria.quantidade_vendida_periodo).toBe(1);
      expect(semCategoria.estoque_atual).toBe(5);
    }
  });

  test('usa o rótulo de niveis_categoria quando existe, null quando não existe', () => {
    const rotulos = new Map([[1, 'família']]);
    const resultado = agregarPorNivel(produtos, vinculos, [1, 2], rotulos, 90);

    expect(resultado.find((n) => n.nivel === 1).rotulo).toBe('família');
    expect(resultado.find((n) => n.nivel === 2).rotulo).toBeNull();
  });

  test('lista de níveis existentes vazia devolve array vazio', () => {
    expect(agregarPorNivel(produtos, vinculos, [], new Map(), 90)).toEqual([]);
  });
});

describe('montarRankings', () => {
  test('exclui produtos com giro null (estoque zerado) de AMBOS os rankings', () => {
    const produtos = [
      { id: 1, nome: 'A', sku: 'A1', estoque_atual: 0, quantidade_vendida_periodo: 50 }, // giro null
      { id: 2, nome: 'B', sku: 'B1', estoque_atual: 10, quantidade_vendida_periodo: 5 }
    ];

    const { topGiro, menorGiro } = montarRankings(produtos, 90);

    expect(topGiro.find((p) => p.id === 1)).toBeUndefined();
    expect(menorGiro.find((p) => p.id === 1)).toBeUndefined();
    expect(topGiro).toHaveLength(1);
    expect(menorGiro).toHaveLength(1);
  });

  test('flag giro_alto_por_falta_de_estoque é relativa à venda, não um limiar fixo', () => {
    const produtos = [
      { id: 1, nome: 'A', sku: 'A1', estoque_atual: 3, quantidade_vendida_periodo: 5 }, // 3 < 5 => true
      { id: 2, nome: 'B', sku: 'B1', estoque_atual: 100, quantidade_vendida_periodo: 5 } // 100 >= 5 => false
    ];

    const { topGiro } = montarRankings(produtos, 90);

    expect(topGiro.find((p) => p.id === 1).giro_alto_por_falta_de_estoque).toBe(true);
    expect(topGiro.find((p) => p.id === 2).giro_alto_por_falta_de_estoque).toBe(false);
  });

  test('topGiro ordena decrescente, menorGiro ordena crescente, limitado a `limite`', () => {
    const produtos = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      nome: `Produto ${i + 1}`,
      sku: `SKU${i + 1}`,
      estoque_atual: 10,
      quantidade_vendida_periodo: i + 1 // giro cresce com o id: 0.1, 0.2, ..., 1.5
    }));

    const { topGiro, menorGiro } = montarRankings(produtos, 90, 10);

    expect(topGiro).toHaveLength(10);
    expect(menorGiro).toHaveLength(10);
    expect(topGiro[0].id).toBe(15);
    expect(topGiro[9].id).toBe(6);
    expect(menorGiro[0].id).toBe(1);
    expect(menorGiro[9].id).toBe(10);
  });

  test('produto com giro e cobertura empatados usa id como desempate estável', () => {
    const produtos = [
      { id: 2, nome: 'B', sku: 'B1', estoque_atual: 10, quantidade_vendida_periodo: 5 },
      { id: 1, nome: 'A', sku: 'A1', estoque_atual: 10, quantidade_vendida_periodo: 5 }
    ];

    const { topGiro } = montarRankings(produtos, 90);

    expect(topGiro.map((p) => p.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx jest tests/utils/agregacaoGiroCobertura.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/agregacaoGiroCobertura'`

- [ ] **Step 3: Implementar o util**

```javascript
// src/utils/agregacaoGiroCobertura.js
//
// Giro e cobertura de um GRUPO de produtos (total da empresa, ou uma
// categoria dentro de um nível) nunca são a média dos giros/coberturas
// individuais dos produtos — média de razões distorce o resultado. Sempre:
//   giro_do_grupo      = SOMA(vendido no período) / SOMA(estoque atual)
//   cobertura_do_grupo = SOMA(estoque atual) / (SOMA(vendido) / dias)
// Por isso a agregação vive aqui, em JS puro, reusando a mesma fórmula
// (calcularGiro/calcularCobertura) tanto pra um produto isolado quanto pra
// qualquer grupo — garante que a regra nunca diverge entre os dois casos.
// Mesmo padrão de módulo puro e testável isoladamente de src/utils/rateioCustoFixo.js.

function arredondar(valor, casas) {
    const fator = 10 ** casas;
    return Math.round((valor + Number.EPSILON) * fator) / fator;
}

// NULL quando estoque atual = 0 (não dá pra "girar" um estoque que não existe).
function calcularGiro(quantidadeVendida, estoqueAtual) {
    if (estoqueAtual === 0) return null;
    return arredondar(quantidadeVendida / estoqueAtual, 2);
}

// NULL quando nada foi vendido no período (não dá pra estimar "quantos dias
// dura" um ritmo de venda zero).
function calcularCobertura(quantidadeVendida, estoqueAtual, dias) {
    if (quantidadeVendida === 0) return null;
    return arredondar(estoqueAtual / (quantidadeVendida / dias), 1);
}

function agregarGrupo(produtos, dias) {
    const estoqueAtual = produtos.reduce((soma, p) => soma + p.estoque_atual, 0);
    const quantidadeVendidaPeriodo = produtos.reduce((soma, p) => soma + p.quantidade_vendida_periodo, 0);

    return {
        estoque_atual: estoqueAtual,
        quantidade_vendida_periodo: quantidadeVendidaPeriodo,
        giro: calcularGiro(quantidadeVendidaPeriodo, estoqueAtual),
        cobertura: calcularCobertura(quantidadeVendidaPeriodo, estoqueAtual, dias)
    };
}

const NOME_SEM_CATEGORIA = 'Sem categoria';

// vinculos: [{ produto_id, nivel, categoria_id, categoria_nome }] — pode ter
// várias linhas por produto (uma por nível em que ele está categorizado).
// niveisExistentes: números de nível com pelo menos uma categoria ativa
// cadastrada na empresa (não depende de já ter produto vinculado).
// rotulosPorNivel: Map(nivel -> nome) vindo de niveis_categoria; nível sem
// rótulo cadastrado não é erro, só fica null pro frontend rotular.
function agregarPorNivel(produtos, vinculos, niveisExistentes, rotulosPorNivel, dias) {
    return niveisExistentes.map((nivel) => {
        // Filtra os vínculos DESTE nível antes de montar o mapa produto->categoria:
        // isso é o que garante que um produto com categoria em 2+ níveis apareça
        // em cada quebra de nível separadamente, sem que as linhas de um nível
        // vazem pra soma de outro (evita o JOIN-multiplicando-linhas do enunciado).
        const categoriaDoProdutoNesteNivel = new Map();
        for (const vinculo of vinculos) {
            if (vinculo.nivel === nivel) categoriaDoProdutoNesteNivel.set(vinculo.produto_id, vinculo);
        }

        const grupos = new Map(); // chave: categoria_id ou null (sem categoria)
        for (const produto of produtos) {
            const vinculo = categoriaDoProdutoNesteNivel.get(produto.id);
            const chave = vinculo ? vinculo.categoria_id : null;
            const nome = vinculo ? vinculo.categoria_nome : NOME_SEM_CATEGORIA;

            if (!grupos.has(chave)) grupos.set(chave, { nome, produtos: [] });
            grupos.get(chave).produtos.push(produto);
        }

        const categorias = Array.from(grupos.entries()).map(([categoria_id, grupo]) => ({
            categoria_id,
            nome: grupo.nome,
            ...agregarGrupo(grupo.produtos, dias)
        }));

        return {
            nivel,
            rotulo: rotulosPorNivel.get(nivel) ?? null,
            categorias
        };
    });
}

// Rankings por produto individual. Produtos com giro NULL (estoque_atual = 0)
// não entram em NENHUM dos dois rankings: giro null não é ordenável, e no
// caso específico de menor_giro isso também é regra de negócio — sem estoque
// não há capital parado, que é o que essa visão quer mostrar.
function montarRankings(produtos, dias, limite = 10) {
    const comGiro = produtos
        .map((produto) => ({
            id: produto.id,
            nome: produto.nome,
            sku: produto.sku,
            giro: calcularGiro(produto.quantidade_vendida_periodo, produto.estoque_atual),
            cobertura: calcularCobertura(produto.quantidade_vendida_periodo, produto.estoque_atual, dias),
            quantidade_vendida_periodo: produto.quantidade_vendida_periodo,
            estoque_atual: produto.estoque_atual,
            // Relativo à venda do período, não um limiar fixo de unidades.
            giro_alto_por_falta_de_estoque: produto.estoque_atual < produto.quantidade_vendida_periodo
        }))
        .filter((produto) => produto.giro !== null);

    const porIdAsc = (a, b) => a.id - b.id;

    const topGiro = [...comGiro].sort((a, b) => b.giro - a.giro || porIdAsc(a, b)).slice(0, limite);
    const menorGiro = [...comGiro].sort((a, b) => a.giro - b.giro || porIdAsc(a, b)).slice(0, limite);

    return { topGiro, menorGiro };
}

module.exports = {
    calcularGiro,
    calcularCobertura,
    agregarGrupo,
    agregarPorNivel,
    montarRankings
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx jest tests/utils/agregacaoGiroCobertura.test.js`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add src/utils/agregacaoGiroCobertura.js tests/utils/agregacaoGiroCobertura.test.js
git commit -m "feat(dashboard): util de agregação soma/soma pra giro e cobertura em grupo"
```

---

### Task 2: Funções novas no repository (`dashboardRepository.js`)

**Files:**
- Modify: `src/repositories/dashboardRepository.js`
- Test: `tests/repositories/dashboardRepository.test.js` (novo arquivo)

**Interfaces:**
- Consumes: nada além de `db.query` (`../config/db`), mesmo padrão do arquivo.
- Produces:
  - `getVendasEstoquePorProduto(dias, empresa_id): Promise<Array<{id, nome, sku, estoque_atual, quantidade_vendida_periodo}>>`
  - `getVinculosCategoriasProdutos(empresa_id): Promise<Array<{produto_id, categoria_id, nivel, categoria_nome}>>`
  - `getNiveisExistentes(empresa_id): Promise<number[]>`

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/repositories/dashboardRepository.test.js
jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const dashboardRepository = require('../../src/repositories/dashboardRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getVendasEstoquePorProduto', () => {
  test('devolve valores crus (sem giro/cobertura calculados em SQL), escopado por empresa, produto ativo e período', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, nome: 'Colar', sku: 'BR001', estoque_atual: 10, quantidade_vendida_periodo: '5' }]
    });

    const resultado = await dashboardRepository.getVendasEstoquePorProduto(90, 9);

    expect(resultado).toEqual([{ id: 1, nome: 'Colar', sku: 'BR001', estoque_atual: 10, quantidade_vendida_periodo: '5' }]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("v.status = 'finalizada'");
    expect(sql).toContain('p.ativo = true');
    expect(sql).toContain('p.empresa_id = $2');
    expect(sql).toContain('p.sku');
    expect(sql).not.toMatch(/giro|cobertura/i);
    expect(params).toEqual([90, 9]);
  });
});

describe('getVinculosCategoriasProdutos', () => {
  test('junta produtos_categorias com categorias_produto escopado por empresa, sem filtrar categoria soft-deletada', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ produto_id: 1, categoria_id: 10, nivel: 1, categoria_nome: 'Colares' }]
    });

    const resultado = await dashboardRepository.getVinculosCategoriasProdutos(9);

    expect(resultado).toEqual([{ produto_id: 1, categoria_id: 10, nivel: 1, categoria_nome: 'Colares' }]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('produtos_categorias');
    expect(sql).toContain('categorias_produto');
    expect(sql).toContain('pc.empresa_id = $1');
    expect(sql).not.toContain('deletado_em');
    expect(params).toEqual([9]);
  });
});

describe('getNiveisExistentes', () => {
  test('devolve níveis distintos com categoria ativa, escopado por empresa', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [{ nivel: 1 }, { nivel: 2 }] });

    const resultado = await dashboardRepository.getNiveisExistentes(9);

    expect(resultado).toEqual([1, 2]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('DISTINCT nivel');
    expect(sql).toContain('categorias_produto');
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([9]);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx jest tests/repositories/dashboardRepository.test.js`
Expected: FAIL — `dashboardRepository.getVendasEstoquePorProduto is not a function`

- [ ] **Step 3: Implementar as três funções**

Adicionar ao final de `src/repositories/dashboardRepository.js`, antes do `module.exports`:

```javascript
// Mesma base de getGiroECobertura (produto ativo, vendas 'finalizada' no
// período, escopado por empresa), mas devolve os valores CRUS — sem
// giro/cobertura calculados em SQL — e inclui sku. O relatório agregado
// (GET /dashboard/giro-cobertura) soma esses valores por grupo ANTES de
// dividir (ver src/utils/agregacaoGiroCobertura.js); calcular giro/cobertura
// aqui em SQL faria por produto individual, que é exatamente a média de
// razões que a regra de agregação proíbe pro nível de grupo.
async function getVendasEstoquePorProduto(dias, empresa_id) {
    const { rows } = await db.query(
        `WITH vendidos_periodo AS (
            SELECT iv.produto_id, SUM(iv.quantidade) AS quantidade_vendida
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id
            WHERE v.status = 'finalizada' AND v.data >= NOW() - ($1::text || ' days')::interval
              AND v.empresa_id = $2
            GROUP BY iv.produto_id
        )
        SELECT
            p.id,
            p.nome,
            p.sku,
            p.estoque_atual,
            COALESCE(vp.quantidade_vendida, 0) AS quantidade_vendida_periodo
        FROM produtos p
        LEFT JOIN vendidos_periodo vp ON vp.produto_id = p.id
        WHERE p.ativo = true AND p.empresa_id = $2
        ORDER BY p.id`,
        [dias, empresa_id]
    );

    return rows;
}

// Vínculos produto->categoria pra quebra por nível do relatório de giro e
// cobertura. NÃO filtra categoria soft-deletada (deletado_em): o vínculo em
// produtos_categorias não cascade-deleta (mesma regra já usada em GET
// /produtos), então uma categoria removida continua contribuindo pro grupo
// dela aqui até o produto ser recategorizado.
async function getVinculosCategoriasProdutos(empresa_id) {
    const { rows } = await db.query(
        `SELECT pc.produto_id, cp.id AS categoria_id, cp.nivel, cp.nome AS categoria_nome
         FROM produtos_categorias pc
         JOIN categorias_produto cp ON cp.id = pc.categoria_id
         WHERE pc.empresa_id = $1`,
        [empresa_id]
    );

    return rows;
}

// Níveis "existentes" pra empresa = todo nível com pelo menos uma categoria
// ATIVA cadastrada, independente de já ter produto vinculado a ele. Não vem
// de niveis_categoria (tabela independente que só fornece o rótulo — pode
// ter um nível "nomeado" sem nenhuma categoria criada ainda, o que não
// deveria gerar uma quebra vazia no relatório).
async function getNiveisExistentes(empresa_id) {
    const { rows } = await db.query(
        `SELECT DISTINCT nivel FROM categorias_produto
         WHERE empresa_id = $1 AND deletado_em IS NULL
         ORDER BY nivel ASC`,
        [empresa_id]
    );

    return rows.map((row) => row.nivel);
}
```

E atualizar o `module.exports`:

```javascript
module.exports = {
    getCurvaABC,
    getGiroECobertura,
    getVendasEstoquePorProduto,
    getVinculosCategoriasProdutos,
    getNiveisExistentes
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx jest tests/repositories/dashboardRepository.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repositories/dashboardRepository.js tests/repositories/dashboardRepository.test.js
git commit -m "feat(dashboard): funções de leitura pro relatório agregado de giro e cobertura"
```

---

### Task 3: Service (`dashboardService.js`)

**Files:**
- Modify: `src/services/dashboardService.js`
- Test: `tests/services/dashboardService.test.js`

**Interfaces:**
- Consumes:
  - `dashboardRepository.getVendasEstoquePorProduto(dias, empresaId)`, `.getVinculosCategoriasProdutos(empresaId)`, `.getNiveisExistentes(empresaId)` (Task 2)
  - `niveisCategoriaRepository.listar(empresaId): Promise<Array<{nivel, nome}>>` (já existe em `src/repositories/niveisCategoriaRepository.js`)
  - `agregarGrupo`, `agregarPorNivel`, `montarRankings` de `src/utils/agregacaoGiroCobertura.js` (Task 1)
- Produces: `dashboardService.giroCoberturaAgregado(dias, empresaId): Promise<{total, por_nivel, top_giro, menor_giro}>`

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `tests/services/dashboardService.test.js` (mantendo os mocks/testes existentes intactos — adicionar o mock de `niveisCategoriaRepository` no topo do arquivo):

```javascript
// no topo do arquivo, junto dos outros jest.mock:
jest.mock('../../src/repositories/niveisCategoriaRepository');
// e no require:
const niveisCategoriaRepository = require('../../src/repositories/niveisCategoriaRepository');

// ... (testes existentes continuam iguais) ...

describe('giroCoberturaAgregado', () => {
  beforeEach(() => {
    dashboardRepository.getVendasEstoquePorProduto.mockResolvedValue([
      { id: 1, nome: 'Colar Prata', sku: 'BR001', estoque_atual: 10, quantidade_vendida_periodo: '5' },
      { id: 2, nome: 'Pingente Ouro', sku: null, estoque_atual: 0, quantidade_vendida_periodo: '20' }
    ]);
    dashboardRepository.getVinculosCategoriasProdutos.mockResolvedValue([
      { produto_id: 1, categoria_id: 10, nivel: 1, categoria_nome: 'Colares' }
    ]);
    dashboardRepository.getNiveisExistentes.mockResolvedValue([1]);
    niveisCategoriaRepository.listar.mockResolvedValue([{ nivel: 1, nome: 'família' }]);
  });

  test('monta o payload completo com total, por_nivel, top_giro e menor_giro', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    expect(dashboardRepository.getVendasEstoquePorProduto).toHaveBeenCalledWith(90, 9);
    expect(dashboardRepository.getVinculosCategoriasProdutos).toHaveBeenCalledWith(9);
    expect(dashboardRepository.getNiveisExistentes).toHaveBeenCalledWith(9);
    expect(niveisCategoriaRepository.listar).toHaveBeenCalledWith(9);

    expect(resultado).toHaveProperty('total');
    expect(resultado).toHaveProperty('por_nivel');
    expect(resultado).toHaveProperty('top_giro');
    expect(resultado).toHaveProperty('menor_giro');
    expect(resultado.total.estoque_atual).toBe(10); // 10 + 0
    expect(resultado.total.quantidade_vendida_periodo).toBe(25); // 5 + 20
    expect(resultado.por_nivel).toEqual([
      expect.objectContaining({ nivel: 1, rotulo: 'família' })
    ]);
  });

  test('converte quantidade_vendida_periodo (string do SUM) e estoque_atual pra número antes de agregar', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    // se não converter, '5' + '20' concatenaria como string "520"
    expect(resultado.total.quantidade_vendida_periodo).toBe(25);
  });

  test('produto com estoque zerado (giro null) não aparece em menor_giro', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    expect(resultado.menor_giro.find((p) => p.id === 2)).toBeUndefined();
  });

  test('giro_alto_por_falta_de_estoque é relativo à venda do período', async () => {
    const resultado = await dashboardService.giroCoberturaAgregado(90, 9);

    const produto1 = resultado.top_giro.find((p) => p.id === 1);
    // estoque 10, vendido 5 => 10 >= 5 => false
    expect(produto1.giro_alto_por_falta_de_estoque).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx jest tests/services/dashboardService.test.js`
Expected: FAIL — `dashboardService.giroCoberturaAgregado is not a function`

- [ ] **Step 3: Implementar o service**

```javascript
// src/services/dashboardService.js — topo do arquivo, junto dos outros requires:
const niveisCategoriaRepository = require('../repositories/niveisCategoriaRepository');
const { agregarGrupo, agregarPorNivel, montarRankings } = require('../utils/agregacaoGiroCobertura');

// ... (funções existentes: curvaABC, giro, cobertura, margem, resumo — sem alteração) ...

// Relatório agregado de giro/cobertura: total da empresa, quebra por nível
// de categoria e rankings de produto. Ver src/utils/agregacaoGiroCobertura.js
// pra regra de agregação (soma/soma, nunca média de razões).
async function giroCoberturaAgregado(dias, empresaId) {
    const [produtosRaw, vinculos, niveisExistentes, niveisRotulos] = await Promise.all([
        dashboardRepository.getVendasEstoquePorProduto(dias, empresaId),
        dashboardRepository.getVinculosCategoriasProdutos(empresaId),
        dashboardRepository.getNiveisExistentes(empresaId),
        niveisCategoriaRepository.listar(empresaId)
    ]);

    // SUM(iv.quantidade) volta como bigint (string) do pg — converter antes de
    // somar em JS evita concatenação de string ('5' + '20' = '520').
    const produtos = produtosRaw.map((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        estoque_atual: Number(p.estoque_atual),
        quantidade_vendida_periodo: Number(p.quantidade_vendida_periodo)
    }));

    const rotulosPorNivel = new Map(niveisRotulos.map((n) => [n.nivel, n.nome]));

    const total = agregarGrupo(produtos, dias);
    const por_nivel = agregarPorNivel(produtos, vinculos, niveisExistentes, rotulosPorNivel, dias);
    const { topGiro, menorGiro } = montarRankings(produtos, dias);

    return { total, por_nivel, top_giro: topGiro, menor_giro: menorGiro };
}

module.exports = {
    curvaABC,
    giro,
    cobertura,
    margem,
    resumo,
    giroCoberturaAgregado
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx jest tests/services/dashboardService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dashboardService.js tests/services/dashboardService.test.js
git commit -m "feat(dashboard): service do relatório agregado de giro e cobertura"
```

---

### Task 4: Controller + rota

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Modify: `src/routes/dashboard.js`
- Test: `tests/routes/dashboard.test.js`

**Interfaces:**
- Consumes: `dashboardService.giroCoberturaAgregado(dias, empresaId)` (Task 3), `parseDias` (já existe no próprio controller).
- Produces: `GET /dashboard/giro-cobertura` — mesmo contrato de resposta (`response.success`) dos demais endpoints do módulo.

- [ ] **Step 1: Escrever os testes (falhando)**

Em `tests/routes/dashboard.test.js`, adicionar `/dashboard/giro-cobertura` ao array `endpoints` existente (isso já cobre 401/403 vendedor/403 estoquista/200 admin via o `describe.each` que já existe):

```javascript
const endpoints = [
  ['/dashboard', 'resumo'],
  ['/dashboard/curva-abc', 'curvaABC'],
  ['/dashboard/giro', 'giro'],
  ['/dashboard/cobertura', 'cobertura'],
  ['/dashboard/margem', 'margem'],
  ['/dashboard/giro-cobertura', 'giroCoberturaAgregado']
];
```

E adicionar, no `describe('dias query param (giro, cobertura, resumo)', ...)`, um teste específico:

```javascript
  test('giro-cobertura também respeita o parseDias (padrão 90)', async () => {
    dashboardService.giroCoberturaAgregado.mockResolvedValue({});

    await request(app).get('/dashboard/giro-cobertura').set('Authorization', `Bearer ${adminToken}`);

    expect(dashboardService.giroCoberturaAgregado).toHaveBeenCalledWith(90, 1);
  });
```

E, ao final do arquivo, um teste de isolamento por empresa (novo `describe`):

```javascript
describe('isolamento por empresa em /dashboard/giro-cobertura', () => {
  test('usa o empresa_id do token de cada usuário, nunca um valor fixo', async () => {
    dashboardService.giroCoberturaAgregado.mockResolvedValue({});
    const outraEmpresaToken = makeToken({ id: 4, role: 'admin', empresa_id: 2 });

    await request(app).get('/dashboard/giro-cobertura').set('Authorization', `Bearer ${adminToken}`);
    expect(dashboardService.giroCoberturaAgregado).toHaveBeenLastCalledWith(90, 1);

    await request(app).get('/dashboard/giro-cobertura').set('Authorization', `Bearer ${outraEmpresaToken}`);
    expect(dashboardService.giroCoberturaAgregado).toHaveBeenLastCalledWith(90, 2);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx jest tests/routes/dashboard.test.js`
Expected: FAIL — 404 em `/dashboard/giro-cobertura` (rota ainda não existe) e `dashboardService.giroCoberturaAgregado` undefined no mock.

- [ ] **Step 3: Implementar controller e rota**

Em `src/controllers/dashboardController.js`, adicionar a função (mesmo padrão de `giro`/`cobertura`) e incluir no `module.exports`:

```javascript
async function giroCoberturaAgregado(req, res, next) {
    try {
        const dias = parseDias(req.query);
        const dados = await dashboardService.giroCoberturaAgregado(dias, req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    resumo,
    curvaABC,
    giro,
    cobertura,
    margem,
    giroCoberturaAgregado
};
```

Em `src/routes/dashboard.js`:

```javascript
router.get('/giro-cobertura', controller.giroCoberturaAgregado);
```

(Adicionar essa linha junto das outras, antes do `module.exports = router;`.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx jest tests/routes/dashboard.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/dashboardController.js src/routes/dashboard.js tests/routes/dashboard.test.js
git commit -m "feat(dashboard): expõe GET /dashboard/giro-cobertura"
```

---

### Task 5: Documentação (`CLAUDE.md`) + suíte completa

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Adicionar entrada no "Estado atual dos módulos"**

Localizar a linha do bullet **"Dashboard analítico"** em `CLAUDE.md` e adicionar logo após uma frase citando o novo endpoint, seguindo o estilo das entradas existentes (uma linha curta linkando pra uma seção "Regras já decididas" nova, no mesmo padrão de "Ver `## Regras já decididas em custo congelado`"). Adicionar a nova seção de regras no final do arquivo, próximo às outras seções "Regras já decididas em ... — não reabrir", com o seguinte conteúdo:

```markdown
## Regras já decididas no relatório agregado de giro e cobertura — não reabrir

`GET /dashboard/giro-cobertura` (mesmo mount `/dashboard`, portanto já `requireAdmin`) devolve `total` (giro/cobertura do estoque inteiro da empresa), `por_nivel` (quebra por categoria de cada nível configurado, incluindo bucket explícito "Sem categoria") e `top_giro`/`menor_giro` (10 produtos de maior/menor giro). Não altera `getGiroECobertura` nem `GET /dashboard/giro`/`/cobertura` existentes — é um cluster novo ao lado.

- **Giro/cobertura de grupo é SEMPRE soma/soma, nunca média dos giros individuais**: `giro_do_grupo = SOMA(vendido) / SOMA(estoque)`, `cobertura_do_grupo = SOMA(estoque) / (SOMA(vendido) / dias)`. Média de razões distorce o resultado — um produto de giro alto e estoque baixo não pode "puxar a média" de um grupo dominado por produtos de estoque alto.
- **A aritmética de agregação vive em `src/utils/agregacaoGiroCobertura.js`, função pura, testada sem banco** — mesmo padrão já usado em `src/utils/rateioCustoFixo.js` pro Ponto de Equilíbrio. O repository (`dashboardRepository.getVendasEstoquePorProduto`) devolve valores CRUS por produto (sem giro/cobertura calculados em SQL); calcular em SQL faria por produto individual, que é exatamente a média de razões proibida no nível de grupo.
- **Não existe teste de agregação em `tests/repositories/`** para este endpoint — a correção da agregação (soma/soma, não-inflação de somas com produto multi-nível, exclusão de NULL) é responsabilidade do util puro e está coberta em `tests/utils/agregacaoGiroCobertura.test.js`; o repository só tem teste de wiring de SQL (`tests/repositories/dashboardRepository.test.js`), mesmo critério já usado pros repositories que migraram pra `executarComLock`.
- **Nenhuma migration nova**: `idx_produtos_categorias_empresa_id` e `idx_categorias_produto_empresa_id` já existem desde a migration `019_categorias_produto.sql` e cobrem os padrões de acesso das duas queries novas (`getVinculosCategoriasProdutos`, `getNiveisExistentes`).
- **`por_nivel` não vem de `niveis_categoria`, vem de `categorias_produto`**: um nível "existe" no relatório quando tem pelo menos uma categoria ATIVA cadastrada (`categorias_produto.deletado_em IS NULL`), independente de já ter produto vinculado a ele. `niveis_categoria` só fornece o `rotulo` (nome) de cada nível quando cadastrado — nível sem rótulo aparece com `rotulo: null`, não é erro (mesma regra de "rótulos de nível de categoria" documentada acima). Nenhum rótulo de nível (`família`/`material`/`gênero`) é hardcoded em código.
- **Vínculo com categoria soft-deletada continua contando** no grupo dela no relatório (`getVinculosCategoriasProdutos` não filtra `deletado_em`) — mesma regra já usada em `GET /produtos`, que também continua mostrando a categoria vinculada mesmo depois dela ser soft-deletada; vínculo não cascade-deleta.
- **`menor_giro` exclui produtos com giro `NULL`** (estoque atual zerado) — "sem estoque não há capital parado", que é o propósito dessa visão. `top_giro` também exclui, pelo mesmo motivo técnico (giro `null` não é ordenável) — a exclusão de `menor_giro` é regra de negócio explícita, a de `top_giro` é consequência direta de `null` não poder ser "o maior".
- **`giro_alto_por_falta_de_estoque` é relativo à venda do período** (`estoque_atual < quantidade_vendida_periodo`), não um limiar fixo de unidades — o mesmo produto pode disparar a flag num período de 30 dias e não disparar num período de 365, dependendo do ritmo de venda.
```

- [ ] **Step 2: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os testes (exceto `multiTenantIsolation.test.js`, que já falha em `master` por falta de fixtures cross-tenant no banco de dev local — não causado por esta tarefa, não deve ser "consertado" aqui).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documenta relatório agregado de giro e cobertura no CLAUDE.md"
```

---

## Self-Review Notes (já aplicado ao escrever o plano acima)

- **Cobertura do enunciado**: total ✅ (Task 1 `agregarGrupo` + Task 3), por_nivel com rótulo/null e bucket "Sem categoria" ✅ (Task 1 `agregarPorNivel` + Task 2 `getNiveisExistentes`/`getVinculosCategoriasProdutos`), top_giro/menor_giro com as 6 colunas pedidas + flag ✅ (Task 1 `montarRankings`), exclusão de giro NULL documentada ✅, multi-tenant via `req.usuario.empresa_id` em toda a cadeia ✅ (Task 4), não alterar endpoints existentes ✅ (só adições), sem índice novo (justificado) ✅, nota no CLAUDE.md ✅ (Task 5), branch própria sem push/PR — combinado na entrega, fora do plano.
- **Placeholders**: nenhum "TBD"/"implementar depois" — todo código dos steps é literal, pronto pra copiar.
- **Consistência de tipos**: `agregarGrupo`/`agregarPorNivel`/`montarRankings` usam os mesmos nomes de campo (`estoque_atual`, `quantidade_vendida_periodo`, `giro`, `cobertura`) do Task 1 ao Task 4, sem divergência.

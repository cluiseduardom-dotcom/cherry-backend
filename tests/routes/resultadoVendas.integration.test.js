// Integração (Postgres de testes): resultado/lucro de vendas — por venda, na lista e no período.
// Custo congelado, comissão (estornada não conta), imposto, despesas fixas, cancelada fora, RBAC e isolamento.
jest.setTimeout(60000);
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const A = { u: {} };
const B = { u: {} };
const v = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Lucro Vendas ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'Loja') RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.produtoId = (await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual) VALUES ($1, $2, 'Item', 1, 1, 0) RETURNING id`,
        [alvo.empresaId, `LUC-${rotulo}-${sufixo}`]
    )).rows[0].id;
    for (const papel of ['admin', 'vendedor', 'gerente', 'analista']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
}

async function criarVenda(alvo, { data, status = 'finalizada', subtotal, desconto = 0, juros = 0, itens, comissao = null, vendedor = 'vendedor' }) {
    const total = subtotal - desconto + juros;
    const { rows } = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, usuario_id, status, subtotal, desconto, juros, total, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [alvo.empresaId, alvo.canalId, alvo.u[vendedor], status, subtotal, desconto, juros, total, data]
    );
    for (const [quantidade, preco, custo] of itens) {
        await db.query(
            `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES ($1, $2, $3, $4, $5, $6)`,
            [alvo.empresaId, rows[0].id, alvo.produtoId, quantidade, preco, custo]
        );
    }
    if (comissao) {
        await db.query(
            `INSERT INTO comissoes_venda (venda_id, empresa_id, usuario_id, percentual, base_calculo, valor, status)
             VALUES ($1, $2, $3, 10, $4, $5, $6)`,
            [rows[0].id, alvo.empresaId, alvo.u[vendedor], comissao.base, comissao.valor, comissao.status]
        );
    }
    return rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const PERIODO = 'data_de=2026-03-01&data_ate=2026-04-30';

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    await db.query(`INSERT INTO configuracoes_financeiras (empresa_id, aliquota_imposto) VALUES ($1, 0.10)`, [A.empresaId]);
    // A tem a funcionalidade de análise financeira (despesas fixas); em B ela é desligada (desligar vence o plano).
    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'analise_financeira', true, 'teste', 'teste')`,
        [A.empresaId]
    );
    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'analise_financeira', false, 'teste', 'teste')`,
        [B.empresaId]
    );
    await db.query(
        `INSERT INTO despesas_fixas (empresa_id, categoria, descricao, valor, vigencia_inicio) VALUES ($1, 'estrutural', 'Aluguel', 300, '2026-01-01')`,
        [A.empresaId]
    );

    // V1: receita 180 (200 − 20 de desconto; 5 de juros ficam fora), custo 80, comissão 18.
    v.v1 = await criarVenda(A, { data: '2026-03-10T15:00:00Z', subtotal: 200, desconto: 20, juros: 5, itens: [[2, 100, 40]], comissao: { base: 180, valor: 18, status: 'liberada' } });
    // V4: receita 50, custo 20, comissão ESTORNADA (não conta).
    v.v4 = await criarVenda(A, { data: '2026-03-20T15:00:00Z', subtotal: 50, itens: [[1, 50, 20]], comissao: { base: 50, valor: 5, status: 'estornada' } });
    // V2: abril, receita 100, custo 30.
    v.v2 = await criarVenda(A, { data: '2026-04-05T15:00:00Z', subtotal: 100, itens: [[1, 100, 30]] });
    // V3: cancelada — fora de tudo.
    v.v3 = await criarVenda(A, { data: '2026-03-15T15:00:00Z', status: 'cancelada', subtotal: 500, itens: [[1, 500, 100]] });
    // Venda de B no mesmo período: nunca aparece em A.
    await criarVenda(B, { data: '2026-03-12T15:00:00Z', subtotal: 999, itens: [[1, 999, 1]] });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('resultado por venda', () => {
    test('admin vê receita, custo, bruto, líquido e % (juros fora da receita)', async () => {
        const res = await get(A, 'admin', `/vendas/${v.v1}`);

        expect(res.status).toBe(200);
        expect(res.body.data.resultado).toEqual({
            receita: 180, custo: 80, lucro_bruto: 100, margem_bruta_pct: 55.56,
            comissao: 18, impostos: 18, lucro_liquido: 64, margem_liquida_pct: 35.56,
            inclui_despesas_fixas: false
        });
    });

    test('comissão estornada não é abatida', async () => {
        const res = await get(A, 'admin', `/vendas/${v.v4}`);

        expect(res.body.data.resultado).toMatchObject({ receita: 50, custo: 20, lucro_bruto: 30, comissao: 0, impostos: 5, lucro_liquido: 25 });
    });

    test('venda cancelada não tem resultado', async () => {
        expect((await get(A, 'admin', `/vendas/${v.v3}`)).body.data.resultado).toBeNull();
    });

    test('vendedor nunca recebe resultado, nem na venda nem na lista', async () => {
        const um = await get(A, 'vendedor', `/vendas/${v.v1}`);
        const lista = await get(A, 'vendedor', '/vendas');

        expect(um.status).toBe(200);
        expect(um.body.data).not.toHaveProperty('resultado');
        expect(lista.body.data.items.length).toBeGreaterThan(0);
        for (const item of lista.body.data.items) expect(item).not.toHaveProperty('resultado');
    });

    test('analista (sem ver_custos) não recebe; gerente (ver_custos) recebe', async () => {
        // Analista só enxerga as próprias vendas (sem ver_vendas_de_todos): a lista vem vazia, e nunca com resultado.
        const listaAnalista = await get(A, 'analista', '/vendas');
        expect(listaAnalista.status).toBe(200);
        for (const item of listaAnalista.body.data.items) expect(item).not.toHaveProperty('resultado');
        expect((await get(A, 'gerente', `/vendas/${v.v1}`)).body.data.resultado).toMatchObject({ lucro_bruto: 100 });
    });

    test('lista traz resultado em cada venda (cancelada = null)', async () => {
        const res = await get(A, 'admin', '/vendas?pageSize=100');
        const porId = Object.fromEntries(res.body.data.items.map((i) => [i.id, i]));

        expect(porId[v.v1].resultado).toMatchObject({ lucro_bruto: 100, lucro_liquido: 64 });
        expect(porId[v.v2].resultado).toMatchObject({ lucro_bruto: 70, lucro_liquido: 60 });
        expect(porId[v.v3].resultado).toBeNull();
    });
});

describe('GET /vendas/resultado (período)', () => {
    test('exige ver_custos: vendedor e analista 403; gerente e admin 200', async () => {
        expect((await get(A, 'vendedor', `/vendas/resultado?${PERIODO}`)).status).toBe(403);
        expect((await get(A, 'analista', `/vendas/resultado?${PERIODO}`)).status).toBe(403);
        expect((await get(A, 'gerente', `/vendas/resultado?${PERIODO}`)).status).toBe(200);
        expect((await get(A, 'admin', `/vendas/resultado?${PERIODO}`)).status).toBe(200);
    });

    test('totais do período: cancelada e outra empresa fora; admin com a funcionalidade abate despesas fixas', async () => {
        const res = await get(A, 'admin', `/vendas/resultado?${PERIODO}`);

        expect(res.status).toBe(200);
        // receita 180+50+100 = 330; custo 80+20+30 = 130; bruto 200; comissão 18; imposto 33; líquido 149;
        // despesas fixas 2 meses cheios = 600; após despesas 149 − 600 = −451
        expect(res.body.data.totais).toEqual({
            vendas: 3, receita: 330, custo: 130, lucro_bruto: 200, margem_bruta_pct: 60.61,
            comissao: 18, impostos: 33, lucro_liquido: 149, margem_liquida_pct: 45.15,
            despesas_fixas: 600, lucro_apos_despesas_fixas: -451, margem_apos_despesas_fixas_pct: -136.67
        });
        expect(res.body.data).not.toHaveProperty('serie');
    });

    test('série por mês, incluindo mês sem venda (que também carrega despesa fixa)', async () => {
        const res = await get(A, 'admin', '/vendas/resultado?data_de=2026-02-01&data_ate=2026-04-30&agrupar=mes');
        const serie = res.body.data.serie;

        expect(serie.map((s) => s.mes)).toEqual(['2026-02', '2026-03', '2026-04']);
        expect(serie[0]).toMatchObject({ vendas: 0, receita: 0, lucro_bruto: 0, margem_bruta_pct: null, despesas_fixas: 300, lucro_apos_despesas_fixas: -300 });
        expect(serie[1]).toMatchObject({ vendas: 2, receita: 230, custo: 100, lucro_bruto: 130, comissao: 18, impostos: 23, lucro_liquido: 89, despesas_fixas: 300 });
        expect(serie[2]).toMatchObject({ vendas: 1, receita: 100, lucro_bruto: 70, lucro_liquido: 60 });
    });

    test('série por dia respeita o dia de São Paulo', async () => {
        const res = await get(A, 'admin', '/vendas/resultado?data_de=2026-03-09&data_ate=2026-03-11&agrupar=dia');

        expect(res.body.data.serie.map((s) => [s.dia, s.receita])).toEqual([['2026-03-09', 0], ['2026-03-10', 180], ['2026-03-11', 0]]);
    });

    test('gerente (sem ser admin) não recebe despesas fixas', async () => {
        const res = await get(A, 'gerente', `/vendas/resultado?${PERIODO}`);

        expect(res.body.data.totais).toMatchObject({ lucro_liquido: 149, despesas_fixas: null, lucro_apos_despesas_fixas: null });
        expect(res.body.data.sem_despesas_fixas).toBeNull();
    });

    test('admin de empresa sem a funcionalidade não recebe despesas fixas, e só vê a própria empresa', async () => {
        const res = await get(B, 'admin', `/vendas/resultado?${PERIODO}`);

        expect(res.body.data.totais).toMatchObject({ vendas: 1, receita: 999, despesas_fixas: null });
    });

    test('validações: datas, ordem, limites e agrupamento', async () => {
        expect((await get(A, 'admin', '/vendas/resultado')).status).toBe(400);
        expect((await get(A, 'admin', '/vendas/resultado?data_de=2026-04-30&data_ate=2026-03-01')).status).toBe(400);
        expect((await get(A, 'admin', '/vendas/resultado?data_de=2020-01-01&data_ate=2026-03-01')).status).toBe(400);
        expect((await get(A, 'admin', '/vendas/resultado?data_de=2026-01-01&data_ate=2026-12-31&agrupar=dia')).status).toBe(400);
        expect((await get(A, 'admin', `/vendas/resultado?${PERIODO}&agrupar=ano`)).status).toBe(400);
    });
});

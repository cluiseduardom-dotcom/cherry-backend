// Integração (Postgres de testes): receita com rendimento e unidade-base inteira (Fracionado, etapa 1).
// Quantidades seguem inteiras (gramas, ml); a ficha diz o consumo POR RECEITA e quantas unidades ela rende.
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

const A = { u: {}, p: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Fracionado ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'estoquista']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'pcp', true, 'teste', 'teste')`,
        [alvo.empresaId]
    );
}

async function criarProduto(alvo, chave, { tipo = 'acabado', custo = 0, estoque = 0, unidade = 'UN' } = {}) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, tipo, unidade) VALUES ($1, $2, $3, $4, 1, $5, $6, $7) RETURNING id`,
        [alvo.empresaId, `FRA-${chave}-${alvo.empresaId}-${sufixo}`, `Item ${chave}`, custo, estoque, tipo, unidade]
    );
    alvo.p[chave] = rows[0].id;

    if (estoque > 0) {
        let central = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0];

        if (!central) {
            central = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [alvo.empresaId])).rows[0];
        }
        await db.query(`INSERT INTO estoque_locais (empresa_id, local_id, produto_id, saldo) VALUES ($1, $2, $3, $4)`, [alvo.empresaId, central.id, rows[0].id, estoque]);
    }
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const enviar = (metodo) => (alvo, papel, url, corpo) => request(app)[metodo](url).set(como(alvo, papel)).send(corpo);
const post = enviar('post');
const patch = enviar('patch');
const estoque = async (alvo, chave) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [alvo.p[chave]])).rows[0].estoque_atual;
const reporSaldo = async (alvo, chave, saldo) => {
    await db.query('UPDATE estoque_locais SET saldo = $1 WHERE produto_id = $2', [saldo, alvo.p[chave]]);
    await db.query('UPDATE produtos SET estoque_atual = $1 WHERE id = $2', [saldo, alvo.p[chave]]);
};

// Brigadeiro: uma receita rende 12 unidades e leva 500 g de leite condensado (R$ 0,0125/g) e 6 colheres de chocolate (R$ 1,00).
const RECEITA = (p) => [{ insumo_produto_id: p.leite, quantidade_necessaria: 500 }, { insumo_produto_id: p.choco, quantidade_necessaria: 6 }];

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarProduto(A, 'brigadeiro');
    await criarProduto(A, 'leite', { tipo: 'insumo', custo: 0.0125, estoque: 1000, unidade: 'G' });
    await criarProduto(A, 'choco', { tipo: 'insumo', custo: 1, estoque: 4 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('unidade-base e custo com mais casas', () => {
    test('produto aceita unidade G e ML, recusa KG/L (conversão é só da tela); custo de 4 casas é guardado inteiro', async () => {
        const base = { nome: `Leite cond ${sufixo}`, custo: 0.0125, tipo: 'insumo' };

        const ok = await post(A, 'admin', '/produtos', { ...base, unidade: 'G' });

        expect(ok.status).toBe(201);
        expect(ok.body.data.unidade).toBe('G');
        expect(Number(ok.body.data.custo)).toBe(0.0125); // antes seria 0,01 (NUMERIC(10,2))
        expect((await post(A, 'admin', '/produtos', { ...base, nome: `Suco ${sufixo}`, unidade: 'ML' })).status).toBe(201);
        expect((await post(A, 'admin', '/produtos', { ...base, nome: `Arroz ${sufixo}`, unidade: 'KG' })).status).toBe(400);
        expect((await post(A, 'admin', '/produtos', { ...base, nome: `Agua ${sufixo}`, unidade: 'L' })).status).toBe(400);
    });
});

describe('ficha técnica com rendimento', () => {
    test('salva e devolve o rendimento; custo por receita e por unidade; padrão 1', async () => {
        const res = await post(A, 'admin', `/produtos/${A.p.brigadeiro}/ficha-tecnica`, { rendimento: 12, itens: RECEITA(A.p) });

        expect(res.status).toBe(201);
        expect(res.body.data.rendimento).toBe(12);
        // receita: 500 × 0,0125 + 6 × 1 = 12,25; por unidade (÷ 12) = 1,0208
        expect(res.body.data).toMatchObject({ custo_receita: 12.25, custo_sugerido: 1.0208 });
        expect(res.body.data.itens.find((i) => i.insumo_produto_id === A.p.leite)).toMatchObject({ quantidade_necessaria: 500, subtotal_custo: 6.25 });

        const vigente = await get(A, 'admin', `/produtos/${A.p.brigadeiro}/ficha-tecnica`);

        expect(vigente.body.data).toMatchObject({ rendimento: 12, custo_receita: 12.25 });

        await criarProduto(A, 'sem_rendimento');
        const padrao = await post(A, 'admin', `/produtos/${A.p.sem_rendimento}/ficha-tecnica`, { itens: [{ insumo_produto_id: A.p.choco, quantidade_necessaria: 2 }] });

        expect(padrao.body.data.rendimento).toBe(1);
        expect(padrao.body.data.custo_sugerido).toBe(2);
    });

    test('estoquista não recebe custo (nem o da receita)', async () => {
        const res = await get(A, 'estoquista', `/produtos/${A.p.brigadeiro}/ficha-tecnica`);

        expect(res.status).toBe(200);
        expect(res.body.data.rendimento).toBe(12);
        for (const campo of ['custo_sugerido', 'custo_receita']) expect(res.body.data).not.toHaveProperty(campo);
        expect(res.body.data.itens[0]).not.toHaveProperty('subtotal_custo');
    });

    test('rendimento inválido = 400 (zero, decimal, muito alto, texto)', async () => {
        for (const rendimento of [0, -1, 1.5, 2000000, 'abc']) {
            const res = await post(A, 'admin', `/produtos/${A.p.brigadeiro}/ficha-tecnica`, { rendimento, itens: RECEITA(A.p) });

            expect(res.status).toBe(400);
        }
    });
});

describe('necessidade de material com rendimento', () => {
    test('10 unidades = 10/12 da receita (arredonda para cima); máximo produzível pelo gargalo', async () => {
        const res = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.brigadeiro}&quantidade=10`);

        expect(res.status).toBe(200);
        const por = Object.fromEntries(res.body.data.insumos.map((i) => [i.nome, i]));

        // leite: ceil(500 × 10 ÷ 12) = 417 g (há 1000); chocolate: ceil(6 × 10 ÷ 12) = 5 (há 4: falta 1)
        expect(por['Item leite']).toMatchObject({ quantidade_receita: 500, necessario: 417, disponivel: 1000, faltante: 0, suficiente: true, maximo_produzivel: 24 });
        expect(por['Item choco']).toMatchObject({ quantidade_receita: 6, necessario: 5, disponivel: 4, faltante: 1, suficiente: false, maximo_produzivel: 8 });
        expect(res.body.data).toMatchObject({ rendimento: 12, maximo_produzivel: 8, pode_produzir_tudo: false, gargalo: { nome: 'Item choco' } });
        // custo pelo consumo real: 417 × 0,0125 + 5 × 1 = 10,2125
        expect(res.body.data.custo_estimado.total).toBe(10.21);
    });
});

describe('ordem de produção com rendimento', () => {
    test('conclusão baixa ceil(quantidade × unidades ÷ rendimento) e congela o custo real', async () => {
        await reporSaldo(A, 'choco', 50);
        await reporSaldo(A, 'leite', 1000);
        const criada = await post(A, 'estoquista', '/producoes/ordens', { produto_id: A.p.brigadeiro, quantidade_planejada: 10 });

        expect(criada.status).toBe(201);
        expect(criada.body.data.rendimento).toBe(12);
        expect(criada.body.data.insumos.find((i) => i.nome === 'Item leite')).toMatchObject({ necessario_planejado: 417 });

        const id = criada.body.data.id;

        await patch(A, 'estoquista', `/producoes/ordens/${id}/iniciar`, {});
        const res = await patch(A, 'admin', `/producoes/ordens/${id}/concluir`, { quantidade_produzida: 8, quantidade_perdida: 2 });

        expect(res.status).toBe(200);
        expect(await estoque(A, 'leite')).toBe(1000 - 417);
        expect(await estoque(A, 'choco')).toBe(50 - 5);
        expect(await estoque(A, 'brigadeiro')).toBe(8);
        expect(res.body.data).toMatchObject({ custo_insumos: 10.21, custo_unitario_real: 1.28, tem_pendencia: false });
    });

    test('falta de insumo com rendimento: baixa o que há e a pendência usa a necessidade com rendimento', async () => {
        await reporSaldo(A, 'leite', 100); // 24 unidades pedem ceil(500 × 24 ÷ 12) = 1000 g
        const criada = await post(A, 'estoquista', '/producoes/ordens', { produto_id: A.p.brigadeiro, quantidade_planejada: 24 });
        const id = criada.body.data.id;

        await patch(A, 'estoquista', `/producoes/ordens/${id}/iniciar`, {});
        const res = await patch(A, 'admin', `/producoes/ordens/${id}/concluir`, { quantidade_produzida: 24 });

        expect(res.status).toBe(200);
        expect(res.body.data.pendencias.find((p) => p.nome === 'Item leite')).toMatchObject({ quantidade_prevista: 1000, quantidade_baixada: 100, quantidade_pendente: 900 });
        expect(await estoque(A, 'leite')).toBe(0);
    });
});

describe('produção imediata (POST /producoes) com rendimento', () => {
    test('consome pela receita, limita pelo gargalo e o cancelamento devolve exatamente o consumido', async () => {
        await reporSaldo(A, 'leite', 1000);
        await reporSaldo(A, 'choco', 4); // 4 colheres rendem no máximo floor(4 × 12 ÷ 6) = 8 unidades
        const antes = { leite: await estoque(A, 'leite'), choco: await estoque(A, 'choco'), brigadeiro: await estoque(A, 'brigadeiro') };

        const res = await post(A, 'admin', '/producoes', { produto_id: A.p.brigadeiro, quantidade_solicitada: 20 });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ quantidade_produzida: 8, parcial: true });
        expect(await estoque(A, 'leite')).toBe(antes.leite - 334); // ceil(500 × 8 ÷ 12)
        expect(await estoque(A, 'choco')).toBe(antes.choco - 4); // ceil(6 × 8 ÷ 12)
        expect(await estoque(A, 'brigadeiro')).toBe(antes.brigadeiro + 8);

        const detalhe = await get(A, 'admin', `/producoes/${res.body.data.id}`);

        expect(detalhe.body.data.itens.find((i) => i.insumo_nome === 'Item leite')).toMatchObject({ quantidade_consumida: 334 });

        const cancelada = await patch(A, 'admin', `/producoes/${res.body.data.id}/cancelar`, {});

        expect(cancelada.status).toBe(200);
        expect({ leite: await estoque(A, 'leite'), choco: await estoque(A, 'choco'), brigadeiro: await estoque(A, 'brigadeiro') }).toEqual(antes);
    });
});

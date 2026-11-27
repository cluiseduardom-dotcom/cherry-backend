// Integração de verdade (Postgres de testes): recebimento de parcela (contas a receber) e fiado no caixa (Tarefa 03, PR D). Prova: o
// dinheiro/forma recebido no balcão entra no esperado da sessão de quem recebeu; estorno de pagamento de fiado sai da sessão original;
// sem caixa aberto o recebimento segue normal (fora de caixa); sessão fechada não recebe mais; isolamento entre empresas.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'CaixaReceb A' };
const B = { nome: 'CaixaReceb B' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const chave = () => crypto.randomUUID();
const api = (E, quem) => ({
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${E.token[quem]}`),
    post: (url, corpo, k = chave()) => request(app).post(url).set('Authorization', `Bearer ${E.token[quem]}`).set('Idempotency-Key', k).send(corpo)
});
const doBanco = async (sql, params) => (await db.query(sql, params)).rows;

async function criarEmpresa(E) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, `cxr-${E.nome.toLowerCase().replace(/\W+/g, '-')}-${sufixo}`]));
    E.token = {};
    E.uid = {};

    for (const papel of ['admin', 'gerente', 'vendedor']) {
        E.uid[papel] = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, papel, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.token[papel] = makeToken({ id: E.uid[papel], role: papel, empresa_id: E.id, tv: 0 });
    }

    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [E.id]);
    const central = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING RETURNING id`, [E.id])).rows[0]?.id
        ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [E.id])).rows[0].id;

    E.produto = await um(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'Produto', 100, 10, 1000) RETURNING id`, [E.id]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 1000)`, [E.produto, central, E.id]);
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`, [E.id, E.produto, E.canal]);
    E.cliente = await um(`INSERT INTO clientes (empresa_id, nome, telefone, criado_por, ativo) VALUES ($1, 'Cliente', '(11) 91234-5678', $2, true) RETURNING id`, [E.id, E.uid.vendedor]);

    for (const f of ['caixa', 'fiado']) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, $2, true, 'teste', 'teste')`, [E.id, f]);
    }

    E.caixa1 = (await api(E, 'gerente').post('/caixa/caixas', { nome: 'Balcão 1' }, undefined)).body.data.caixa.id;
    E.caixa2 = (await api(E, 'gerente').post('/caixa/caixas', { nome: 'Balcão 2' }, undefined)).body.data.caixa.id;
}

const abrir = async (E, quem, caixa, saldo = 0) => (await api(E, quem).post('/caixa/sessoes', { caixa_id: caixa, saldo_inicial: saldo })).body.data.sessao.id;
const detalhe = async (E, quem, sessao) => (await api(E, quem).get(`/caixa/sessoes/${sessao}`)).body.data;
const receber = (E, quem, contaId, corpo) => api(E, quem).post(`/contas-receber/${contaId}/recebimentos`, corpo);
const venderCrediario = async (E, quem) => {
    const r = await api(E, quem).post('/vendas', {
        cliente_id: E.cliente, itens: [{ produto_id: E.produto, quantidade: 2 }], pagamentos: [{ forma_pagamento: 'crediario', valor: 200, numero_parcelas: 2, meses_prazo: 1 }]
    });

    expect(r.status).toBe(201);

    return doBanco(`SELECT id FROM contas_receber WHERE venda_id = $1 ORDER BY id`, [r.body.data.id]);
};

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('recebimento de parcela no caixa', () => {
    test('a parcela recebida entra, por forma, na sessão aberta de quem recebeu', async () => {
        A.sV = await abrir(A, 'vendedor', A.caixa1, 0);
        A.sA = await abrir(A, 'admin', A.caixa2, 50);
        A.contas = await venderCrediario(A, 'vendedor');

        expect((await detalhe(A, 'vendedor', A.sV)).por_forma.crediario).toEqual({ vendas: 200, recebimentos: 0, estornos: 0, esperado: 200 });
        expect((await receber(A, 'admin', A.contas[0].id, { valor: 100, forma_pagamento: 'dinheiro' })).status).toBe(201);
        expect((await receber(A, 'admin', A.contas[1].id, { valor: 100, forma_pagamento: 'pix' })).status).toBe(201);

        const d = await detalhe(A, 'admin', A.sA);

        expect(d.esperado).toEqual({ dinheiro: 150, pix: 100 });
        expect(d.por_forma.dinheiro).toEqual({ vendas: 0, recebimentos: 100, estornos: 0, esperado: 150 });
        expect(await doBanco(`SELECT caixa_sessao_id FROM recebimentos_conta WHERE empresa_id = $1`, [A.id])).toEqual([{ caixa_sessao_id: A.sA }, { caixa_sessao_id: A.sA }]);
    });

    test('retry com a mesma Idempotency-Key não conta duas vezes', async () => {
        const [c] = await venderCrediario(A, 'vendedor');
        const k = chave();
        const antes = (await detalhe(A, 'admin', A.sA)).esperado.dinheiro;

        expect((await request(app).post(`/contas-receber/${c.id}/recebimentos`).set('Authorization', `Bearer ${A.token.admin}`).set('Idempotency-Key', k).send({ valor: 40, forma_pagamento: 'dinheiro' })).status).toBe(201);
        expect((await request(app).post(`/contas-receber/${c.id}/recebimentos`).set('Authorization', `Bearer ${A.token.admin}`).set('Idempotency-Key', k).send({ valor: 40, forma_pagamento: 'dinheiro' })).status).toBe(200);
        expect((await detalhe(A, 'admin', A.sA)).esperado.dinheiro).toBe(antes + 40);
    });

    test('sem caixa aberto o recebimento segue normal e fica fora de caixa', async () => {
        const [c] = await venderCrediario(A, 'vendedor');
        const fechada = await api(A, 'admin').post(`/caixa/sessoes/${A.sA}/fechamento`, {
            conferencia: [{ forma: 'dinheiro', informado: 190 }, { forma: 'pix', informado: 100 }]
        });

        expect(fechada.status).toBe(200);
        expect((await receber(A, 'admin', c.id, { valor: 100, forma_pagamento: 'dinheiro' })).status).toBe(201);

        const ultimo = (await doBanco(`SELECT caixa_sessao_id FROM recebimentos_conta WHERE empresa_id = $1 ORDER BY id DESC LIMIT 1`, [A.id]))[0];

        expect(ultimo.caixa_sessao_id).toBeNull();
        expect((await detalhe(A, 'admin', A.sA)).conferencias.find((x) => x.forma === 'dinheiro')).toMatchObject({ esperado: 190, informado: 190, diferenca: 0 });
    });
});

describe('fiado no caixa', () => {
    test('pagamento do cliente entra por forma; compra não; sem forma não conta; estorno sai da sessão original', async () => {
        const f = (quem, url, corpo) => api(A, quem).post(url, corpo);

        expect((await f('vendedor', `/fiado/clientes/${A.cliente}/compras`, { valor: 80, descricao: 'Compra fiada' })).status).toBe(201);

        const p1 = await f('vendedor', `/fiado/clientes/${A.cliente}/pagamentos`, { valor: 30, forma: 'dinheiro' });
        const p2 = await f('vendedor', `/fiado/clientes/${A.cliente}/pagamentos`, { valor: 20, forma: 'pix' });

        expect([p1.status, p2.status]).toEqual([201, 201]);
        expect((await f('vendedor', `/fiado/clientes/${A.cliente}/pagamentos`, { valor: 10 })).status).toBe(201);

        let d = await detalhe(A, 'vendedor', A.sV);

        expect(d.por_forma.dinheiro).toEqual({ vendas: 0, recebimentos: 30, estornos: 0, esperado: 30 });
        expect(d.por_forma.pix).toEqual({ vendas: 0, recebimentos: 20, estornos: 0, esperado: 20 });
        expect(await doBanco(`SELECT tipo, caixa_sessao_id FROM fiado_lancamentos WHERE empresa_id = $1 AND tipo = 'compra'`, [A.id])).toEqual([{ tipo: 'compra', caixa_sessao_id: null }]);

        // O admin estorna o pagamento em dinheiro; o valor sai da sessão ORIGINAL (a do vendedor, ainda aberta).
        expect((await f('admin', `/fiado/lancamentos/${p1.body.data.lancamento.id}/estorno`, { motivo: 'Lançado por engano' })).status).toBe(201);

        d = await detalhe(A, 'vendedor', A.sV);
        expect(d.por_forma.dinheiro).toEqual({ vendas: 0, recebimentos: 30, estornos: 30, esperado: 0 });
    });

    test('o fechamento exige conferir a forma recebida e fecha certo', async () => {
        const base = `/caixa/sessoes/${A.sV}/fechamento`;

        expect((await api(A, 'vendedor').post(base, { conferencia: [{ forma: 'dinheiro', informado: 0 }] })).status).toBe(400);

        const ok = await api(A, 'vendedor').post(base, { conferencia: [{ forma: 'dinheiro', informado: 0 }, { forma: 'pix', informado: 20 }, { forma: 'crediario', informado: 600 }] });

        expect(ok.status).toBe(200);
        expect(ok.body.data.divergente).toBe(false);
    });
});

describe('banco e isolamento', () => {
    test('o banco recusa recebimento/fiado em sessão fechada e em sessão de outra empresa', async () => {
        const parcela = (await doBanco(`SELECT id FROM parcelas_pagamento WHERE empresa_id = $1 LIMIT 1`, [A.id]))[0].id;
        const recebimento = (empresa, sessao) => db.query(
            `INSERT INTO recebimentos_conta (parcela_id, empresa_id, valor, forma_pagamento, usuario_id, caixa_sessao_id) VALUES ($1, $2, 1, 'dinheiro', $3, $4)`,
            [parcela, empresa, A.uid.admin, sessao]
        );
        const fiado = (empresa, sessao) => db.query(
            `INSERT INTO fiado_lancamentos (empresa_id, cliente_id, tipo, valor, data_lancamento, forma, chave_idempotencia, criado_por, caixa_sessao_id)
             VALUES ($1, $2, 'pagamento', 1, CURRENT_DATE, 'dinheiro', $3, $4, $5)`,
            [empresa, A.cliente, chave(), A.uid.admin, sessao]
        );

        await expect(recebimento(A.id, A.sA)).rejects.toMatchObject({ code: '23514' });
        await expect(fiado(A.id, A.sV)).rejects.toMatchObject({ code: '23514' });

        B.sessao = await abrir(B, 'admin', B.caixa1, 0);
        await expect(recebimento(A.id, B.sessao)).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23514)$/) });
    });

    test('a empresa B não vê o que entrou no caixa da A', async () => {
        expect((await api(B, 'gerente').get(`/caixa/sessoes/${A.sA}`)).status).toBe(404);
        expect((await detalhe(B, 'admin', B.sessao)).esperado).toEqual({ dinheiro: 0 });
    });
});

// Integração de verdade (Postgres de testes): venda e estorno ligados ao caixa (Tarefa 03, PR C). Prova: (1) sem a funcionalidade `caixa`
// nada muda (venda sem sessão, sem exigir caixa); (2) com ela, a venda do PDV exige o caixa aberto e os pagamentos entram nele;
// (3) esperado por forma = vendas - estornos (+ troco, suprimentos, sangrias no dinheiro); troco não conta; (4) cancelamento e estorno
// parcial saem da sessão certa (a do pagamento se aberta, senão a de quem estorna); (5) fechamento exige conferir cada forma com
// movimento; (6) corrida venda x fechamento: toda venda aceita está na conferência; (7) isolamento entre empresas.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'CaixaVenda A' };
const B = { nome: 'CaixaVenda B' };
const SEM = { nome: 'CaixaVenda Sem' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const chave = () => crypto.randomUUID();
const api = (E, quem) => ({
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${E.token[quem]}`),
    post: (url, corpo, k) => {
        const r = request(app).post(url).set('Authorization', `Bearer ${E.token[quem]}`);

        return (k ? r.set('Idempotency-Key', k) : r).send(corpo);
    },
    patch: (url, corpo) => request(app).patch(url).set('Authorization', `Bearer ${E.token[quem]}`).send(corpo)
});

async function criarEmpresa(E, { caixa = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, `cxv-${E.nome.toLowerCase().replace(/\W+/g, '-')}-${sufixo}`]));
    E.token = {};
    E.uid = {};

    for (const papel of ['admin', 'gerente', 'vendedor', 'operador']) {
        E.uid[papel] = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, papel, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.token[papel] = makeToken({ id: E.uid[papel], role: papel, empresa_id: E.id, tv: 0 });
    }

    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [E.id]);
    E.central = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING RETURNING id`, [E.id])).rows[0]?.id
        ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [E.id])).rows[0].id;
    E.produto = await um(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'Produto', 100, 10, 1000) RETURNING id`, [E.id]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 1000)`, [E.produto, E.central, E.id]);
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`, [E.id, E.produto, E.canal]);

    if (caixa) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'caixa', true, 'teste', 'teste')`, [E.id]);
        E.caixa = (await api(E, 'gerente').post('/caixa/caixas', { nome: 'Balcão 1' })).body.data.caixa.id;
        E.caixa2 = (await api(E, 'gerente').post('/caixa/caixas', { nome: 'Balcão 2' })).body.data.caixa.id;
    }
}

const abrir = async (E, quem, caixa, saldo = 100) => (await api(E, quem).post('/caixa/sessoes', { caixa_id: caixa, saldo_inicial: saldo })).body.data.sessao.id;
const vender = (E, quem, pagamentos, quantidade = 1) => api(E, quem).post('/vendas', { itens: [{ produto_id: E.produto, quantidade }], pagamentos });
const dinheiro = (valor, recebido) => ({ forma_pagamento: 'dinheiro', valor, valor_recebido: recebido ?? valor });
const pix = (valor) => ({ forma_pagamento: 'pix', valor });
const detalhe = async (E, quem, sessao) => (await api(E, quem).get(`/caixa/sessoes/${sessao}`)).body.data;
const doBanco = async (sql, params) => (await db.query(sql, params)).rows;

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await criarEmpresa(SEM, { caixa: false });
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('sem a funcionalidade `caixa` nada muda', () => {
    test('venda segue sem caixa, sem sessão e sem exigir nada; legado sem pagamentos[] também', async () => {
        const r = await vender(SEM, 'vendedor', [dinheiro(100)]);

        expect(r.status).toBe(201);
        expect((await doBanco(`SELECT caixa_sessao_id FROM pagamentos_venda WHERE venda_id = $1`, [r.body.data.id]))[0].caixa_sessao_id).toBeNull();
        expect((await api(SEM, 'vendedor').post('/vendas', { itens: [{ produto_id: SEM.produto, quantidade: 1 }], forma_pagamento: 'a_vista' })).status).toBe(201);
    });
});

describe('com o caixa ligado, a venda exige o caixa aberto', () => {
    test('sem caixa aberto: 409 e nada gravado (nem venda, nem estoque); legado sem pagamentos[]: 400', async () => {
        const antes = (await doBanco(`SELECT COUNT(*)::int AS n FROM vendas WHERE empresa_id = $1`, [A.id]))[0].n;
        const estoqueAntes = (await doBanco(`SELECT estoque_atual FROM produtos WHERE id = $1`, [A.produto]))[0].estoque_atual;

        expect((await vender(A, 'vendedor', [dinheiro(100)])).status).toBe(409);
        expect((await api(A, 'vendedor').post('/vendas', { itens: [{ produto_id: A.produto, quantidade: 1 }], forma_pagamento: 'a_vista' })).status).toBe(400);
        expect((await doBanco(`SELECT COUNT(*)::int AS n FROM vendas WHERE empresa_id = $1`, [A.id]))[0].n).toBe(antes);
        expect((await doBanco(`SELECT estoque_atual FROM produtos WHERE id = $1`, [A.produto]))[0].estoque_atual).toBe(estoqueAntes);
    });

    test('com o caixa aberto, os pagamentos entram na sessão; troco não conta; o esperado sai das vendas', async () => {
        A.s1 = await abrir(A, 'vendedor', A.caixa, 100);

        const v1 = await vender(A, 'vendedor', [dinheiro(100, 150)]);

        expect(v1.status).toBe(201);
        expect(Number(v1.body.data.pagamentos[0].troco)).toBe(50);
        expect((await vender(A, 'vendedor', [pix(80), dinheiro(20)])).status).toBe(201);
        expect((await vender(A, 'vendedor', [{ forma_pagamento: 'debito', valor: 100 }])).status).toBe(201);

        const ligados = await doBanco(`SELECT forma_pagamento, caixa_sessao_id FROM pagamentos_venda WHERE empresa_id = $1`, [A.id]);

        expect(ligados.every((p) => p.caixa_sessao_id === A.s1)).toBe(true);

        const d = await detalhe(A, 'vendedor', A.s1);

        expect(d.esperado).toEqual({ dinheiro: 220, pix: 80, debito: 100 });
        expect(d.por_forma.dinheiro).toEqual({ vendas: 120, recebimentos: 0, estornos: 0, esperado: 220 });
        A.vendaDinheiro = v1.body.data.id;
    });

    test('a sangria agora respeita o dinheiro das vendas', async () => {
        expect((await api(A, 'vendedor').post(`/caixa/sessoes/${A.s1}/movimentos`, { tipo: 'sangria', valor: 220.01, motivo: 'Demais' }, chave())).status).toBe(422);
        expect((await api(A, 'vendedor').post(`/caixa/sessoes/${A.s1}/movimentos`, { tipo: 'sangria', valor: 30, motivo: 'Cofre' }, chave())).status).toBe(201);
        expect((await detalhe(A, 'vendedor', A.s1)).esperado.dinheiro).toBe(190);
    });

    test('estorno parcial e cancelamento saem da sessão do pagamento enquanto ela está aberta', async () => {
        const pagamento = (await doBanco(`SELECT id FROM pagamentos_venda WHERE venda_id = $1`, [A.vendaDinheiro]))[0].id;
        const est = await api(A, 'admin').post(`/pagamentos/${pagamento}/estornar`, { valor: 10, motivo: 'Desconto dado depois' });

        expect(est.status).toBe(201);
        expect((await doBanco(`SELECT caixa_sessao_id FROM estornos_pagamento WHERE pagamento_id = $1`, [pagamento]))[0].caixa_sessao_id).toBe(A.s1);
        expect((await detalhe(A, 'vendedor', A.s1)).por_forma.dinheiro).toEqual({ vendas: 120, recebimentos: 0, estornos: 10, esperado: 180 });

        const cancel = await api(A, 'vendedor').patch(`/vendas/${A.vendaDinheiro}/cancelar`, { motivo: 'Cliente desistiu da compra' });

        expect(cancel.status).toBe(200);
        // Cancelamento estorna o restante (90 de 100): 100 (troco inicial) + 20 (outra venda) - 30 (sangria) = 90.
        expect((await detalhe(A, 'vendedor', A.s1)).por_forma.dinheiro).toEqual({ vendas: 120, recebimentos: 0, estornos: 100, esperado: 90 });
    });

    test('não vende com o caixa de OUTRO operador: cada um usa o seu', async () => {
        const sOperador = await abrir(A, 'operador', A.caixa2, 0);

        expect((await vender(A, 'operador', [dinheiro(100)])).status).toBe(201);
        expect((await detalhe(A, 'operador', sOperador)).esperado.dinheiro).toBe(100);
        expect((await detalhe(A, 'vendedor', A.s1)).esperado.dinheiro).toBe(90);
        A.s2 = sOperador;
    });
});

describe('fechamento com as vendas', () => {
    test('exige conferir cada forma com movimento; confere certo, fecha; depois a venda é recusada', async () => {
        const base = `/caixa/sessoes/${A.s1}/fechamento`;

        expect((await api(A, 'vendedor').post(base, { conferencia: [{ forma: 'dinheiro', informado: 90 }] })).status).toBe(400);
        expect((await api(A, 'vendedor').post(base, { conferencia: [{ forma: 'dinheiro', informado: 90 }, { forma: 'pix', informado: 80 }] })).status).toBe(400);
        expect((await api(A, 'vendedor').post(base, { conferencia: [{ forma: 'dinheiro', informado: 90 }, { forma: 'pix', informado: 80 }, { forma: 'debito', informado: 95 }] })).status).toBe(400);

        const ok = await api(A, 'vendedor').post(base, {
            conferencia: [{ forma: 'dinheiro', informado: 90 }, { forma: 'pix', informado: 80 }, { forma: 'debito', informado: 95 }], justificativa: 'Maquininha cobrou a menos'
        });

        expect(ok.status).toBe(200);
        expect(ok.body.data.divergente).toBe(true);
        expect(ok.body.data.conferencias).toEqual(expect.arrayContaining([
            { forma: 'dinheiro', esperado: 90, informado: 90, diferenca: 0 },
            { forma: 'pix', esperado: 80, informado: 80, diferenca: 0 },
            { forma: 'debito', esperado: 100, informado: 95, diferenca: -5 }
        ]));
        expect((await vender(A, 'vendedor', [dinheiro(100)])).status).toBe(409);
    });

    test('estorno depois do fechamento sai da sessão de quem estorna (aberta); sem sessão aberta fica sem sessão; a fechada não muda', async () => {
        const pagamento = (await doBanco(`SELECT id FROM pagamentos_venda WHERE empresa_id = $1 AND forma_pagamento = 'pix' LIMIT 1`, [A.id]))[0].id;
        const fechadaAntes = await detalhe(A, 'vendedor', A.s1);

        // O admin estorna um pix da sessão fechada s1 e não tem sessão aberta: o estorno fica sem sessão.
        expect((await api(A, 'admin').post(`/pagamentos/${pagamento}/estornar`, { valor: 5, motivo: 'Erro de digitação' })).status).toBe(201);
        const est = await doBanco(`SELECT usuario_id, caixa_sessao_id FROM estornos_pagamento WHERE pagamento_id = $1`, [pagamento]);

        expect(est).toEqual([{ usuario_id: A.uid.admin, caixa_sessao_id: null }]);
        expect(await detalhe(A, 'vendedor', A.s1)).toEqual(fechadaAntes);

        const sAdmin = await abrir(A, 'admin', A.caixa, 0);

        expect((await api(A, 'admin').post(`/pagamentos/${pagamento}/estornar`, { valor: 5, motivo: 'Mais um ajuste' })).status).toBe(201);
        expect((await detalhe(A, 'admin', sAdmin)).por_forma.pix).toEqual({ vendas: 0, recebimentos: 0, estornos: 5, esperado: -5 });
        A.sAdmin = sAdmin;
    });
});

describe('corrida e banco', () => {
    test('venda x fechamento: toda venda aceita está na conferência; as demais são recusadas', async () => {
        const c = await api(A, 'gerente').post('/caixa/caixas', { nome: 'Balcão Corrida' });
        const s = await abrir(A, 'gerente', c.body.data.caixa.id, 0);
        const vendas = Array.from({ length: 6 }, () => vender(A, 'gerente', [dinheiro(100)]));
        const fechar = api(A, 'gerente').post(`/caixa/sessoes/${s}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 0 }], justificativa: 'Corrida de teste' });
        const resultados = await Promise.all([...vendas, fechar]);
        const aceitas = resultados.slice(0, 6).filter((r) => r.status === 201).length;
        const recusadas = resultados.slice(0, 6).filter((r) => r.status === 409).length;
        const conf = (await doBanco(`SELECT esperado FROM caixa_conferencias WHERE sessao_id = $1 AND forma = 'dinheiro'`, [s]))[0];
        const noBanco = (await doBanco(`SELECT COUNT(*)::int AS n FROM pagamentos_venda WHERE caixa_sessao_id = $1`, [s]))[0].n;

        expect(aceitas + recusadas).toBe(6);
        expect(noBanco).toBe(aceitas);
        expect(Number(conf.esperado)).toBe(aceitas * 100);
    });

    test('o banco recusa pagamento em sessão fechada e sessão de outra empresa', async () => {
        const venda = (await doBanco(`SELECT id FROM vendas WHERE empresa_id = $1 LIMIT 1`, [A.id]))[0].id;
        const inserir = (empresa, sessao) => db.query(
            `INSERT INTO pagamentos_venda (venda_id, empresa_id, forma_pagamento, valor, usuario_id, caixa_sessao_id) VALUES ($1, $2, 'pix', 1, $3, $4)`,
            [venda, empresa, A.uid.admin, sessao]
        );

        await expect(inserir(A.id, A.s1)).rejects.toMatchObject({ code: '23514' });
        await expect(inserir(B.id, A.sAdmin)).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23514)$/) });
    });
});

describe('isolamento entre empresas', () => {
    test('empresa B não enxerga a sessão de A nem vende nela; a venda de B usa só o caixa de B', async () => {
        expect((await api(B, 'gerente').get(`/caixa/sessoes/${A.s2}`)).status).toBe(404);
        expect((await vender(B, 'vendedor', [dinheiro(100)])).status).toBe(409);

        const sB = await abrir(B, 'vendedor', B.caixa, 0);

        expect((await vender(B, 'vendedor', [dinheiro(100)])).status).toBe(201);
        expect((await doBanco(`SELECT DISTINCT caixa_sessao_id FROM pagamentos_venda WHERE empresa_id = $1`, [B.id]))).toEqual([{ caixa_sessao_id: sB }]);
        expect((await detalhe(A, 'operador', A.s2)).esperado.dinheiro).toBe(100);
    });
});

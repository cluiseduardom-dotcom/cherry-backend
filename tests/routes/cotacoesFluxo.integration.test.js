// Integração (Postgres de testes): cotação (compras avançado). Pedir preço a vários fornecedores, registrar propostas, comparar e gerar
// o(s) pedido(s) de compra do vencedor de cada item, com o fluxo seguindo até o estoque. Isolamento, RBAC, flag e concorrência.
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

const A = { u: {}, p: {}, f: {} };
const B = { u: {}, p: {}, f: {} };
const C = { u: {}, p: {}, f: {} }; // sem a funcionalidade compras_avancado

async function criarEmpresa(alvo, rotulo, { flag }) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Cotacao ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'estoquista', 'vendedor']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
    if (flag) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'compras_avancado', true, 'teste', 'teste')`,
            [alvo.empresaId]
        );
    }
    for (const chave of ['alfa', 'beta', 'gama']) {
        alvo.f[chave] = (await db.query(`INSERT INTO fornecedores (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [alvo.empresaId, `Fornecedor ${chave}`])).rows[0].id;
    }
    alvo.f.inativo = (await db.query(`INSERT INTO fornecedores (empresa_id, nome, ativo) VALUES ($1, 'Fornecedor inativo', false) RETURNING id`, [alvo.empresaId])).rows[0].id;
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [alvo.empresaId]);
}

async function criarProduto(alvo, chave, { ativo = true } = {}) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, ativo) VALUES ($1, $2, $3, 5, 1, 0, $4) RETURNING id`,
        [alvo.empresaId, `COT-${chave}-${alvo.empresaId}-${sufixo}`, `Produto ${chave}`, ativo]
    );
    alvo.p[chave] = rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const enviar = (metodo) => (alvo, papel, url, corpo) => request(app)[metodo](url).set(como(alvo, papel)).send(corpo);
const post = enviar('post');
const put = enviar('put');
const COT = '/cotacoes';

const corpoCotacao = (alvo, extra = {}) => ({
    itens: [{ produto_id: alvo.p.anel, quantidade: 10 }, { produto_id: alvo.p.colar, quantidade: 4 }],
    fornecedor_ids: [alvo.f.alfa, alvo.f.beta, alvo.f.gama],
    data_limite: '2026-12-20',
    ...extra
});

const novaCotacao = async (alvo, extra = {}) => {
    const res = await post(alvo, 'admin', COT, corpoCotacao(alvo, extra));

    expect(res.status).toBe(201);
    return res.body.data;
};

const itemId = (cot, chave) => cot.itens.find((i) => i.produto_id === chave).id;
const proposta = (alvo, cot, fornecedor, linhas) => put(alvo, 'estoquista', `${COT}/${cot.id}/fornecedores/${alvo.f[fornecedor]}/oferta`, { itens: linhas });

beforeAll(async () => {
    await criarEmpresa(A, 'A', { flag: true });
    await criarEmpresa(B, 'B', { flag: true });
    await criarEmpresa(C, 'C', { flag: false });
    for (const alvo of [A, B, C]) {
        await criarProduto(alvo, 'anel');
        await criarProduto(alvo, 'colar');
    }
    await criarProduto(A, 'inativo', { ativo: false });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('POST /cotacoes (criar)', () => {
    test('nasce ABERTA, com número COT-AAAA-NNNN, itens, fornecedores pendentes e data de abertura de hoje', async () => {
        const cot = await novaCotacao(A);

        expect(cot).toMatchObject({ status: 'ABERTA', data_limite: '2026-12-20' });
        expect(cot.numero).toMatch(/^COT-\d{4}-\d{4}$/);
        expect(cot.itens).toHaveLength(2);
        expect(cot.itens[0]).toMatchObject({ produto_id: A.p.anel, produto_nome: 'Produto anel', quantidade_solicitada: 10, melhor_fornecedor_id: null });
        expect(cot.fornecedores.map((f) => [f.fornecedor_nome, f.status])).toEqual([['Fornecedor alfa', 'PENDENTE'], ['Fornecedor beta', 'PENDENTE'], ['Fornecedor gama', 'PENDENTE']]);
        expect(cot.ofertas).toEqual([]);
        A.cot = cot;
    });

    test('três cotações simultâneas recebem números diferentes e em sequência', async () => {
        const [a, b, c] = await Promise.all([novaCotacao(A), novaCotacao(A), novaCotacao(A)]);

        expect(new Set([a.numero, b.numero, c.numero]).size).toBe(3);
    });

    test('fornecedor ou produto de outra empresa = 404; inativo = 400', async () => {
        expect((await post(A, 'admin', COT, corpoCotacao(A, { fornecedor_ids: [B.f.alfa] }))).status).toBe(404);
        expect((await post(A, 'admin', COT, corpoCotacao(A, { itens: [{ produto_id: B.p.anel, quantidade: 1 }] }))).status).toBe(404);
        expect((await post(A, 'admin', COT, corpoCotacao(A, { fornecedor_ids: [A.f.inativo] }))).status).toBe(400);
        expect((await post(A, 'admin', COT, corpoCotacao(A, { itens: [{ produto_id: A.p.inativo, quantidade: 1 }] }))).status).toBe(400);
    });

    test('entrada inválida = 400 e nada é criado', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM cotacoes WHERE empresa_id = $1', [A.empresaId])).rows[0].n;
        const invalidos = [
            { itens: [] }, { fornecedor_ids: [] }, { fornecedor_ids: [A.f.alfa, A.f.alfa] },
            { itens: [{ produto_id: A.p.anel, quantidade: 0 }] }, { itens: [{ produto_id: A.p.anel, quantidade: 1.5 }] }, { itens: [{ quantidade: 1 }] },
            { data_limite: '20/12/2026' }, { observacoes: 'x'.repeat(1001) }, { empresa_id: B.empresaId }, { status: 'ENCERRADA' }
        ];

        for (const extra of invalidos) expect((await post(A, 'admin', COT, corpoCotacao(A, extra))).status).toBe(400);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM cotacoes WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes);
    });
});

describe('propostas dos fornecedores', () => {
    test('registrar a proposta marca RESPONDIDA, guarda totais e a melhor oferta por item é apontada (só sugestão)', async () => {
        const cot = A.cot;
        const anel = itemId(cot, A.p.anel);
        const colar = itemId(cot, A.p.colar);

        // alfa: anel 12,50 | colar 30  — beta: anel 13 com R$ 20 de desconto (11/un.) | colar 31 — gama: só o colar, 4 un. a 29
        expect((await proposta(A, cot, 'alfa', [{ cotacao_item_id: anel, preco_unitario: 12.5, prazo_entrega_dias: 5 }, { cotacao_item_id: colar, preco_unitario: 30 }])).status).toBe(200);
        expect((await proposta(A, cot, 'beta', [{ cotacao_item_id: anel, preco_unitario: 13, desconto: 20, prazo_entrega_dias: 10, condicao_pagamento: '30 dias' }, { cotacao_item_id: colar, preco_unitario: 31 }])).status).toBe(200);
        const res = await proposta(A, cot, 'gama', [{ cotacao_item_id: colar, preco_unitario: 29 }]);

        expect(res.status).toBe(200);
        const dados = res.body.data;

        expect(dados.fornecedores.map((f) => f.status)).toEqual(['RESPONDIDA', 'RESPONDIDA', 'RESPONDIDA']);
        expect(dados.ofertas).toHaveLength(5);
        expect(dados.ofertas.find((o) => o.fornecedor_id === A.f.beta && o.cotacao_item_id === anel)).toMatchObject({ quantidade_ofertada: 10, total: 110, prazo_entrega_dias: 10 });
        expect(dados.itens.find((i) => i.id === anel).melhor_fornecedor_id).toBe(A.f.beta);
        expect(dados.itens.find((i) => i.id === colar).melhor_fornecedor_id).toBe(A.f.gama);
        A.anel = anel;
        A.colar = colar;
    });

    test('registrar de novo troca a proposta inteira (não acumula)', async () => {
        const res = await proposta(A, A.cot, 'gama', [{ cotacao_item_id: A.colar, preco_unitario: 32 }]);

        expect(res.body.data.ofertas.filter((o) => o.fornecedor_id === A.f.gama)).toHaveLength(1);
        expect(res.body.data.itens.find((i) => i.id === A.colar).melhor_fornecedor_id).toBe(A.f.alfa); // 30 agora é o melhor
    });

    test('recusar um fornecedor apaga a proposta dele', async () => {
        const res = await post(A, 'estoquista', `${COT}/${A.cot.id}/fornecedores/${A.f.gama}/recusar`, {});

        expect(res.status).toBe(200);
        expect(res.body.data.fornecedores.find((f) => f.fornecedor_id === A.f.gama).status).toBe('RECUSADA');
        expect(res.body.data.ofertas.some((o) => o.fornecedor_id === A.f.gama)).toBe(false);
        await proposta(A, A.cot, 'gama', [{ cotacao_item_id: A.colar, preco_unitario: 29 }]); // volta a responder
    });

    test('proposta inválida: item de outra cotação 404; fornecedor fora da cotação 404; quantidade acima da pedida, preço negativo e repetido = 400', async () => {
        const outra = await novaCotacao(A);

        expect((await proposta(A, A.cot, 'alfa', [{ cotacao_item_id: outra.itens[0].id, preco_unitario: 1 }])).status).toBe(404);
        expect((await put(A, 'estoquista', `${COT}/${A.cot.id}/fornecedores/${B.f.alfa}/oferta`, { itens: [{ cotacao_item_id: A.anel, preco_unitario: 1 }] })).status).toBe(404);
        expect((await proposta(A, A.cot, 'alfa', [{ cotacao_item_id: A.anel, preco_unitario: 1, quantidade_ofertada: 11 }])).status).toBe(400);
        expect((await proposta(A, A.cot, 'alfa', [{ cotacao_item_id: A.anel, preco_unitario: -1 }])).status).toBe(400);
        expect((await proposta(A, A.cot, 'alfa', [{ cotacao_item_id: A.anel, preco_unitario: 1 }, { cotacao_item_id: A.anel, preco_unitario: 2 }])).status).toBe(400);
        expect((await proposta(A, A.cot, 'alfa', [])).status).toBe(400);
    });
});

describe('isolamento, RBAC e flag', () => {
    test('outra empresa não vê nem mexe; id inválido = 400; lista só da própria empresa', async () => {
        const doB = await novaCotacao(B);

        expect((await get(A, 'admin', `${COT}/${doB.id}`)).status).toBe(404);
        expect((await post(A, 'admin', `${COT}/${doB.id}/cancelar`, {})).status).toBe(404);
        expect((await post(A, 'admin', `${COT}/${doB.id}/gerar-pedidos`, { escolhas: [{ cotacao_item_id: doB.itens[0].id, fornecedor_id: B.f.alfa }] })).status).toBe(404);
        expect((await get(A, 'admin', `${COT}?pageSize=100`)).body.data.items.some((c) => c.id === doB.id)).toBe(false);
        expect((await get(A, 'admin', `${COT}/abc`)).status).toBe(400);
        expect((await get(A, 'admin', `${COT}?status=XYZ`)).status).toBe(400);
    });

    test('lista traz contagens (itens, fornecedores, respondidas)', async () => {
        const item = (await get(A, 'estoquista', `${COT}?pageSize=100`)).body.data.items.find((c) => c.id === A.cot.id);

        expect(item).toMatchObject({ numero: A.cot.numero, status: 'ABERTA', itens: 2, fornecedores: 3, respondidas: 3 });
    });

    test('vendedor 403; sem a funcionalidade 403; sem token 401', async () => {
        expect((await get(A, 'vendedor', COT)).status).toBe(403);
        expect((await post(A, 'vendedor', COT, corpoCotacao(A))).status).toBe(403);
        expect((await get(C, 'admin', COT)).status).toBe(403);
        expect((await request(app).get(COT)).status).toBe(401);
    });
});

describe('gerar pedidos do vencedor de cada item', () => {
    test('escolha inválida: fornecedor que não cotou o item = 400; item repetido = 400; vazio = 400; nada é gerado', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n;

        expect((await post(A, 'admin', `${COT}/${A.cot.id}/gerar-pedidos`, { escolhas: [{ cotacao_item_id: A.anel, fornecedor_id: A.f.gama }] })).status).toBe(400); // gama não cotou o anel
        expect((await post(A, 'admin', `${COT}/${A.cot.id}/gerar-pedidos`, { escolhas: [{ cotacao_item_id: A.anel, fornecedor_id: A.f.alfa }, { cotacao_item_id: A.anel, fornecedor_id: A.f.beta }] })).status).toBe(400);
        expect((await post(A, 'admin', `${COT}/${A.cot.id}/gerar-pedidos`, { escolhas: [] })).status).toBe(400);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes);
    });

    test('anel do beta e colar do gama: um pedido (rascunho) por fornecedor, com preço, desconto, prazo e vínculo com a cotação; cotação encerrada', async () => {
        const res = await post(A, 'admin', `${COT}/${A.cot.id}/gerar-pedidos`, {
            escolhas: [{ cotacao_item_id: A.anel, fornecedor_id: A.f.beta }, { cotacao_item_id: A.colar, fornecedor_id: A.f.gama }]
        });

        expect(res.status).toBe(201);
        expect(res.body.data.cotacao.status).toBe('ENCERRADA');
        expect(res.body.data.pedidos).toHaveLength(2);
        const doBeta = res.body.data.pedidos.find((p) => p.fornecedor_id === A.f.beta);
        const doGama = res.body.data.pedidos.find((p) => p.fornecedor_id === A.f.gama);

        expect(doBeta.numero).toMatch(/^PC-\d{4}-\d{4}$/);
        expect(doBeta.total).toBe(110); // 10 × 13 − 20
        expect(doGama.total).toBe(116); // 4 × 29

        const pedido = (await get(A, 'admin', `/pedidos-compra/${doBeta.id}`)).body.data;

        expect(pedido).toMatchObject({ status: 'RASCUNHO', fornecedor_id: A.f.beta, condicao_pagamento: '30 dias', total: 110 });
        expect(pedido.itens).toHaveLength(1);
        expect(pedido.itens[0]).toMatchObject({ produto_id: A.p.anel, quantidade: 10, preco_unitario: 13, desconto: 20 });
        expect(pedido.observacoes).toContain(A.cot.numero);
        expect(pedido.data_prevista_entrega).toBeTruthy(); // hoje + 10 dias de prazo da proposta
        const vinculo = (await db.query('SELECT cotacao_id::text FROM pedidos_compra WHERE id = $1', [doBeta.id])).rows[0].cotacao_id;

        expect(vinculo).toBe(String(A.cot.id));
        A.pedidoBeta = doBeta;
    });

    test('cotação encerrada não gera de novo, não recebe proposta nem cancela (409)', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n;

        expect((await post(A, 'admin', `${COT}/${A.cot.id}/gerar-pedidos`, { escolhas: [{ cotacao_item_id: A.anel, fornecedor_id: A.f.alfa }] })).status).toBe(409);
        expect((await proposta(A, A.cot, 'alfa', [{ cotacao_item_id: A.anel, preco_unitario: 1 }])).status).toBe(409);
        expect((await post(A, 'admin', `${COT}/${A.cot.id}/cancelar`, {})).status).toBe(409);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes);
    });

    test('duas gerações ao mesmo tempo: só uma vale, a outra recebe 409, e não há pedido duplicado', async () => {
        const cot = await novaCotacao(A);

        await proposta(A, cot, 'alfa', [{ cotacao_item_id: itemId(cot, A.p.anel), preco_unitario: 10 }]);
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n;
        const corpo = { escolhas: [{ cotacao_item_id: itemId(cot, A.p.anel), fornecedor_id: A.f.alfa }] };
        const [r1, r2] = await Promise.all([post(A, 'admin', `${COT}/${cot.id}/gerar-pedidos`, corpo), post(A, 'admin', `${COT}/${cot.id}/gerar-pedidos`, corpo)]);

        expect([r1.status, r2.status].sort()).toEqual([201, 409]);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes + 1);
    });

    test('cancelar uma cotação aberta: vale uma vez; depois não aceita proposta', async () => {
        const cot = await novaCotacao(A);
        const res = await post(A, 'admin', `${COT}/${cot.id}/cancelar`, {});

        expect(res.body.data.status).toBe('CANCELADA');
        expect((await post(A, 'admin', `${COT}/${cot.id}/cancelar`, {})).status).toBe(409);
        expect((await proposta(A, cot, 'alfa', [{ cotacao_item_id: cot.itens[0].id, preco_unitario: 1 }])).status).toBe(409);
    });

    test('o pedido gerado segue o fluxo normal: enviar e receber dá entrada no estoque e cria a conta a pagar', async () => {
        const id = A.pedidoBeta.id;

        expect((await post(A, 'admin', `/pedidos-compra/${id}/enviar`, {})).status).toBe(200);
        const itemPedido = (await get(A, 'admin', `/pedidos-compra/${id}`)).body.data.itens[0].id;
        const rec = await request(app).post('/recebimentos').set(como(A, 'admin')).send({ pedido_compra_id: id, fornecedor_id: A.f.beta, numero: `REC-COT-${sufixo}`, data_recebimento: '2026-12-01' });

        expect(rec.status).toBe(201);
        const base = `/recebimentos/${rec.body.id}`;

        expect((await post(A, 'admin', `${base}/itens`, { pedido_compra_item_id: itemPedido, descricao_snapshot: 'Anel', quantidade_recebida: 10 })).status).toBe(201);
        expect((await request(app).patch(`${base}/status`).set(como(A, 'admin')).send({ status: 'EM_CONFERENCIA' })).status).toBe(200);
        expect((await request(app).patch(`${base}/status`).set(como(A, 'admin')).send({ status: 'CONFERIDO' })).status).toBe(200);
        expect((await post(A, 'admin', `${base}/aprovar`, {})).status).toBe(200);

        expect((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.p.anel])).rows[0].estoque_atual).toBe(10);
        expect((await get(A, 'admin', `/pedidos-compra/${id}`)).body.data.status).toBe('RECEBIDO');
    });
});

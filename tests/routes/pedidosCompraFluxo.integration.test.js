// Integração (Postgres de testes): pedido de compra (compras avançado). Criar, editar rascunho, enviar, confirmar e cancelar;
// e o fluxo inteiro até o estoque e a conta a pagar, pelo recebimento que já existia. Isolamento, RBAC e flag `compras_avancado`.
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
const B = { u: {}, p: {} };
const C = { u: {}, p: {} }; // sem a funcionalidade compras_avancado

async function criarEmpresa(alvo, rotulo, { flag }) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Pedido Compra ${rotulo} ${sufixo}`]);
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
    alvo.fornecedor = (await db.query(`INSERT INTO fornecedores (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [alvo.empresaId, `Fornecedor ${rotulo}`])).rows[0].id;
}

async function criarProduto(alvo, chave, { custo = 5, tipo = 'acabado', ativo = true } = {}) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, tipo, ativo) VALUES ($1, $2, $3, $4, 1, 0, $5, $6) RETURNING id`,
        [alvo.empresaId, `PCP-${chave}-${alvo.empresaId}-${sufixo}`, `Produto ${chave}`, custo, tipo, ativo]
    );
    alvo.p[chave] = rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const enviar = (metodo) => (alvo, papel, url, corpo) => request(app)[metodo](url).set(como(alvo, papel)).send(corpo);
const post = enviar('post');
const put = enviar('put');
const patch = enviar('patch');
const PC = '/pedidos-compra';

const corpoPedido = (alvo, extra = {}) => ({
    fornecedor_id: alvo.fornecedor,
    data_prevista_entrega: '2026-12-10',
    prazo_pagamento_dias: 30,
    frete_valor: 10,
    desconto: 5,
    itens: [
        { produto_id: alvo.p.anel, quantidade: 10, preco_unitario: 12.5 },
        { produto_id: alvo.p.colar, quantidade: 4, preco_unitario: 30, desconto: 8 }
    ],
    ...extra
});

const novoPedido = async (alvo, extra = {}) => {
    const res = await post(alvo, 'admin', PC, corpoPedido(alvo, extra));

    expect(res.status).toBe(201);
    return res.body.data;
};

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

describe('POST /pedidos-compra (criar)', () => {
    test('cria o pedido em rascunho com número automático, descrição do produto e total calculado', async () => {
        const pedido = await novoPedido(A);

        // itens: 10 × 12,50 = 125,00; 4 × 30 − 8 = 112,00 → 237,00; − desconto 5 + frete 10 = 242,00
        expect(pedido).toMatchObject({ status: 'RASCUNHO', total: 242, fornecedor_id: A.fornecedor, prazo_pagamento_dias: 30, frete_valor: 10, desconto: 5 });
        expect(pedido.numero).toMatch(/^PC-\d{4}-\d{4}$/);
        expect(pedido.itens).toHaveLength(2);
        expect(pedido.itens[0]).toMatchObject({ produto_id: A.p.anel, descricao_snapshot: 'Produto anel', quantidade: 10, preco_unitario: 12.5, quantidade_recebida: 0 });
        A.pedido = pedido;
    });

    test('o número segue em sequência e aceita um número informado (único na empresa)', async () => {
        const segundo = await novoPedido(A);

        expect(Number(segundo.numero.slice(-4))).toBe(Number(A.pedido.numero.slice(-4)) + 1);
        const manual = await novoPedido(A, { numero: `MANUAL-${sufixo}` });

        expect(manual.numero).toBe(`MANUAL-${sufixo}`);
        expect((await post(A, 'admin', PC, corpoPedido(A, { numero: `MANUAL-${sufixo}` }))).status).toBe(409);
    });

    test('dois pedidos criados ao mesmo tempo recebem números diferentes', async () => {
        const [a, b, c] = await Promise.all([novoPedido(A), novoPedido(A), novoPedido(A)]);

        expect(new Set([a.numero, b.numero, c.numero]).size).toBe(3);
    });

    test('fornecedor ou produto de outra empresa = 404; produto inativo = 400', async () => {
        expect((await post(A, 'admin', PC, corpoPedido(A, { fornecedor_id: B.fornecedor }))).status).toBe(404);
        expect((await post(A, 'admin', PC, corpoPedido(A, { itens: [{ produto_id: B.p.anel, quantidade: 1, preco_unitario: 1 }] }))).status).toBe(404);
        expect((await post(A, 'admin', PC, corpoPedido(A, { itens: [{ produto_id: A.p.inativo, quantidade: 1, preco_unitario: 1 }] }))).status).toBe(400);
    });

    test('entrada inválida = 400 e nada é criado', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n;
        const item = (extra) => ({ produto_id: A.p.anel, quantidade: 1, preco_unitario: 1, ...extra });
        const invalidos = [
            { fornecedor_id: undefined }, { itens: [] }, { itens: Array.from({ length: 201 }, () => item()) },
            { itens: [item({ quantidade: 0 })] }, { itens: [item({ quantidade: 1.5 })] }, { itens: [item({ quantidade: -2 })] },
            { itens: [item({ preco_unitario: -1 })] }, { itens: [item({ desconto: 5 })] }, { itens: [{ quantidade: 1, preco_unitario: 1 }] },
            { frete_valor: -1 }, { desconto: -1 }, { outras_despesas: -1 }, { prazo_pagamento_dias: 400 }, { prazo_pagamento_dias: 1.5 },
            { data_prevista_entrega: '10/12/2026' }, { numero: ' ' }, { observacoes: 'x'.repeat(1001) },
            { empresa_id: B.empresaId }, { status: 'RECEBIDO' }, { total: 1 }
        ];

        for (const extra of invalidos) {
            const corpo = corpoPedido(A, extra);

            for (const [chave, valor] of Object.entries(extra)) if (valor === undefined) delete corpo[chave];
            expect((await post(A, 'admin', PC, corpo)).status).toBe(400);
        }
        expect((await db.query('SELECT COUNT(*)::int AS n FROM pedidos_compra WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes);
    });
});

describe('GET /pedidos-compra', () => {
    test('lista paginada com fornecedor e filtros; detalhe com itens, saldo e fornecedor', async () => {
        const lista = await get(A, 'estoquista', `${PC}?pageSize=100`);

        expect(lista.status).toBe(200);
        expect(lista.body.data.items.find((p) => p.id === A.pedido.id)).toMatchObject({ numero: A.pedido.numero, status: 'RASCUNHO', fornecedor_nome: 'Fornecedor A', total: 242, itens: 2 });
        expect((await get(A, 'admin', `${PC}?status=ENVIADO&pageSize=100`)).body.data.items.every((p) => p.status === 'ENVIADO')).toBe(true);
        expect((await get(A, 'admin', `${PC}?fornecedor_id=${B.fornecedor}`)).body.data.items).toEqual([]);
        expect((await get(A, 'admin', `${PC}?status=XYZ`)).status).toBe(400);

        const detalhe = await get(A, 'admin', `${PC}/${A.pedido.id}`);

        expect(detalhe.body.data).toMatchObject({ id: A.pedido.id, fornecedor_nome: 'Fornecedor A', status: 'RASCUNHO' });
        expect(detalhe.body.data.itens[1]).toMatchObject({ quantidade: 4, desconto: 8, saldo: 4, produto_nome: 'Produto colar' });
    });

    test('isolamento: outra empresa não vê nem acessa; id inválido = 400', async () => {
        const doB = await novoPedido(B);

        expect((await get(A, 'admin', `${PC}/${doB.id}`)).status).toBe(404);
        expect((await put(A, 'admin', `${PC}/${doB.id}`, corpoPedido(A))).status).toBe(404);
        expect((await post(A, 'admin', `${PC}/${doB.id}/enviar`, {})).status).toBe(404);
        expect((await get(A, 'admin', `${PC}?pageSize=100`)).body.data.items.some((p) => p.id === doB.id)).toBe(false);
        expect((await get(A, 'admin', `${PC}/abc`)).status).toBe(400);
    });
});

describe('PUT /pedidos-compra/:id (editar rascunho)', () => {
    test('troca cabeçalho e itens e recalcula o total; só em rascunho', async () => {
        const pedido = await novoPedido(A);
        const res = await put(A, 'admin', `${PC}/${pedido.id}`, corpoPedido(A, { frete_valor: 0, desconto: 0, itens: [{ produto_id: A.p.anel, quantidade: 2, preco_unitario: 50 }] }));

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ total: 100, numero: pedido.numero });
        expect(res.body.data.itens).toHaveLength(1);

        await post(A, 'admin', `${PC}/${pedido.id}/enviar`, {});
        expect((await put(A, 'admin', `${PC}/${pedido.id}`, corpoPedido(A))).status).toBe(409);
    });
});

describe('enviar, confirmar e cancelar', () => {
    test('rascunho → enviado (com data) → confirmado; ações fora de ordem = 409', async () => {
        const pedido = await novoPedido(A);

        expect((await post(A, 'admin', `${PC}/${pedido.id}/confirmar`, {})).status).toBe(409); // ainda rascunho
        const enviado = await post(A, 'estoquista', `${PC}/${pedido.id}/enviar`, {});

        expect(enviado.status).toBe(200);
        expect(enviado.body.data.status).toBe('ENVIADO');
        expect(enviado.body.data.enviado_em).toBeTruthy();
        expect((await post(A, 'admin', `${PC}/${pedido.id}/enviar`, {})).status).toBe(409);
        const confirmado = await post(A, 'admin', `${PC}/${pedido.id}/confirmar`, {});

        expect(confirmado.body.data.status).toBe('CONFIRMADO');
        expect(confirmado.body.data.confirmado_em).toBeTruthy();
    });

    test('cancelar: vale em rascunho, enviado e confirmado; cancelado não volta', async () => {
        const rascunho = await novoPedido(A);

        expect((await post(A, 'admin', `${PC}/${rascunho.id}/cancelar`, {})).body.data.status).toBe('CANCELADO');
        expect((await post(A, 'admin', `${PC}/${rascunho.id}/cancelar`, {})).status).toBe(409);
        expect((await post(A, 'admin', `${PC}/${rascunho.id}/enviar`, {})).status).toBe(409);

        const enviado = await novoPedido(A);

        await post(A, 'admin', `${PC}/${enviado.id}/enviar`, {});
        expect((await post(A, 'admin', `${PC}/${enviado.id}/cancelar`, {})).body.data.status).toBe('CANCELADO');
    });
});

describe('RBAC e flag', () => {
    test('vendedor 403; sem a funcionalidade 403 (o resto de Compras segue aberto); sem token 401', async () => {
        expect((await get(A, 'vendedor', PC)).status).toBe(403);
        expect((await post(A, 'vendedor', PC, corpoPedido(A))).status).toBe(403);
        expect((await get(C, 'admin', PC)).status).toBe(403);
        expect((await post(C, 'admin', PC, corpoPedido(C))).status).toBe(403);
        expect((await request(app).get(PC)).status).toBe(401);
        expect((await get(C, 'admin', '/compras')).status).toBe(200);
        expect((await get(C, 'admin', '/recebimentos')).status).toBe(200);
    });
});

describe('fluxo completo: pedido → recebimento → estoque, pedido recebido e conta a pagar', () => {
    test('receber o pedido em duas vezes: parcial e depois total, com entrada de estoque e vencimento pelo prazo do pedido', async () => {
        const pedido = await novoPedido(A, { prazo_pagamento_dias: 30, frete_valor: 0, desconto: 0, itens: [{ produto_id: A.p.anel, quantidade: 10, preco_unitario: 12.5 }] });

        await post(A, 'admin', `${PC}/${pedido.id}/enviar`, {});
        const itemId = (await get(A, 'admin', `${PC}/${pedido.id}`)).body.data.itens[0].id;

        const receber = async (numero, quantidade) => {
            const rec = await request(app).post('/recebimentos').set(como(A, 'admin')).send({
                pedido_compra_id: pedido.id, fornecedor_id: A.fornecedor, numero, data_recebimento: '2026-12-01'
            });

            expect(rec.status).toBe(201);
            const base = `/recebimentos/${rec.body.id}`;

            expect((await post(A, 'admin', `${base}/itens`, { pedido_compra_item_id: itemId, descricao_snapshot: 'Anel', quantidade_recebida: quantidade })).status).toBe(201);
            expect((await patch(A, 'admin', `${base}/status`, { status: 'EM_CONFERENCIA' })).status).toBe(200);
            expect((await patch(A, 'admin', `${base}/status`, { status: 'CONFERIDO' })).status).toBe(200);

            return post(A, 'admin', `${base}/aprovar`, {});
        };

        const primeiro = await receber(`REC-1-${sufixo}`, 4);

        // número de recebimento repetido na empresa = 409 claro (e não 500)
        const repetido = await request(app).post('/recebimentos').set(como(A, 'admin')).send({ pedido_compra_id: pedido.id, fornecedor_id: A.fornecedor, numero: `REC-1-${sufixo}`, data_recebimento: '2026-12-01' });

        expect(repetido.status).toBe(409);
        expect(repetido.body.message || repetido.body.error).toMatch(/já existe um recebimento/i);

        expect(primeiro.status).toBe(200);
        expect((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.p.anel])).rows[0].estoque_atual).toBe(4);
        let detalhe = (await get(A, 'admin', `${PC}/${pedido.id}`)).body.data;

        expect(detalhe.status).toBe('PARCIALMENTE_RECEBIDO');
        expect(detalhe.itens[0]).toMatchObject({ quantidade: 10, quantidade_recebida: 4, saldo: 6 });

        // não dá para receber mais do que o saldo
        const rec = await request(app).post('/recebimentos').set(como(A, 'admin')).send({ pedido_compra_id: pedido.id, fornecedor_id: A.fornecedor, numero: `REC-X-${sufixo}`, data_recebimento: '2026-12-02' });

        expect((await post(A, 'admin', `/recebimentos/${rec.body.id}/itens`, { pedido_compra_item_id: itemId, descricao_snapshot: 'Anel', quantidade_recebida: 7 })).status).toBe(409);

        const segundo = await receber(`REC-2-${sufixo}`, 6);

        expect(segundo.status).toBe(200);
        expect((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.p.anel])).rows[0].estoque_atual).toBe(10);
        detalhe = (await get(A, 'admin', `${PC}/${pedido.id}`)).body.data;
        expect(detalhe.status).toBe('RECEBIDO');
        expect((await post(A, 'admin', `${PC}/${pedido.id}/cancelar`, {})).status).toBe(409); // recebido não se cancela

        const { rows: contas } = await db.query(
            `SELECT valor::float AS valor, to_char(data_vencimento, 'YYYY-MM-DD') AS vencimento FROM contas_pagar WHERE empresa_id = $1 ORDER BY id`,
            [A.empresaId]
        );

        // vencimento = data do recebimento (01/12) + 30 dias do prazo do pedido
        expect(contas.map((c) => c.vencimento)).toEqual(['2026-12-31', '2026-12-31']);
        expect(contas.reduce((soma, c) => soma + c.valor, 0)).toBe(125);
    });
});

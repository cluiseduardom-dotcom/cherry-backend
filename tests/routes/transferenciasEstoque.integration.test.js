// Integração de verdade (Postgres): migration 059 + transferências entre locais com aceite.
// Empresas e usuários próprios e temporários; remove tudo no fim.
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

const A = {};
const B = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Transferencias ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
}

async function criarUsuario(alvo, papel, rotulo = papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id, token_version`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    return { id: rows[0].id, tv: rows[0].token_version, role: papel };
}

const api = (alvo, usuario, metodo, url, corpo) =>
    request(app)[metodo](url)
        .set('Authorization', `Bearer ${makeToken({ id: usuario.id, role: usuario.role, empresa_id: alvo.empresaId, tv: usuario.tv })}`)
        .send(corpo);

const criarProduto = async (alvo, estoque = 0) => {
    const res = await api(alvo, alvo.admin, 'post', '/produtos', { nome: `Prod ${crypto.randomBytes(3).toString('hex')}`, preco_venda: 100, custo: 10, estoque_atual: estoque });
    expect(res.status).toBe(201);
    return res.body.data.id;
};

const criarMaleta = async (alvo, usuario) => {
    const res = await api(alvo, alvo.admin, 'post', '/estoque/locais', { tipo: 'maleta', usuario_id: usuario.id });
    expect(res.status).toBe(201);
    return res.body.data.id;
};

const centralId = async (alvo) => (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0].id;
const transitoId = async (alvo) => (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'transito'`, [alvo.empresaId])).rows[0].id;
const saldo = async (produtoId, localId) => (await db.query('SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2', [produtoId, localId])).rows[0]?.saldo ?? 0;
const total = async (produtoId) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual;
const somaLocais = async (produtoId) => Number((await db.query('SELECT COALESCE(SUM(saldo), 0) AS s FROM estoque_locais WHERE produto_id = $1', [produtoId])).rows[0].s);
const invariante = async (produtoId) => expect(await somaLocais(produtoId)).toBe(await total(produtoId));

const enviar = (alvo, usuario, origem, destino, itens, extra = {}) =>
    api(alvo, usuario, 'post', '/estoque/transferencias', { origem_local_id: origem, destino_local_id: destino, itens, ...extra });
const responder = (alvo, usuario, id, acao, corpo = {}) => api(alvo, usuario, 'post', `/estoque/transferencias/${id}/${acao}`, corpo);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    A.admin = await criarUsuario(A, 'admin');
    A.estoquista = await criarUsuario(A, 'estoquista');
    A.estoquista2 = await criarUsuario(A, 'estoquista', 'estoquista2');
    A.vendedor = await criarUsuario(A, 'vendedor');
    A.vendedor2 = await criarUsuario(A, 'vendedor', 'vendedor2');
    B.admin = await criarUsuario(B, 'admin');
    B.vendedor = await criarUsuario(B, 'vendedor');

    A.central = null;
    A.maletaV1 = await criarMaleta(A, A.vendedor);
    A.maletaV2 = await criarMaleta(A, A.vendedor2);
    B.maleta = await criarMaleta(B, B.vendedor);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('envio, aceite, recusa e cancelamento', () => {
    test('criar tira da origem e põe Em trânsito (total intacto), pendente, com trilha e movimentações ligadas', async () => {
        const produto = await criarProduto(A, 10);
        const central = await centralId(A);

        const res = await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 4 }], { observacao: 'Mostruário de outubro' });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ status: 'pendente', origem_tipo: 'central', destino_tipo: 'maleta', observacao: 'Mostruário de outubro' });
        expect(res.body.data.itens).toEqual([expect.objectContaining({ produto_id: produto, quantidade: 4 })]);
        expect(res.body.data.eventos.map((e) => e.acao)).toEqual(['criar']);
        expect(JSON.stringify(res.body)).not.toMatch(/custo/);

        expect(await saldo(produto, central)).toBe(6);
        expect(await saldo(produto, await transitoId(A))).toBe(4);
        expect(await saldo(produto, A.maletaV1)).toBe(0);
        expect(await total(produto)).toBe(10);
        await invariante(produto);

        const { rows } = await db.query('SELECT tipo FROM movimentacoes_estoque WHERE transferencia_id = $1 ORDER BY id', [res.body.data.id]);
        expect(rows.map((r) => r.tipo)).toEqual(['saida', 'entrada']);
    });

    test('só o dono da maleta aceita; admin e quem criou (sem ser dono) não; aceitar move do trânsito para a maleta', async () => {
        const produto = await criarProduto(A, 10);
        const central = await centralId(A);
        const id = (await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 3 }])).body.data.id;

        expect((await responder(A, A.admin, id, 'aceitar')).status).toBe(403);
        expect((await responder(A, A.estoquista, id, 'aceitar')).status).toBe(403);
        expect((await responder(A, A.vendedor2, id, 'aceitar')).status).toBe(403);
        expect(await saldo(produto, A.maletaV1)).toBe(0);

        const res = await responder(A, A.vendedor, id, 'aceitar');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'concluida', resolvido_por: A.vendedor.id });
        expect(res.body.data.eventos.map((e) => e.acao)).toEqual(['criar', 'aceitar']);
        expect(await saldo(produto, A.maletaV1)).toBe(3);
        expect(await saldo(produto, await transitoId(A))).toBe(0);
        expect(await saldo(produto, central)).toBe(7);
        expect(await total(produto)).toBe(10);
        await invariante(produto);

        expect((await responder(A, A.vendedor, id, 'aceitar')).status).toBe(409);
        expect((await responder(A, A.vendedor, id, 'recusar', { motivo: 'tarde demais' })).status).toBe(409);
    });

    test('recusar exige motivo e devolve à origem; cancelar só pelo criador ou admin', async () => {
        const produto = await criarProduto(A, 10);
        const central = await centralId(A);

        const r1 = (await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 2 }])).body.data.id;
        expect((await responder(A, A.vendedor, r1, 'recusar')).status).toBe(400);
        expect((await responder(A, A.vendedor, r1, 'recusar', { motivo: 'ab' })).status).toBe(400);
        const recusada = await responder(A, A.vendedor, r1, 'recusar', { motivo: 'Peças não conferem' });
        expect(recusada.status).toBe(200);
        expect(recusada.body.data).toMatchObject({ status: 'recusada', motivo_resolucao: 'Peças não conferem' });
        expect(await saldo(produto, central)).toBe(10);
        expect(await saldo(produto, await transitoId(A))).toBe(0);

        const c1 = (await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 5 }])).body.data.id;
        expect((await responder(A, A.estoquista2, c1, 'cancelar', { motivo: 'não fui eu' })).status).toBe(403);
        expect((await responder(A, A.vendedor, c1, 'cancelar', { motivo: 'não sou o criador' })).status).toBe(403);
        expect((await responder(A, A.estoquista, c1, 'cancelar', { motivo: 'enviado por engano' })).status).toBe(200);
        expect(await saldo(produto, central)).toBe(10);

        const c2 = (await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 1 }])).body.data.id;
        expect((await responder(A, A.admin, c2, 'cancelar', { motivo: 'admin cancelou' })).status).toBe(200);
        expect(await somaLocais(produto)).toBe(10);
        await invariante(produto);

        const eventos = (await db.query('SELECT acao FROM transferencias_eventos WHERE transferencia_id = $1 ORDER BY id', [r1])).rows;
        expect(eventos.map((e) => e.acao)).toEqual(['criar', 'recusar']);
    });

    test('estoque insuficiente na origem = 409 e nada é gravado (nem a transferência)', async () => {
        const produto = await criarProduto(A, 2);
        const central = await centralId(A);
        const antes = Number((await db.query('SELECT COUNT(*) FROM transferencias_estoque WHERE empresa_id = $1', [A.empresaId])).rows[0].count);

        const res = await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 3 }]);

        expect(res.status).toBe(409);
        expect(Number((await db.query('SELECT COUNT(*) FROM transferencias_estoque WHERE empresa_id = $1', [A.empresaId])).rows[0].count)).toBe(antes);
        expect(await saldo(produto, central)).toBe(2);
        await invariante(produto);
    });

    test('transferência com vários itens é tudo-ou-nada', async () => {
        const p1 = await criarProduto(A, 5);
        const p2 = await criarProduto(A, 1);
        const central = await centralId(A);

        const res = await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: p1, quantidade: 5 }, { produto_id: p2, quantidade: 2 }]);

        expect(res.status).toBe(409);
        expect(await saldo(p1, central)).toBe(5);
        expect(await saldo(p2, central)).toBe(1);
    });

    test('devolução: vendedor devolve da PRÓPRIA maleta ao Central e a equipe aceita; vendedor não envia do Central nem de maleta alheia', async () => {
        const produto = await criarProduto(A, 10);
        const central = await centralId(A);
        const id1 = (await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 6 }])).body.data.id;
        await responder(A, A.vendedor, id1, 'aceitar');

        expect((await enviar(A, A.vendedor, central, A.maletaV1, [{ produto_id: produto, quantidade: 1 }])).status).toBe(403);
        expect((await enviar(A, A.vendedor2, A.maletaV1, central, [{ produto_id: produto, quantidade: 1 }])).status).toBe(403);
        expect((await enviar(A, A.vendedor, A.maletaV1, A.maletaV2, [{ produto_id: produto, quantidade: 1 }])).status).toBe(403);

        const dev = await enviar(A, A.vendedor, A.maletaV1, central, [{ produto_id: produto, quantidade: 6 }]);
        expect(dev.status).toBe(201);
        expect((await responder(A, A.vendedor, dev.body.data.id, 'aceitar')).status).toBe(403); // não aceita a própria devolução
        expect((await responder(A, A.estoquista, dev.body.data.id, 'aceitar')).status).toBe(200);
        expect(await saldo(produto, central)).toBe(10);
        expect(await saldo(produto, A.maletaV1)).toBe(0);
        await invariante(produto);
    });

    test('vendedor só enxerga transferências em que é parte; a equipe vê todas; detalhe alheio = 404', async () => {
        const produto = await criarProduto(A, 10);
        const central = await centralId(A);
        const paraV1 = (await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 1 }])).body.data.id;
        const paraV2 = (await enviar(A, A.estoquista, central, A.maletaV2, [{ produto_id: produto, quantidade: 1 }])).body.data.id;

        const lista = await api(A, A.vendedor, 'get', '/estoque/transferencias?status=pendente');
        const ids = lista.body.data.items.map((t) => t.id);
        expect(ids).toContain(paraV1);
        expect(ids).not.toContain(paraV2);

        expect((await api(A, A.vendedor, 'get', `/estoque/transferencias/${paraV1}`)).status).toBe(200);
        expect((await api(A, A.vendedor, 'get', `/estoque/transferencias/${paraV2}`)).status).toBe(404);

        const todas = (await api(A, A.estoquista, 'get', '/estoque/transferencias?pageSize=100')).body.data.items.map((t) => t.id);
        expect(todas).toEqual(expect.arrayContaining([paraV1, paraV2]));
    });
});

describe('concorrência', () => {
    test('5 aceites simultâneos da mesma transferência: um 200, quatro 409, estoque movido uma só vez', async () => {
        const produto = await criarProduto(A, 10);
        const id = (await enviar(A, A.estoquista, await centralId(A), A.maletaV1, [{ produto_id: produto, quantidade: 4 }])).body.data.id;

        const respostas = await Promise.all(Array.from({ length: 5 }, () => responder(A, A.vendedor, id, 'aceitar')));

        expect(respostas.filter((r) => r.status === 200)).toHaveLength(1);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(4);
        expect(await saldo(produto, A.maletaV1)).toBe(4);
        expect(await saldo(produto, await transitoId(A))).toBe(0);
        await invariante(produto);
    });

    test('aceite e cancelamento simultâneos: exatamente um vence e o estoque fecha', async () => {
        const produto = await criarProduto(A, 10);
        const id = (await enviar(A, A.estoquista, await centralId(A), A.maletaV1, [{ produto_id: produto, quantidade: 4 }])).body.data.id;

        const [a, c] = await Promise.all([
            responder(A, A.vendedor, id, 'aceitar'),
            responder(A, A.estoquista, id, 'cancelar', { motivo: 'cancelando ao mesmo tempo' })
        ]);

        expect([a.status, c.status].sort()).toEqual([200, 409]);
        await invariante(produto);
        expect(await saldo(produto, await transitoId(A))).toBe(0);
        expect(await saldo(produto, A.maletaV1) + await saldo(produto, await centralId(A))).toBe(10);
    });

    test('8 envios simultâneos de 1 com saldo 5: 5 passam, 3 recebem 409, Central 0 e trânsito 5', async () => {
        const produto = await criarProduto(A, 5);
        const central = await centralId(A);

        const respostas = await Promise.all(
            Array.from({ length: 8 }, () => enviar(A, A.estoquista, central, A.maletaV2, [{ produto_id: produto, quantidade: 1 }]))
        );

        expect(respostas.filter((r) => r.status === 201)).toHaveLength(5);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(3);
        expect(await saldo(produto, central)).toBe(0);
        expect(await saldo(produto, await transitoId(A))).toBe(5);
        expect(await total(produto)).toBe(5);
    });

    test('envios simultâneos com produtos em ordem oposta não geram deadlock', async () => {
        const p1 = await criarProduto(A, 50);
        const p2 = await criarProduto(A, 50);
        const central = await centralId(A);

        const respostas = await Promise.all(Array.from({ length: 10 }, (_, i) => enviar(A, A.estoquista, central, A.maletaV2,
            i % 2 ? [{ produto_id: p1, quantidade: 1 }, { produto_id: p2, quantidade: 1 }] : [{ produto_id: p2, quantidade: 1 }, { produto_id: p1, quantidade: 1 }])));

        expect(respostas.every((r) => r.status === 201)).toBe(true);
        await invariante(p1);
        await invariante(p2);
    });
});

describe('concorrência mista', () => {
    test('aceites, recusas e novos envios simultâneos sobre os mesmos produtos terminam sem deadlock e com soma = total', async () => {
        const p1 = await criarProduto(A, 100);
        const p2 = await criarProduto(A, 100);
        const central = await centralId(A);
        const itens = (i) => (i % 2 ? [{ produto_id: p1, quantidade: 1 }, { produto_id: p2, quantidade: 1 }] : [{ produto_id: p2, quantidade: 1 }, { produto_id: p1, quantidade: 1 }]);

        const pendentes = [];
        for (let i = 0; i < 6; i++) pendentes.push((await enviar(A, A.estoquista, central, A.maletaV1, itens(i))).body.data.id);

        const respostas = await Promise.all([
            ...pendentes.slice(0, 3).map((id) => responder(A, A.vendedor, id, 'aceitar')),
            ...pendentes.slice(3).map((id) => responder(A, A.vendedor, id, 'recusar', { motivo: 'recusa em massa' })),
            ...Array.from({ length: 4 }, (_, i) => enviar(A, A.estoquista, central, A.maletaV1, itens(i)))
        ]);

        expect(respostas.every((r) => [200, 201].includes(r.status))).toBe(true);
        await invariante(p1);
        await invariante(p2);
        expect(await saldo(p1, A.maletaV1)).toBe(3);
        expect(await saldo(p1, await transitoId(A))).toBe(4);
        expect(await saldo(p1, central)).toBe(93);
    });
});

describe('validação, isolamento e banco', () => {
    test('entradas inválidas: origem = destino, Em trânsito, item repetido, quantidade 0, campo extra', async () => {
        const produto = await criarProduto(A, 5);
        const central = await centralId(A);
        const transito = await transitoId(A);
        const item = [{ produto_id: produto, quantidade: 1 }];

        expect((await enviar(A, A.estoquista, central, central, item)).status).toBe(400);
        expect((await enviar(A, A.estoquista, central, transito, item)).status).toBe(400);
        expect((await enviar(A, A.estoquista, transito, central, item)).status).toBe(400);
        expect((await enviar(A, A.estoquista, central, A.maletaV1, [...item, ...item])).status).toBe(400);
        expect((await enviar(A, A.estoquista, central, A.maletaV1, [{ produto_id: produto, quantidade: 0 }])).status).toBe(400);
        expect((await enviar(A, A.estoquista, central, A.maletaV1, [])).status).toBe(400);
        expect((await enviar(A, A.estoquista, central, A.maletaV1, item, { empresa_id: 9 })).status).toBe(400);
        expect(await saldo(produto, central)).toBe(5);
    });

    test('isolamento entre empresas: local, produto e transferência de B respondem 404 para A', async () => {
        const produtoA = await criarProduto(A, 5);
        const produtoB = await criarProduto(B, 5);
        const centralA = await centralId(A);
        const centralB = await centralId(B);

        expect((await enviar(A, A.estoquista, centralA, B.maleta, [{ produto_id: produtoA, quantidade: 1 }])).status).toBe(404);
        expect((await enviar(A, A.estoquista, centralA, A.maletaV1, [{ produto_id: produtoB, quantidade: 1 }])).status).toBe(404);

        const idB = (await enviar(B, B.admin, centralB, B.maleta, [{ produto_id: produtoB, quantidade: 1 }])).body.data.id;
        expect((await api(A, A.admin, 'get', `/estoque/transferencias/${idB}`)).status).toBe(404);
        expect((await responder(A, A.admin, idB, 'cancelar', { motivo: 'tentando cancelar de outra empresa' })).status).toBe(404);
        expect((await db.query('SELECT status FROM transferencias_estoque WHERE id = $1', [idB])).rows[0].status).toBe('pendente');
        expect(await saldo(produtoA, centralA)).toBe(5);
    });

    test('POST /estoque/locais: só admin; maleta duplicada = 409; usuário de outra empresa = 404; consignado criado', async () => {
        expect((await api(A, A.estoquista, 'post', '/estoque/locais', { tipo: 'maleta', usuario_id: A.vendedor.id })).status).toBe(403);
        expect((await api(A, A.admin, 'post', '/estoque/locais', { tipo: 'maleta', usuario_id: A.vendedor.id })).status).toBe(409);
        expect((await api(A, A.admin, 'post', '/estoque/locais', { tipo: 'maleta', usuario_id: B.vendedor.id })).status).toBe(404);
        expect((await api(A, A.admin, 'post', '/estoque/locais', { tipo: 'central' })).status).toBe(400);

        const res = await api(A, A.admin, 'post', '/estoque/locais', { tipo: 'consignado', nome: `Revenda ${sufixo}` });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ tipo: 'consignado', nome: `Revenda ${sufixo}`, ativo: true });
    });

    test('consignado: aceite é da equipe (o consignatário não tem login)', async () => {
        const produto = await criarProduto(A, 5);
        const local = (await api(A, A.admin, 'post', '/estoque/locais', { tipo: 'consignado', nome: `Cons ${crypto.randomBytes(3).toString('hex')}` })).body.data.id;
        const id = (await enviar(A, A.estoquista, await centralId(A), local, [{ produto_id: produto, quantidade: 2 }])).body.data.id;

        expect((await responder(A, A.vendedor, id, 'aceitar')).status).toBe(403);
        expect((await responder(A, A.estoquista2, id, 'aceitar')).status).toBe(200);
        expect(await saldo(produto, local)).toBe(2);
        await invariante(produto);
    });

    test('o banco recusa: UPDATE/DELETE na trilha, status pendente com resolução, recusa sem motivo, evento de outra empresa', async () => {
        const produto = await criarProduto(A, 5);
        const id = (await enviar(A, A.estoquista, await centralId(A), A.maletaV1, [{ produto_id: produto, quantidade: 1 }])).body.data.id;
        const ev = (await db.query('SELECT id FROM transferencias_eventos WHERE transferencia_id = $1', [id])).rows[0].id;

        await expect(db.query(`UPDATE transferencias_eventos SET motivo = 'x' WHERE id = $1`, [ev])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query('DELETE FROM transferencias_eventos WHERE id = $1', [ev])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query(`UPDATE transferencias_estoque SET resolvido_por = $2, resolvido_em = NOW() WHERE id = $1`, [id, A.admin.id])).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(`UPDATE transferencias_estoque SET status = 'recusada', resolvido_por = $2, resolvido_em = NOW() WHERE id = $1`, [id, A.admin.id])).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(
            `INSERT INTO transferencias_eventos (empresa_id, transferencia_id, acao, executado_por) VALUES ($1, $2, 'aceitar', $3)`,
            [B.empresaId, id, B.admin.id]
        )).rejects.toMatchObject({ code: '23503' });
    });
});

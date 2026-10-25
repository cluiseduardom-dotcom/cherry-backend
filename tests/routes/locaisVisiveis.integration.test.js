// Integração de verdade (Postgres da CI/dev): GET /estoque/locais e GET /estoque/locais/:id/saldos.
// O vendedor precisa descobrir a própria Maleta e ver o saldo dela (PDV), sem ver os locais dos outros.
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

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste LocaisVis ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.centralId = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.transitoId = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'transito', 'Em trânsito') RETURNING id`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, rotulo, papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[rotulo] = { id: rows[0].id, papel };
}

const auth = (alvo, rotulo) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[rotulo].id, role: alvo.u[rotulo].papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const listar = (alvo, rotulo) => request(app).get('/estoque/locais').set(auth(alvo, rotulo));
const saldos = (alvo, rotulo, id, query = '') => request(app).get(`/estoque/locais/${id}/saldos${query}`).set(auth(alvo, rotulo));

async function produto(alvo, nome, sku, saldosPorLocal) {
    const total = Object.values(saldosPorLocal).reduce((a, b) => a + b, 0);
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, sku, preco_venda, custo, estoque_atual) VALUES ($1, $2, $3, 100, 33.33, $4) RETURNING id`,
        [alvo.empresaId, `${nome} ${sufixo}`, sku, total]
    );
    for (const [localId, saldo] of Object.entries(saldosPorLocal)) {
        await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [rows[0].id, Number(localId), alvo.empresaId, saldo]);
    }
    return rows[0].id;
}

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    await criarUsuario(A, 'admin', 'admin');
    await criarUsuario(A, 'estoquista', 'estoquista');
    await criarUsuario(A, 'ana', 'vendedor');
    await criarUsuario(A, 'beto', 'vendedor');
    await criarUsuario(A, 'semMaleta', 'vendedor');
    await criarUsuario(B, 'admin', 'admin');

    A.maletaAna = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', 'Maleta Ana', $2) RETURNING id`, [A.empresaId, A.u.ana.id])).rows[0].id;
    A.maletaBeto = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', 'Maleta Beto', $2) RETURNING id`, [A.empresaId, A.u.beto.id])).rows[0].id;
    A.consignado = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'consignado', 'Loja Parceira') RETURNING id`, [A.empresaId])).rows[0].id;
    A.inativo = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome, ativo) VALUES ($1, 'consignado', 'Antiga', false) RETURNING id`, [A.empresaId])).rows[0].id;
    B.maleta = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'consignado', 'Outra empresa') RETURNING id`, [B.empresaId])).rows[0].id;

    A.p1 = await produto(A, 'Anel', 'AN-1', { [A.centralId]: 10, [A.maletaAna]: 3 });
    A.p2 = await produto(A, 'Brinco', 'BR-1', { [A.centralId]: 5, [A.maletaAna]: 2, [A.maletaBeto]: 4 });
    A.p3 = await produto(A, 'Colar', 'CO-1', { [A.centralId]: 7, [A.maletaAna]: 0 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /estoque/locais', () => {
    test('equipe vê Central, maletas e consignados ativos; nunca Em trânsito nem inativos', async () => {
        for (const rotulo of ['admin', 'estoquista']) {
            const res = await listar(A, rotulo);
            expect(res.status).toBe(200);
            const nomes = res.body.data.map((l) => l.nome);
            expect(nomes).toEqual(['Central', 'Maleta Ana', 'Maleta Beto', 'Loja Parceira']);
            expect(res.body.data.find((l) => l.nome === 'Maleta Ana')).toMatchObject({ tipo: 'maleta', usuario_id: A.u.ana.id, usuario_nome: `ana ${sufixo}` });
        }
    });

    test('vendedor vê o Central (para devolver/vender) e a própria Maleta; nunca maletas alheias nem consignados', async () => {
        const ana = await listar(A, 'ana');
        expect(ana.status).toBe(200);
        expect(ana.body.data.map((l) => l.id)).toEqual([A.centralId, A.maletaAna]);

        const sem = await listar(A, 'semMaleta');
        expect(sem.status).toBe(200);
        expect(sem.body.data.map((l) => l.id)).toEqual([A.centralId]);
    });

    test('isolamento por empresa', async () => {
        const res = await listar(B, 'admin');
        expect(res.body.data.map((l) => l.nome)).toEqual(['Central', 'Outra empresa']);
    });

    test('exige autenticação', async () => {
        expect((await request(app).get('/estoque/locais')).status).toBe(401);
    });
});

describe('GET /estoque/locais/:id/saldos', () => {
    test('dono vê o saldo da própria Maleta (só saldo > 0), sem custo', async () => {
        const res = await saldos(A, 'ana', A.maletaAna);
        expect(res.status).toBe(200);
        expect(res.body.data.local).toMatchObject({ id: A.maletaAna, tipo: 'maleta' });
        expect(res.body.data.items.map((i) => [i.produto_id, i.saldo])).toEqual([[A.p1, 3], [A.p2, 2]]);
        expect(res.body.data.total).toBe(2);
        expect(JSON.stringify(res.body)).not.toMatch(/custo|margem|lucro|33\.33/i);
    });

    test('equipe vê qualquer local; busca por nome ou SKU', async () => {
        expect((await saldos(A, 'estoquista', A.centralId)).body.data.total).toBe(3);
        expect((await saldos(A, 'admin', A.consignado)).body.data.total).toBe(0);
        expect((await saldos(A, 'admin', A.centralId, '?busca=brin')).body.data.items.map((i) => i.produto_id)).toEqual([A.p2]);
        expect((await saldos(A, 'admin', A.centralId, '?busca=CO-1')).body.data.items.map((i) => i.produto_id)).toEqual([A.p3]);
        expect((await saldos(A, 'admin', A.centralId, '?busca=%25')).body.data.total).toBe(0);
    });

    test('vendedor lê o saldo do Central (PDV), mas não de maleta alheia nem consignado (404); outra empresa e Em trânsito também 404', async () => {
        const central = await saldos(A, 'ana', A.centralId);
        expect(central.status).toBe(200);
        expect(central.body.data.local.tipo).toBe('central');
        expect(central.body.data.items.map((i) => [i.produto_id, i.saldo])).toEqual([[A.p1, 10], [A.p2, 5], [A.p3, 7]]);
        expect(JSON.stringify(central.body)).not.toMatch(/custo|margem|lucro/i);
        for (const id of [A.maletaBeto, A.consignado, B.maleta, 99999999]) {
            expect((await saldos(A, 'ana', id)).status).toBe(404);
        }
        expect((await saldos(A, 'admin', A.transitoId)).status).toBe(404);
        expect((await saldos(A, 'admin', B.maleta)).status).toBe(404);
        expect((await saldos(A, 'admin', 'abc')).status).toBe(400);
    });

    test('paginação limita e informa o total', async () => {
        const res = await saldos(A, 'admin', A.centralId, '?page=2&pageSize=2');
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
        expect(res.body.data.items).toHaveLength(1);
    });
});

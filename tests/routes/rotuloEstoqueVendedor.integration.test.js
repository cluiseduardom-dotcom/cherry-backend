// Integração de verdade (Postgres de testes): rótulo por empresa do estoque do vendedor ("Maleta" para semijoias, "Estoque do
// vendedor" para os demais ramos). Prova: (1) empresa nova nasce com "estoque_vendedor" e a que já existia fica com "maleta";
// (2) só o admin da própria empresa troca, só por valor da lista fechada, e a troca aparece em /auth/me; (3) as mensagens do
// servidor (nome padrão do local, duplicidade, devolução) usam as palavras da empresa; (4) o comportamento não muda: o tipo
// técnico do local continua `maleta`. Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'Rotulo A' };
const B = { nome: 'Rotulo B' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const api = (E, papel = 'admin') => {
    const token = papel === 'admin' ? E.tokenAdmin : E.tokenVendedor;

    return {
        get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
        post: (url, corpo) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(corpo),
        patch: (url, corpo) => request(app).patch(url).set('Authorization', `Bearer ${token}`).send(corpo)
    };
};

async function criarEmpresa(E) {
    // Sem informar o rótulo: vale o padrão do banco para empresa nova.
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ${E.nome} ${sufixo}`]));
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, 'Admin', $2, 'x', 'admin', true) RETURNING id`, [E.id, `adm-${E.id}-${sufixo}@teste.local`]);
    E.vendedor = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, 'Ana Revendedora', $2, 'x', 'vendedor', true) RETURNING id`, [E.id, `ven-${E.id}-${sufixo}@teste.local`]);
    E.tokenAdmin = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    E.tokenVendedor = makeToken({ id: E.vendedor, role: 'vendedor', empresa_id: E.id, tv: 0 });
    await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'maletas', true, 'teste', 'teste')`, [E.id]);
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [E.id]);
    E.central = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [E.id])).rows[0].id;
    E.produto = await um(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'Peça', 10, 1, 5) RETURNING id`, [E.id]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 5)`, [E.produto, E.central, E.id]);
}

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('padrão e troca', () => {
    test('empresa nova nasce com estoque_vendedor; /auth/me e /empresa/dados trazem a chave', async () => {
        expect((await api(A).get('/auth/me')).body.data.rotulo_estoque_vendedor).toBe('estoque_vendedor');
        expect((await api(A).get('/empresa/dados')).body.data.rotulo_estoque_vendedor).toBe('estoque_vendedor');
    });

    test('a coluna das empresas que já existiam ficou com maleta (a migration só muda o padrão das novas)', async () => {
        const { rows } = await db.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'empresas' AND column_name = 'rotulo_estoque_vendedor'`);

        expect(rows[0].column_default).toMatch(/estoque_vendedor/);
    });

    test('só admin troca; valor fora da lista, campo extra e texto livre são recusados', async () => {
        expect((await api(A, 'vendedor').patch('/empresa/dados', { rotulo_estoque_vendedor: 'maleta' })).status).toBe(403);
        expect((await api(A).patch('/empresa/dados', { rotulo_estoque_vendedor: 'Minha Caixinha' })).status).toBe(400);
        expect((await api(A).patch('/empresa/dados', { rotulo_estoque_vendedor: '' })).status).toBe(400);
        expect((await api(A).patch('/empresa/dados', { rotulo_estoque_vendedor: 'maleta', empresa_id: 99 })).status).toBe(400);
        expect((await api(A).get('/empresa/dados')).body.data.rotulo_estoque_vendedor).toBe('estoque_vendedor');
    });

    test('a troca vale só para a empresa de quem trocou e aparece em /auth/me', async () => {
        const res = await api(A).patch('/empresa/dados', { rotulo_estoque_vendedor: 'maleta' });

        expect(res.status).toBe(200);
        expect(res.body.data.rotulo_estoque_vendedor).toBe('maleta');
        expect((await api(A).get('/auth/me')).body.data.rotulo_estoque_vendedor).toBe('maleta');
        expect((await api(B).get('/auth/me')).body.data.rotulo_estoque_vendedor).toBe('estoque_vendedor');
        expect((await db.query('SELECT rotulo_estoque_vendedor FROM empresas WHERE id = $1', [B.id])).rows[0].rotulo_estoque_vendedor).toBe('estoque_vendedor');
    });

    test('o banco recusa valor fora da lista', async () => {
        await expect(db.query(`UPDATE empresas SET rotulo_estoque_vendedor = 'outra' WHERE id = $1`, [A.id])).rejects.toThrow(/empresas_rotulo_estoque_vendedor_chk/);
    });
});

describe('mensagens do servidor usam as palavras da empresa', () => {
    test('empresa com "estoque do vendedor": nome padrão, duplicidade e devolução concordam; o tipo técnico segue maleta', async () => {
        const criar = await api(B).post('/estoque/locais', { tipo: 'maleta', usuario_id: B.vendedor });

        expect(criar.status).toBe(201);
        expect(criar.body.data).toMatchObject({ tipo: 'maleta', nome: 'Estoque de Ana Revendedora' });

        const duplicado = await api(B).post('/estoque/locais', { tipo: 'maleta', usuario_id: B.vendedor });

        expect(duplicado.status).toBe(409);
        expect(duplicado.body.message).toBe('Este usuário já tem estoque do vendedor');

        // O vendedor tenta mandar do Central para o próprio estoque: só devolução ao Central é permitida.
        const envio = await api(B, 'vendedor').post('/estoque/transferencias', { origem_local_id: B.central, destino_local_id: criar.body.data.id, itens: [{ produto_id: B.produto, quantidade: 1 }] });

        expect(envio.status).toBe(403);
        expect(envio.body.message).toBe('Você só pode devolver mercadoria do seu próprio estoque para o Central');
    });

    test('empresa com "maleta": as mesmas mensagens saem como sempre', async () => {
        const criar = await api(A).post('/estoque/locais', { tipo: 'maleta', usuario_id: A.vendedor });

        expect(criar.status).toBe(201);
        expect(criar.body.data).toMatchObject({ tipo: 'maleta', nome: 'Maleta de Ana Revendedora' });

        const duplicado = await api(A).post('/estoque/locais', { tipo: 'maleta', usuario_id: A.vendedor });

        expect(duplicado.body.message).toBe('Este usuário já tem maleta');

        const envio = await api(A, 'vendedor').post('/estoque/transferencias', { origem_local_id: A.central, destino_local_id: criar.body.data.id, itens: [{ produto_id: A.produto, quantidade: 1 }] });

        expect(envio.body.message).toBe('Você só pode devolver mercadoria da sua própria maleta para o Central');
    });

    test('trocar o rótulo não renomeia locais já criados nem muda o tipo técnico', async () => {
        await api(B).patch('/empresa/dados', { rotulo_estoque_vendedor: 'maleta' });

        const { rows } = await db.query(`SELECT tipo, nome FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'maleta'`, [B.id]);

        expect(rows).toEqual([{ tipo: 'maleta', nome: 'Estoque de Ana Revendedora' }]);
    });
});

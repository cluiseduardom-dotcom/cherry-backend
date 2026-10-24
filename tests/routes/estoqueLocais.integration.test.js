// Integração de verdade (Postgres): migration 058 + criarMovimentacao por local + rotas de estoque.
// Empresas e usuários próprios e temporários; remove tudo no fim.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste EstoqueLocais ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
}

async function criarUsuario(alvo, papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id, token_version`,
        [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    return { id: rows[0].id, tv: rows[0].token_version };
}

const token = (alvo, usuario, role) => makeToken({ id: usuario.id, role, empresa_id: alvo.empresaId, tv: usuario.tv });
const api = (alvo, usuario, role, metodo, url, corpo) =>
    request(app)[metodo](url).set('Authorization', `Bearer ${token(alvo, usuario, role)}`).send(corpo);

const criarProduto = async (alvo, estoque = 0) => {
    const res = await api(alvo, alvo.admin, 'admin', 'post', '/produtos', {
        nome: `Prod ${crypto.randomBytes(3).toString('hex')}`, preco_venda: 100, custo: 10, estoque_atual: estoque
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
};

const criarMaleta = async (alvo, usuario) => (await db.query(
    `INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', 'Maleta', $2) RETURNING id`,
    [alvo.empresaId, usuario.id]
)).rows[0].id;

const centralId = async (alvo) => (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0].id;
const saldos = async (produtoId) => (await db.query('SELECT local_id, saldo FROM estoque_locais WHERE produto_id = $1 ORDER BY local_id', [produtoId])).rows;
const total = async (produtoId) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual;
const somaLocais = async (produtoId) => Number((await db.query('SELECT COALESCE(SUM(saldo), 0) AS s FROM estoque_locais WHERE produto_id = $1', [produtoId])).rows[0].s);
const mov = (alvo, produtoId, corpo) => api(alvo, alvo.estoquista, 'estoquista', 'post', `/produtos/${produtoId}/movimentacoes`, corpo);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    A.admin = await criarUsuario(A, 'admin');
    A.estoquista = await criarUsuario(A, 'estoquista');
    A.vendedor = await criarUsuario(A, 'vendedor');
    B.admin = await criarUsuario(B, 'admin');
    B.estoquista = await criarUsuario(B, 'estoquista');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 058', () => {
    test('é idempotente e faz o backfill: saldo legado vai para o Central e o histórico aponta para ele', async () => {
        // Produto "legado": saldo direto na tabela, sem linha em estoque_locais, e uma movimentação antiga.
        const { rows } = await db.query(
            `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'Legado', 10, 5, 7) RETURNING id`,
            [A.empresaId]
        );
        const legado = rows[0].id;
        const sql = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/058_estoque_locais.sql'), 'utf8');

        await db.query(sql);
        await db.query(sql); // 2ª execução: nada muda nem quebra

        const central = await centralId(A);
        expect(await saldos(legado)).toEqual([{ local_id: central, saldo: 7 }]);
        expect(await somaLocais(legado)).toBe(await total(legado));
        const { rows: locais } = await db.query(`SELECT tipo FROM locais_estoque WHERE empresa_id = $1 ORDER BY tipo`, [A.empresaId]);
        expect(locais.map((l) => l.tipo)).toEqual(['central', 'transito']);
    });

    test('o banco recusa estados inválidos: saldo negativo, 2º Central, maleta sem usuário, local de outra empresa', async () => {
        const produto = await criarProduto(A, 3);
        const central = await centralId(A);
        const centralB = await centralId(B).catch(() => null);

        await expect(db.query('UPDATE estoque_locais SET saldo = -1 WHERE produto_id = $1', [produto])).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Outro')`, [A.empresaId])).rejects.toMatchObject({ code: '23505' });
        await expect(db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'maleta', 'Sem dono')`, [A.empresaId])).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', 'Alheia', $2)`, [A.empresaId, B.admin.id])).rejects.toMatchObject({ code: '23503' });

        // Central de B só existe depois da 1ª movimentação em B.
        const produtoB = await criarProduto(B, 1);
        const centralDeB = centralB ?? await centralId(B);
        await expect(db.query(
            `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 1)`, [produtoB, central, B.empresaId]
        )).rejects.toMatchObject({ code: '23503' });
        await expect(db.query(
            `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 1)`, [produto, centralDeB, A.empresaId]
        )).rejects.toMatchObject({ code: '23503' });
    });
});

describe('estoque por local', () => {
    test('produto criado com estoque inicial nasce com entrada auditada no Central (total = soma dos locais)', async () => {
        const produto = await criarProduto(A, 12);
        const central = await centralId(A);

        expect(await total(produto)).toBe(12);
        expect(await saldos(produto)).toEqual([{ local_id: central, saldo: 12 }]);

        const { rows } = await db.query('SELECT tipo, quantidade, motivo, local_id, saldo_local_resultante FROM movimentacoes_estoque WHERE produto_id = $1', [produto]);
        expect(rows).toEqual([{ tipo: 'entrada', quantidade: 12, motivo: 'Estoque inicial', local_id: central, saldo_local_resultante: 12 }]);
    });

    test('sem local_id a movimentação vai para o Central; GET estoque-locais mostra saldos e consistência', async () => {
        const produto = await criarProduto(A, 0);

        expect((await mov(A, produto, { tipo: 'entrada', quantidade: 10 })).status).toBe(201);
        const res = await api(A, A.estoquista, 'estoquista', 'get', `/produtos/${produto}/estoque-locais`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ produto_id: produto, estoque_total: 10, consistente: true });
        expect(res.body.data.locais.find((l) => l.tipo === 'central').saldo).toBe(10);
    });

    test('maleta tem saldo próprio: saída além do saldo do local = 409 mesmo com total suficiente; ajuste move o total pela diferença', async () => {
        const produto = await criarProduto(A, 10);
        const maleta = await criarMaleta(A, A.vendedor);

        expect((await mov(A, produto, { tipo: 'entrada', quantidade: 4, local_id: maleta })).status).toBe(201);
        expect(await total(produto)).toBe(14);

        const semSaldo = await mov(A, produto, { tipo: 'saida', quantidade: 5, local_id: maleta });
        expect(semSaldo.status).toBe(409);
        expect(await total(produto)).toBe(14);

        expect((await mov(A, produto, { tipo: 'ajuste', quantidade: 1, local_id: maleta })).status).toBe(201);
        expect(await total(produto)).toBe(11); // 10 (Central) + 1 (Maleta)
        expect(await somaLocais(produto)).toBe(11);

        const { rows } = await db.query('SELECT estoque_resultante, saldo_local_resultante FROM movimentacoes_estoque WHERE produto_id = $1 ORDER BY id DESC LIMIT 1', [produto]);
        expect(rows[0]).toEqual({ estoque_resultante: 11, saldo_local_resultante: 1 });
    });

    test('isolamento: local e produto de outra empresa respondem 404 e nada é gravado', async () => {
        const produtoA = await criarProduto(A, 5);
        const produtoB = await criarProduto(B, 5);
        const maletaB = await criarMaleta(B, B.admin);

        expect((await mov(A, produtoA, { tipo: 'entrada', quantidade: 1, local_id: maletaB })).status).toBe(404);
        expect((await mov(A, produtoB, { tipo: 'entrada', quantidade: 1 })).status).toBe(404);
        expect((await api(A, A.estoquista, 'estoquista', 'get', `/produtos/${produtoB}/estoque-locais`)).status).toBe(404);

        expect(await total(produtoA)).toBe(5);
        expect(await somaLocais(produtoB)).toBe(5);
    });

    test('lista de locais só traz os da empresa do token; vendedor não acessa', async () => {
        await criarMaleta(B, B.estoquista);
        const res = await api(A, A.estoquista, 'estoquista', 'get', '/produtos/locais-estoque');

        expect(res.status).toBe(200);
        expect(res.body.data.every((l) => l.nome !== undefined)).toBe(true);
        const ids = (await db.query('SELECT id FROM locais_estoque WHERE empresa_id = $1', [A.empresaId])).rows.map((r) => r.id).sort();
        expect(res.body.data.map((l) => l.id).sort()).toEqual(ids);

        expect((await api(A, A.vendedor, 'vendedor', 'get', '/produtos/locais-estoque')).status).toBe(403);
        expect((await api(A, A.vendedor, 'vendedor', 'get', '/produtos/1/estoque-locais')).status).toBe(403);
    });

    test('concorrência: 12 saídas simultâneas de 1 com saldo 5 → exatamente 5 passam, 7 recebem 409, saldo 0 e invariante íntegra', async () => {
        const produto = await criarProduto(A, 5);

        const respostas = await Promise.all(
            Array.from({ length: 12 }, () => mov(A, produto, { tipo: 'saida', quantidade: 1 }))
        );

        expect(respostas.filter((r) => r.status === 201)).toHaveLength(5);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(7);
        expect(await total(produto)).toBe(0);
        expect(await somaLocais(produto)).toBe(0);
    });

    test('concorrência entre locais do mesmo produto não quebra a soma = total', async () => {
        const produto = await criarProduto(A, 20);
        const maleta = await criarMaleta(A, A.estoquista);
        await mov(A, produto, { tipo: 'entrada', quantidade: 20, local_id: maleta });

        await Promise.all([
            ...Array.from({ length: 8 }, () => mov(A, produto, { tipo: 'saida', quantidade: 2 })),
            ...Array.from({ length: 8 }, () => mov(A, produto, { tipo: 'saida', quantidade: 3, local_id: maleta })),
            ...Array.from({ length: 4 }, () => mov(A, produto, { tipo: 'entrada', quantidade: 1, local_id: maleta }))
        ]);

        expect(await somaLocais(produto)).toBe(await total(produto));
        expect((await saldos(produto)).every((s) => s.saldo >= 0)).toBe(true);
    });
});

// Integração de verdade (Postgres real): POST /produtos/codigos/etiquetas garante o código por produto para
// imprimir etiqueta. Prova idempotência, isolamento entre empresas, permissão por papel e que o código gerado
// é achado pela busca que o PDV usa (GET /produtos/buscar-codigo/:codigo). Cria empresas próprias e limpa tudo.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarRegistroDeEmpresas, removerEmpresasPorNome } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');
const NOME = (rotulo) => `Teste Etiqueta ${rotulo} ${SUFIXO}`;
const empresas = {};

async function criarUsuario(empresaId, papel, rotulo) {
    const email = `etiqueta-${rotulo}-${papel}-${SUFIXO}@teste.invalid`;
    await db.query(
        'INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5)',
        [empresaId, `Teste ${papel} ${rotulo}`, email, await bcrypt.hash(SENHA, 4), papel]
    );
    const res = await request(app).post('/auth/login').send({ email, senha: SENHA });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.token;
}

async function criarProduto(empresaId, nome) {
    const { rows } = await db.query(
        'INSERT INTO produtos (empresa_id, nome, custo, estoque_atual, estoque_minimo) VALUES ($1, $2, 1, 5, 1) RETURNING id',
        [empresaId, nome]
    );
    return rows[0].id;
}

async function montarEmpresa(rotulo) {
    const emp = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [NOME(rotulo)]);
    const id = registro.registrar(emp.rows[0].id);
    empresas[rotulo] = {
        id,
        admin: await criarUsuario(id, 'admin', rotulo),
        estoquista: await criarUsuario(id, 'estoquista', rotulo),
        vendedor: await criarUsuario(id, 'vendedor', rotulo),
        produto: await criarProduto(id, `Produto ${rotulo}`),
        produto2: await criarProduto(id, `Produto 2 ${rotulo}`)
    };
}

const gerar = (token, produtoIds) => request(app).post('/produtos/codigos/etiquetas').set('Authorization', `Bearer ${token}`).send({ produto_ids: produtoIds });

beforeAll(async () => {
    await montarEmpresa('A');
    await montarEmpresa('B');
});

afterAll(async () => {
    try {
        for (const id of registro.ids()) {
            await db.query('DELETE FROM produtos_codigos WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM produtos WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM empresas WHERE id = $1', [id]);
        }
    } finally {
        try {
            await registro.limpar();
            await removerEmpresasPorNome(db, 'Teste Etiqueta % ' + SUFIXO);
        } finally {
            await db.end();
        }
    }
});

describe('POST /produtos/codigos/etiquetas', () => {
    test('gera código interno por produto, é idempotente e o PDV acha o produto pelo código', async () => {
        const A = empresas.A;
        const primeira = await gerar(A.estoquista, [A.produto, A.produto2]);
        expect(primeira.status).toBe(200);
        expect(primeira.body.data).toHaveLength(2);
        expect(primeira.body.data[0]).toMatchObject({ produto_id: A.produto, tipo: 'INTERNO', codigo: String(A.produto).padStart(6, '0') });

        const segunda = await gerar(A.admin, [A.produto]);
        expect(segunda.body.data[0].codigo).toBe(primeira.body.data[0].codigo);

        const { rows } = await db.query('SELECT count(*)::int AS n FROM produtos_codigos WHERE empresa_id = $1 AND produto_id = $2', [A.id, A.produto]);
        expect(rows[0].n).toBe(1);

        const busca = await request(app).get(`/produtos/buscar-codigo/${primeira.body.data[0].codigo}`).set('Authorization', `Bearer ${A.vendedor}`);
        expect(busca.status).toBe(200);
        expect(busca.body.data.produto_id).toBe(A.produto);
    });

    test('produto de outra empresa responde 404 e não cria código', async () => {
        const res = await gerar(empresas.A.admin, [empresas.B.produto]);
        expect(res.status).toBe(404);

        const { rows } = await db.query('SELECT count(*)::int AS n FROM produtos_codigos WHERE produto_id = $1', [empresas.B.produto]);
        expect(rows[0].n).toBe(0);
    });

    test('vendedor não gera código (403) e sem token é 401', async () => {
        expect((await gerar(empresas.A.vendedor, [empresas.A.produto])).status).toBe(403);
        expect((await request(app).post('/produtos/codigos/etiquetas').send({ produto_ids: [1] })).status).toBe(401);
    });

    test('entrada inválida responde 400', async () => {
        expect((await gerar(empresas.A.admin, [])).status).toBe(400);
        expect((await request(app).post('/produtos/codigos/etiquetas').set('Authorization', `Bearer ${empresas.A.admin}`).send({ produto_ids: 'x' })).status).toBe(400);
    });
});

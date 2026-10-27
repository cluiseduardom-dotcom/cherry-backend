// Integração de verdade (Postgres da CI/dev): migration 068. Produto nasce só com custo; o preço de venda
// é definido depois, por canal. produtos.preco_venda fica NULL e nada quebra (margem nula, preço do canal nulo).
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
const E = { adminId: null, empresaId: null };

const admin = () => ({ Authorization: `Bearer ${makeToken({ id: E.adminId, role: 'admin', empresa_id: E.empresaId, tv: 0 })}` });

beforeAll(async () => {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste SemPrecoBase ${sufixo}`]);
    E.empresaId = registro.registrar(rows[0].id);
    const { rows: u } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, 'admin', $2, $3, 'admin', true) RETURNING id`,
        [E.empresaId, `admin-${E.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH]
    );
    E.adminId = u[0].id;
    await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true), ($1, 'online', true)`, [E.empresaId]);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('criar produto sem preço de venda', () => {
    test('cria só com custo: preco_venda fica nulo', async () => {
        const res = await request(app).post('/produtos').set(admin()).send({ nome: 'Anel Teste', custo: 12.5 });
        expect(res.status).toBe(201);
        const { rows } = await db.query('SELECT preco_venda, custo FROM produtos WHERE id = $1 AND empresa_id = $2', [res.body.data.id, E.empresaId]);
        expect(rows[0].preco_venda).toBeNull();
        expect(Number(rows[0].custo)).toBe(12.5);
    });

    test('listagem e detalhe não quebram: margem nula e sem preço no canal', async () => {
        const lista = await request(app).get('/produtos?canal=loja_fisica').set(admin());
        expect(lista.status).toBe(200);
        const item = lista.body.data.items.find((p) => p.nome === 'Anel Teste');
        expect(item.preco_venda).toBeNull();
        expect(item.margem_percentual).toBeNull();
        expect(item.preco_canal.preco_venda).toBeNull();
    });

    test('preço informado continua validado (> 0)', async () => {
        const res = await request(app).post('/produtos').set(admin()).send({ nome: 'Anel Zero', custo: 5, preco_venda: 0 });
        expect(res.status).toBe(400);
    });

    test('preço informado continua sendo aceito (compatibilidade)', async () => {
        const res = await request(app).post('/produtos').set(admin()).send({ nome: 'Anel Com Preço', custo: 5, preco_venda: 20 });
        expect(res.status).toBe(201);
    });

    test('custo continua obrigatório', async () => {
        const res = await request(app).post('/produtos').set(admin()).send({ nome: 'Anel Sem Custo' });
        expect(res.status).toBe(400);
    });
});

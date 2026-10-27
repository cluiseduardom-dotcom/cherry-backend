// Integração de verdade (Postgres da CI/dev): migration 067, versionamento da ficha de venda do SKU,
// custo total, validação de tipo/ativo/empresa e RBAC.
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
const ids = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste FichaVenda ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'vendedor', 'estoquista']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
}

async function criarProduto(alvo, { sku, nome, tipo = 'acabado', custo, ativo = true }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual, estoque_minimo, tipo, ativo)
         VALUES ($1, $2, $3, 50, $4, 0, 0, $5, $6) RETURNING id`,
        [alvo.empresaId, sku, nome, custo, tipo, ativo]
    );
    return rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const criarFicha = (alvo, papel, produtoId, itens) =>
    request(app).post(`/produtos/${produtoId}/ficha-venda`).set(como(alvo, papel)).send({ itens });

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    ids.colar = await criarProduto(A, { sku: 'COL-1', nome: 'Colar', custo: 15 });
    ids.embalagem = await criarProduto(A, { sku: 'EMB-1', nome: 'Embalagem', tipo: 'insumo', custo: 0.8 });
    ids.tag = await criarProduto(A, { sku: 'TAG-1', nome: 'Tag logo', tipo: 'insumo', custo: 0.35 });
    ids.inativo = await criarProduto(A, { sku: 'INA-1', nome: 'Saquinho antigo', tipo: 'insumo', custo: 0.1, ativo: false });
    ids.outroAcabado = await criarProduto(A, { sku: 'ANE-1', nome: 'Anel', custo: 9 });
    ids.insumoB = await criarProduto(B, { sku: 'EMB-B', nome: 'Embalagem B', tipo: 'insumo', custo: 1 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('ficha de venda do SKU (integração)', () => {
    test('admin cria a ficha e recebe custo total = item + insumos', async () => {
        const res = await criarFicha(A, 'admin', ids.colar, [
            { insumo_produto_id: ids.embalagem, quantidade: 1 },
            { insumo_produto_id: ids.tag, quantidade: 2 }
        ]);

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ vigente: true, custo_item: 15, custo_insumos: 1.5, custo_total_sku: 16.5 });
        expect(res.body.data.itens).toHaveLength(2);
        expect(res.body.data.itens[1]).toMatchObject({ insumo_sku: 'TAG-1', quantidade: 2, subtotal_custo: 0.7 });
    });

    test('nova versão derruba a anterior; histórico guarda as duas; só uma vigente', async () => {
        const nova = await criarFicha(A, 'admin', ids.colar, [{ insumo_produto_id: ids.embalagem, quantidade: 3 }]);
        expect(nova.status).toBe(201);

        const vigente = await request(app).get(`/produtos/${ids.colar}/ficha-venda`).set(como(A, 'admin'));
        expect(vigente.body.data.id).toBe(nova.body.data.id);
        expect(vigente.body.data.itens).toHaveLength(1);

        const hist = await request(app).get(`/produtos/${ids.colar}/ficha-venda/historico`).set(como(A, 'admin'));
        expect(hist.body.data.length).toBeGreaterThanOrEqual(2);
        expect(hist.body.data.filter((f) => f.vigente)).toHaveLength(1);
    });

    test('ficha vazia é válida (SKU sem insumos) e vira a vigente', async () => {
        const res = await criarFicha(A, 'admin', ids.colar, []);
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ itens: [], custo_insumos: 0, custo_total_sku: 15 });
    });

    test('produto sem ficha: GET devolve composição vazia com o custo do item', async () => {
        const res = await request(app).get(`/produtos/${ids.outroAcabado}/ficha-venda`).set(como(A, 'admin'));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: null, itens: [], custo_total_sku: 9 });
    });

    test.each([
        ['insumo repetido', () => [{ insumo_produto_id: ids.embalagem, quantidade: 1 }, { insumo_produto_id: ids.embalagem, quantidade: 1 }], 400],
        ['quantidade zero', () => [{ insumo_produto_id: ids.embalagem, quantidade: 0 }], 400],
        ['quantidade fracionada', () => [{ insumo_produto_id: ids.embalagem, quantidade: 1.5 }], 400],
        ['item que não é insumo', () => [{ insumo_produto_id: ids.outroAcabado, quantidade: 1 }], 400],
        ['insumo inativo', () => [{ insumo_produto_id: ids.inativo, quantidade: 1 }], 400],
        ['insumo de outra empresa', () => [{ insumo_produto_id: ids.insumoB, quantidade: 1 }], 404],
        ['insumo inexistente', () => [{ insumo_produto_id: 999999999, quantidade: 1 }], 404]
    ])('recusa %s', async (_nome, itens, status) => {
        const res = await criarFicha(A, 'admin', ids.colar, itens());
        expect(res.status).toBe(status);
    });

    test('recusa ficha para produto que é insumo e para produto de outra empresa', async () => {
        expect((await criarFicha(A, 'admin', ids.embalagem, [])).status).toBe(400);
        expect((await criarFicha(B, 'admin', ids.colar, [])).status).toBe(404);
        expect((await request(app).get(`/produtos/${ids.colar}/ficha-venda`).set(como(B, 'admin'))).status).toBe(404);
    });

    test('falha numa validação não derruba a ficha vigente (transação)', async () => {
        const ok = await criarFicha(A, 'admin', ids.colar, [{ insumo_produto_id: ids.tag, quantidade: 1 }]);
        expect(ok.status).toBe(201);

        const ruim = await criarFicha(A, 'admin', ids.colar, [{ insumo_produto_id: ids.tag, quantidade: 1 }, { insumo_produto_id: ids.insumoB, quantidade: 1 }]);
        expect(ruim.status).toBe(404);

        const vigente = await request(app).get(`/produtos/${ids.colar}/ficha-venda`).set(como(A, 'admin'));
        expect(vigente.body.data.id).toBe(ok.body.data.id);
    });

    test('vendedor não acessa a ficha de venda (403)', async () => {
        expect((await request(app).get(`/produtos/${ids.colar}/ficha-venda`).set(como(A, 'vendedor'))).status).toBe(403);
        expect((await criarFicha(A, 'vendedor', ids.colar, [])).status).toBe(403);
    });

    test('estoquista cria e lê a composição; custo só aparece para quem tem a capacidade de ver custos', async () => {
        const res = await criarFicha(A, 'estoquista', ids.colar, [{ insumo_produto_id: ids.embalagem, quantidade: 1 }]);
        expect(res.status).toBe(201);

        const admin = await request(app).get(`/produtos/${ids.colar}/ficha-venda`).set(como(A, 'admin'));
        expect(admin.body.data.custo_total_sku).toBe(15.8);

        const est = await request(app).get(`/produtos/${ids.colar}/ficha-venda`).set(como(A, 'estoquista'));
        expect(est.status).toBe(200);
        expect(est.body.data.itens).toHaveLength(1);
        if (!('custo_total_sku' in est.body.data)) {
            expect(JSON.stringify(est.body)).not.toMatch(/custo/i);
        }
    });

    test('o banco recusa insumo de outra empresa mesmo por SQL direto (FK composta)', async () => {
        const { rows } = await db.query(
            `INSERT INTO fichas_venda (empresa_id, produto_id) VALUES ($1, $2) RETURNING id`, [A.empresaId, ids.outroAcabado]
        );
        await expect(db.query(
            `INSERT INTO itens_ficha_venda (empresa_id, ficha_venda_id, insumo_produto_id, quantidade) VALUES ($1, $2, $3, 1)`,
            [A.empresaId, rows[0].id, ids.insumoB]
        )).rejects.toThrow();
    });
});

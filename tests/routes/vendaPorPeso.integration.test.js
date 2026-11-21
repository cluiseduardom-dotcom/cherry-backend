// Integração (Postgres de testes): venda por peso/volume. Produto em G ou ML tem "preço por N unidades" (ex.: R$ 45,00 o kg).
// O estoque segue inteiro (gramas); o item da venda congela o preço por unidade-base (R$ 0,045/g) e o total é arredondado por item.
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

const como = (papel) => ({ Authorization: `Bearer ${makeToken({ id: A.u[papel], role: papel, empresa_id: A.empresaId, tv: 0 })}` });
const post = (papel, url, corpo) => request(app).post(url).set(como(papel)).send(corpo);
const put = (papel, url, corpo) => request(app).put(url).set(como(papel)).send(corpo);
const get = (papel, url) => request(app).get(url).set(como(papel));

async function criarProduto(chave, { unidade, base = 1, preco, custo, saldo }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, unidade, preco_base_quantidade)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [A.empresaId, `PESO-${chave}-${sufixo}`, `Produto ${chave}`, custo, preco, saldo, unidade, base]
    );
    A.p[chave] = rows[0].id;
    await db.query(
        `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) SELECT $1, l.id, $2, $3 FROM locais_estoque l WHERE l.empresa_id = $2 AND l.tipo = 'central'`,
        [rows[0].id, A.empresaId, saldo]
    );
    await db.query(
        `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 100, 50)`,
        [A.empresaId, rows[0].id, A.canalId, preco]
    );
}

beforeAll(async () => {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Peso ${sufixo}`]);
    A.empresaId = registro.registrar(rows[0].id);
    A.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [A.empresaId])).rows[0].id;
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central')`, [A.empresaId]);
    for (const papel of ['admin', 'vendedor']) {
        A.u[papel] = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [A.empresaId, `${papel} ${sufixo}`, `${papel}-${A.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        )).rows[0].id;
    }
    // queijo: R$ 45,00 o kg, custo R$ 0,03 o grama (R$ 30/kg); refrigerante: R$ 9,90 o litro; unidade comum
    await criarProduto('queijo', { unidade: 'G', base: 1000, preco: 45, custo: 0.03, saldo: 5000 });
    await criarProduto('suco', { unidade: 'ML', base: 1000, preco: 9.9, custo: 0.004, saldo: 10000 });
    await criarProduto('anel', { unidade: 'UN', base: 1, preco: 100, custo: 40, saldo: 10 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

const vender = (itens, extra = {}) => post('vendedor', '/vendas', { itens, ...extra });

describe('venda por peso', () => {
    test('350 g a R$ 45,00/kg = R$ 15,75; o item congela o preço por grama e o estoque baixa 350', async () => {
        const res = await vender([{ produto_id: A.p.queijo, quantidade: 350 }]);

        expect(res.status).toBe(201);
        expect(res.body.data.subtotal).toBe(15.75);
        expect(res.body.data.total).toBe(15.75);
        const item = (await db.query('SELECT quantidade, preco_unitario::float AS preco, custo_unitario::float AS custo FROM itens_venda WHERE venda_id = $1', [res.body.data.id])).rows[0];

        expect(item).toEqual({ quantidade: 350, preco: 0.045, custo: 0.03 });
        expect((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.p.queijo])).rows[0].estoque_atual).toBe(4650);
    });

    test('arredonda por item ao centavo: 333 g a R$ 9,90/L = R$ 3,30 (3,2967) e 7 g a R$ 45/kg = R$ 0,32 (0,315)', async () => {
        const res = await vender([{ produto_id: A.p.suco, quantidade: 333 }, { produto_id: A.p.queijo, quantidade: 7 }]);

        expect(res.status).toBe(201);
        expect(res.body.data.subtotal).toBe(3.62); // 3,30 + 0,32
    });

    test('mistura com produto por unidade e desconto', async () => {
        const res = await vender([{ produto_id: A.p.queijo, quantidade: 1000 }, { produto_id: A.p.anel, quantidade: 2 }], { desconto: 5 });

        expect(res.status).toBe(201);
        expect(res.body.data.subtotal).toBe(245); // 45 + 200
        expect(res.body.data.total).toBe(240);
    });

    test('estoque insuficiente em gramas = 409 e nada baixa', async () => {
        const antes = (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.p.queijo])).rows[0].estoque_atual;
        const res = await vender([{ produto_id: A.p.queijo, quantidade: antes + 1 }]);

        expect(res.status).toBe(409);
        expect((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.p.queijo])).rows[0].estoque_atual).toBe(antes);
    });

    test('produto por unidade segue idêntico ao de sempre (base 1)', async () => {
        const res = await vender([{ produto_id: A.p.anel, quantidade: 3 }]);

        expect(res.body.data.subtotal).toBe(300);
    });

    test('relatórios continuam certos: faturamento e lucro do queijo usam o preço por grama', async () => {
        const { rows } = await db.query(
            `SELECT SUM(quantidade * preco_unitario)::float AS fat, SUM(quantidade * (preco_unitario - custo_unitario))::float AS lucro
             FROM itens_venda WHERE produto_id = $1 AND empresa_id = $2`,
            [A.p.queijo, A.empresaId]
        );

        // (350 + 7 + 1000) g × 0,045 = 61,065; lucro = 1357 × 0,015 = 20,355
        expect(rows[0].fat).toBeCloseTo(61.065, 6);
        expect(rows[0].lucro).toBeCloseTo(20.355, 6);
    });
});

describe('cadastro: preço por N unidades', () => {
    test('só G e ML aceitam base 100 ou 1000; UN, PAR... ficam em 1', async () => {
        const ok = await put('admin', `/produtos/${A.p.queijo}`, { preco_base_quantidade: 100 });

        expect(ok.status).toBe(200);
        expect(ok.body.data.preco_base_quantidade).toBe(100);
        expect((await put('admin', `/produtos/${A.p.anel}`, { preco_base_quantidade: 1000 })).status).toBe(400);
        expect((await put('admin', `/produtos/${A.p.queijo}`, { preco_base_quantidade: 7 })).status).toBe(400);
        expect((await put('admin', `/produtos/${A.p.queijo}`, { preco_base_quantidade: 1000 })).status).toBe(200);
        // trocar a unidade para UN com base 1000 também é recusado
        expect((await put('admin', `/produtos/${A.p.queijo}`, { unidade: 'UN' })).status).toBe(400);
    });

    test('criar produto em G com base 1000', async () => {
        const res = await post('admin', '/produtos', { sku: `NOVO-${sufixo}`, nome: 'Granel', custo: 0.02, unidade: 'G', preco_base_quantidade: 1000 });

        expect(res.status).toBe(201);
        expect(res.body.data.preco_base_quantidade).toBe(1000);
        expect((await post('admin', '/produtos', { sku: `NOVO2-${sufixo}`, nome: 'Peça', custo: 5, unidade: 'UN', preco_base_quantidade: 1000 })).status).toBe(400);
    });
});

describe('preço e margem consideram o preço por N', () => {
    test('definir preço R$ 45/kg com custo R$ 0,03/g (R$ 30/kg): markup 50% e margem 33,33%; abaixo do custo = 409', async () => {
        const ok = await put('admin', `/produtos/${A.p.queijo}/precos/${A.canalId}`, { preco_venda: 45 });

        expect(ok.status).toBe(201);
        expect(Number(ok.body.data.markup_percentual)).toBe(50);
        expect(Number(ok.body.data.margem_percentual)).toBe(33.33);
        expect((await put('admin', `/produtos/${A.p.queijo}/precos/${A.canalId}`, { preco_venda: 25 })).status).toBe(409);
    });

    test('a margem do produto (GET) usa o custo por N', async () => {
        const res = await get('admin', `/produtos/${A.p.queijo}`);

        expect(res.body.data.margem_percentual).toBe(33.33);
    });
});

describe('loja online não vende por peso', () => {
    test('produto granel não publica; produto publicado não vira granel', async () => {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste') ON CONFLICT DO NOTHING`, [A.empresaId]);

        expect((await put('admin', `/produtos/${A.p.queijo}/loja`, { visivel: true })).status).toBe(409);

        // anel (por unidade) publica; depois não pode virar granel (e unidade UN já recusa base > 1 por si só)
        await db.query(`UPDATE produtos SET unidade = 'G' WHERE id = $1`, [A.p.anel]);
        expect((await put('admin', `/produtos/${A.p.anel}/loja`, { visivel: true })).status).toBe(200);
        expect((await put('admin', `/produtos/${A.p.anel}`, { preco_base_quantidade: 1000 })).status).toBe(409);
    });
});

// Integração (Postgres de testes): insumos com categorização e SKU próprios (migration 094). Empresa criada pelo
// onboarding (recebe o padrão de insumos), escopos separados, SKU por padrão e isolamento entre empresas.
jest.setTimeout(60000);
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarTenant } = require('../../src/services/onboardingService');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const A = {};
const B = {};

async function novaEmpresa(alvo, rotulo) {
    const { empresa, usuario } = await criarTenant({
        empresa_nome: `Teste Escopo Insumo ${rotulo} ${sufixo}`,
        nome_admin: `Admin ${rotulo}`,
        email_admin: `admin-${rotulo.toLowerCase()}-${sufixo}@teste.invalid`.toLowerCase(),
        senha_admin: crypto.randomBytes(12).toString('hex')
    });
    alvo.empresaId = registro.registrar(empresa.id);
    alvo.adminId = usuario.id;
}

const auth = (alvo) => ({ Authorization: `Bearer ${makeToken({ id: alvo.adminId, role: 'admin', empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, url) => request(app).get(url).set(auth(alvo));
const post = (alvo, url, corpo) => request(app).post(url).set(auth(alvo)).send(corpo);
const patch = (alvo, url, corpo) => request(app).patch(url).set(auth(alvo)).send(corpo);

const novoProduto = async (alvo, nome, tipo) => (await post(alvo, '/produtos', { nome, custo: 1, tipo })).body.data.id;

beforeAll(async () => {
    await novaEmpresa(A, 'A');
    await novaEmpresa(B, 'B');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('empresa nova recebe o padrão de insumos', () => {
    test('categorias: EMB, ETQ e MAT no escopo insumo; escopo produto começa vazio', async () => {
        const insumo = await get(A, '/categorias?escopo=insumo');
        const produto = await get(A, '/categorias');

        expect(insumo.body.data.items.map((c) => c.codigo).sort()).toEqual(['EMB', 'ETQ', 'MAT']);
        expect(insumo.body.data.items.every((c) => c.nivel === 1 && c.escopo === 'insumo')).toBe(true);
        expect(produto.body.data.items).toEqual([]);
    });

    test('rótulos dos níveis e padrão de SKU de insumos (Família obrigatória, Tamanho opcional)', async () => {
        const niveis = await get(A, '/niveis-categoria?escopo=insumo');
        expect(niveis.body.data.map((n) => [n.nivel, n.nome])).toEqual([[1, 'Família'], [2, 'Tamanho']]);
        expect((await get(A, '/niveis-categoria')).body.data).toEqual([]);

        const config = await get(A, '/configuracoes-sku?escopo=insumo');
        expect(config.status).toBe(200);
        expect(config.body.data).toMatchObject({ nome: 'Insumos', escopo: 'insumo', padrao: true, separador: '-' });
        expect((await get(A, '/configuracoes-sku/padroes?escopo=insumo')).body.data.length).toBe(1);
        expect(config.body.data.segmentos.map((s) => [s.nivel, s.nome, s.obrigatorio])).toEqual([[1, 'Família', true], [2, 'Tamanho', false]]);
    });

    test('escopo inválido é 400', async () => {
        expect((await get(A, '/categorias?escopo=outro')).status).toBe(400);
    });
});

describe('SKU de insumo', () => {
    test('categorizar insumo gera EMB-001, EMB-002 e ETQ-001 (sequência por família)', async () => {
        const categorias = (await get(A, '/categorias?escopo=insumo')).body.data.items;
        const id = (codigo) => categorias.find((c) => c.codigo === codigo).id;

        const i1 = await novoProduto(A, 'Saquinho zip pequeno', 'insumo');
        const i2 = await novoProduto(A, 'Saquinho zip grande', 'insumo');
        const i3 = await novoProduto(A, 'Tag dourada', 'insumo');

        const r1 = await patch(A, `/produtos/${i1}/categoria`, { categoria_ids: [id('EMB')] });
        const r2 = await patch(A, `/produtos/${i2}/categoria`, { categoria_ids: [id('EMB')] });
        const r3 = await patch(A, `/produtos/${i3}/categoria`, { categoria_ids: [id('ETQ')] });

        expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
        expect(r1.body.data.sku).toBe('EMB-001');
        expect(r2.body.data.sku).toBe('EMB-002');
        expect(r3.body.data.sku).toBe('ETQ-001');
    });

    test('insumo recusa categoria de produto; produto acabado recusa categoria de insumo', async () => {
        const catProduto = (await post(A, '/categorias', { nivel: 1, codigo: 'ANE', nome: 'Anel' })).body.data;
        const catInsumo = (await get(A, '/categorias?escopo=insumo')).body.data.items[0];

        const insumo = await novoProduto(A, 'Caixa', 'insumo');
        const acabado = await novoProduto(A, 'Anel solitário', 'acabado');

        const r1 = await patch(A, `/produtos/${insumo}/categoria`, { categoria_ids: [catProduto.id] });
        const r2 = await patch(A, `/produtos/${acabado}/categoria`, { categoria_ids: [catInsumo.id] });

        expect(r1.status).toBe(400);
        expect(r1.body.message ?? r1.body.error).toMatch(/Insumos só aceitam categorias de insumo/);
        expect(r2.status).toBe(400);
        expect(r2.body.message ?? r2.body.error).toMatch(/Produtos só aceitam categorias de produto/);
    });
});

describe('escopos independentes e isolamento', () => {
    test('o mesmo código pode existir nos dois escopos, mas não repetir dentro de um', async () => {
        const produtoEmb = await post(A, '/categorias', { nivel: 1, codigo: 'EMB', nome: 'Embalagem de produto' });
        const repetido = await post(A, '/categorias', { nivel: 1, codigo: 'emb', nome: 'Outra', escopo: 'insumo' });

        expect(produtoEmb.status).toBe(201);
        expect(produtoEmb.body.data.escopo).toBe('produto');
        expect(repetido.status).toBe(409);
    });

    test('o padrão de produto não aparece na lista de insumos e vice-versa', async () => {
        const insumo = (await get(A, '/categorias?escopo=insumo')).body.data.items.map((c) => c.codigo);
        const produto = (await get(A, '/categorias')).body.data.items.map((c) => c.codigo);

        expect(insumo).not.toContain('ANE');
        expect(produto).not.toContain('ETQ');
    });

    test('categoria de insumo de outra empresa não é aceita (Categoria inválida)', async () => {
        const catDeB = (await get(B, '/categorias?escopo=insumo')).body.data.items[0];
        const insumo = await novoProduto(A, 'Embalagem teste isolamento', 'insumo');

        const res = await patch(A, `/produtos/${insumo}/categoria`, { categoria_ids: [catDeB.id] });

        expect(res.status).toBe(400);
    });
});

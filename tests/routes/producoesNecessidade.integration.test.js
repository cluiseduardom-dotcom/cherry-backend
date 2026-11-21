// Integração (Postgres de testes): necessidade de material do PCP — GET /producoes/necessidade.
// Somente leitura: mostra o que uma produção consumiria, o que falta, o que dá para produzir e o custo estimado.
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
const C = { u: {}, p: {} }; // sem a funcionalidade pcp

async function criarEmpresa(alvo, rotulo, { pcp }) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste PCP Necessidade ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'estoquista', 'vendedor', 'gerente']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
    if (pcp) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'pcp', true, 'teste', 'teste')`,
            [alvo.empresaId]
        );
    }
}

async function criarProduto(alvo, chave, { tipo = 'acabado', custo, estoque = 0, ativo = true }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, tipo, ativo) VALUES ($1, $2, $3, $4, 1, $5, $6, $7) RETURNING id`,
        [alvo.empresaId, `PCP-${chave}-${alvo.empresaId}-${sufixo}`, `Item ${chave}`, custo, estoque, tipo, ativo]
    );
    alvo.p[chave] = rows[0].id;
}

async function criarFicha(alvo, produto, itens) {
    const { rows } = await db.query(
        `INSERT INTO fichas_tecnicas (empresa_id, produto_id, vigente, criado_por) VALUES ($1, $2, true, $3) RETURNING id`,
        [alvo.empresaId, alvo.p[produto], alvo.u.admin]
    );
    for (const [insumo, quantidade] of itens) {
        await db.query(
            `INSERT INTO itens_ficha_tecnica (ficha_tecnica_id, insumo_produto_id, quantidade_necessaria, empresa_id) VALUES ($1, $2, $3, $4)`,
            [rows[0].id, alvo.p[insumo], quantidade, alvo.empresaId]
        );
    }
    return rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));

beforeAll(async () => {
    await criarEmpresa(A, 'A', { pcp: true });
    await criarEmpresa(B, 'B', { pcp: true });
    await criarEmpresa(C, 'C', { pcp: false });

    // Bolo: 2 ovos e 1 farinha por unidade. Ovo: 10 em estoque (custo 1). Farinha: 3 em estoque (custo 4).
    await criarProduto(A, 'bolo', { custo: 0 });
    await criarProduto(A, 'ovo', { tipo: 'insumo', custo: 1, estoque: 10 });
    await criarProduto(A, 'farinha', { tipo: 'insumo', custo: 4, estoque: 3 });
    A.ficha = await criarFicha(A, 'bolo', [['ovo', 2], ['farinha', 1]]);

    // Casos de borda (A): sem ficha, insumo como produto, insumo inativo.
    await criarProduto(A, 'semficha', { custo: 0 });
    await criarProduto(A, 'inativo', { tipo: 'insumo', custo: 1, estoque: 50, ativo: false });
    await criarProduto(A, 'tortinha', { custo: 0 });
    await criarFicha(A, 'tortinha', [['inativo', 1]]);

    // Saldo que não divide por igual: 5 fermentos, 2 por pão = só 2 pães (arredonda para baixo, como a produção).
    await criarProduto(A, 'pao', { custo: 0 });
    await criarProduto(A, 'fermento', { tipo: 'insumo', custo: 3, estoque: 5 });
    await criarFicha(A, 'pao', [['fermento', 2]]);

    // B tem um produto próprio: A nunca pode enxergá-lo.
    await criarProduto(B, 'bolo', { custo: 0 });
    await criarProduto(B, 'ovo', { tipo: 'insumo', custo: 1, estoque: 99 });
    await criarFicha(B, 'bolo', [['ovo', 1]]);

    await criarProduto(C, 'bolo', { custo: 0 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /producoes/necessidade', () => {
    test('quando há insumo para tudo: necessário, disponível, sem faltante e pode produzir tudo', async () => {
        const res = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.bolo}&quantidade=3`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            produto: { id: A.p.bolo, nome: 'Item bolo' },
            ficha_tecnica_id: A.ficha,
            quantidade_solicitada: 3,
            pode_produzir_tudo: true,
            maximo_produzivel: 3
        });
        const por = Object.fromEntries(res.body.data.insumos.map((i) => [i.nome, i]));

        expect(por['Item ovo']).toMatchObject({ por_unidade: 2, necessario: 6, disponivel: 10, faltante: 0, suficiente: true });
        expect(por['Item farinha']).toMatchObject({ por_unidade: 1, necessario: 3, disponivel: 3, faltante: 0, suficiente: true });
    });
    test('falta de insumo: faltante, gargalo e máximo produzível com o estoque atual', async () => {
        const res = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.bolo}&quantidade=6`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ pode_produzir_tudo: false, maximo_produzivel: 3, gargalo: { nome: 'Item farinha' } });
        const por = Object.fromEntries(res.body.data.insumos.map((i) => [i.nome, i]));

        expect(por['Item ovo']).toMatchObject({ necessario: 12, disponivel: 10, faltante: 2, suficiente: false, maximo_produzivel: 5 });
        expect(por['Item farinha']).toMatchObject({ necessario: 6, disponivel: 3, faltante: 3, suficiente: false, maximo_produzivel: 3 });
    });

    test('saldo que não divide por igual arredonda para baixo, igual à produção real', async () => {
        const res = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.pao}&quantidade=3`);

        expect(res.body.data).toMatchObject({ maximo_produzivel: 2, pode_produzir_tudo: false });
        expect(res.body.data.insumos[0]).toMatchObject({ necessario: 6, disponivel: 5, faltante: 1 });
    });

    test('quantidade padrão é 1', async () => {
        const res = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.bolo}`);

        expect(res.status).toBe(200);
        expect(res.body.data.quantidade_solicitada).toBe(1);
    });

    test('custo estimado (insumo × quantidade) só para quem vê custos; estoquista não recebe nenhum campo de custo', async () => {
        const admin = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.bolo}&quantidade=3`);

        // por unidade: 2 ovos × 1 + 1 farinha × 4 = 6; para 3 unidades: 18
        expect(admin.body.data.custo_estimado).toEqual({ unitario: 6, total: 18 });
        expect(admin.body.data.insumos.find((i) => i.nome === 'Item farinha')).toMatchObject({ custo_unitario: 4, custo_necessario: 12 });

        const estoquista = await get(A, 'estoquista', `/producoes/necessidade?produto_id=${A.p.bolo}&quantidade=3`);

        expect(estoquista.status).toBe(200);
        expect(estoquista.body.data).not.toHaveProperty('custo_estimado');
        for (const insumo of estoquista.body.data.insumos) {
            expect(insumo).not.toHaveProperty('custo_unitario');
            expect(insumo).not.toHaveProperty('custo_necessario');
            expect(insumo).not.toHaveProperty('custo');
        }
    });

    test('insumo inativo não conta como suficiente (a produção recusaria)', async () => {
        const res = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.tortinha}&quantidade=1`);

        expect(res.status).toBe(200);
        expect(res.body.data.pode_produzir_tudo).toBe(false);
        expect(res.body.data.insumos[0]).toMatchObject({ ativo: false, suficiente: false, faltante: 0 });
    });

    test('é somente leitura: o estoque dos insumos não muda e nenhuma produção é criada', async () => {
        await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.bolo}&quantidade=3`);

        const { rows } = await db.query(`SELECT estoque_atual FROM produtos WHERE id = ANY($1::int[]) ORDER BY id`, [[A.p.ovo, A.p.farinha]]);
        const { rows: producoes } = await db.query(`SELECT COUNT(*)::int AS n FROM producoes WHERE empresa_id = $1`, [A.empresaId]);

        expect(rows.map((r) => r.estoque_atual)).toEqual([10, 3]);
        expect(producoes[0].n).toBe(0);
    });

    test('flag: sem a funcionalidade pcp = 403, mas as rotas antigas de produção seguem abertas', async () => {
        const res = await get(C, 'admin', `/producoes/necessidade?produto_id=${C.p.bolo}`);

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/não incluída no seu plano/);
        expect((await get(C, 'admin', '/producoes')).status).toBe(200);
    });

    test('RBAC: vendedor e gerente (perfil vendedor) não acessam; sem token = 401', async () => {
        expect((await get(A, 'vendedor', `/producoes/necessidade?produto_id=${A.p.bolo}`)).status).toBe(403);
        expect((await get(A, 'gerente', `/producoes/necessidade?produto_id=${A.p.bolo}`)).status).toBe(403);
        expect((await request(app).get(`/producoes/necessidade?produto_id=${A.p.bolo}`)).status).toBe(401);
    });

    test('produto de outra empresa ou inexistente = 404; insumo e produto sem ficha = 400', async () => {
        expect((await get(A, 'admin', `/producoes/necessidade?produto_id=${B.p.bolo}`)).status).toBe(404);
        expect((await get(A, 'admin', '/producoes/necessidade?produto_id=99999999')).status).toBe(404);
        expect((await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.ovo}`)).status).toBe(400);
        const semFicha = await get(A, 'admin', `/producoes/necessidade?produto_id=${A.p.semficha}`);

        expect(semFicha.status).toBe(400);
        expect(semFicha.body.message).toBe('Produto não possui ficha técnica cadastrada');
    });

    test('parâmetros inválidos = 400', async () => {
        for (const consulta of [
            '', 'produto_id=abc', `produto_id=${A.p.bolo}&quantidade=0`, `produto_id=${A.p.bolo}&quantidade=1.5`,
            `produto_id=${A.p.bolo}&quantidade=-2`, `produto_id=${A.p.bolo}&quantidade=abc`, `produto_id=${A.p.bolo}&quantidade=2000000`
        ]) {
            expect((await get(A, 'admin', `/producoes/necessidade?${consulta}`)).status).toBe(400);
        }
    });
});

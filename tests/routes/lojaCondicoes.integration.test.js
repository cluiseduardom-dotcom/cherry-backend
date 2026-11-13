// Integração de verdade (Postgres de testes): condições de venda da loja (frete grátis a partir de um valor, garantia, embalagem
// de presente). Prova: (1) sem configuração nada muda (frete segue a combinar); (2) gestão só para admin com a loja ligada e
// isolada por empresa; (3) o SERVIDOR grava frete 0 só quando o subtotal atinge o valor, sem mudar o total; (4) o institucional
// público só traz o que estiver preenchido; (5) validação. Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { slug: `teste-a-${sufixo}`, p: {} };
const B = { slug: `teste-b-${sufixo}`, p: {} };
const SEM_FLAG = { slug: `teste-c-${sufixo}`, p: {} };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const gestao = (E, papel = 'admin') => {
    const token = papel === 'admin' ? E.tokenAdmin : E.tokenVendedor;

    return {
        get: () => request(app).get('/loja-condicoes').set('Authorization', `Bearer ${token}`),
        put: (corpo) => request(app).put('/loja-condicoes').set('Authorization', `Bearer ${token}`).send(corpo)
    };
};
const institucional = (E) => request(app).get(`/loja/${E.slug}/institucional`);
let seq = 0;
const pedir = (E, chave, quantidade = 1) => request(app).post(`/loja/${E.slug}/pedidos`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
        cliente: { nome: 'Maria Cliente', email: `cli${++seq}-${sufixo}@teste.local`, telefone: '(11) 91234-5678' },
        itens: [{ slug: E.p[chave].slug, quantidade, preco_exibido: E.p[chave].preco }]
    });

async function criarEmpresa(E, nome, { comLoja = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${nome} ${sufixo}`, E.slug]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'online') RETURNING id`, [E.id]);
    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.slug}@teste.local`]);
    E.vendedor = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Vend', $2, 'x', 'vendedor') RETURNING id`, [E.id, `ven-${E.slug}@teste.local`]);
    E.tokenAdmin = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    E.tokenVendedor = makeToken({ id: E.vendedor, role: 'vendedor', empresa_id: E.id, tv: 0 });

    if (comLoja) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

async function criarProduto(E, chave, preco) {
    const id = await um(`INSERT INTO produtos (empresa_id, nome, custo, preco_venda, tipo, ativo) VALUES ($1, $2, 11.11, 77.77, 'acabado', true) RETURNING id`, [E.id, `Peça ${chave}`]);
    const slug = `${chave}-${id}`;

    E.p[chave] = { id, slug, preco };
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 100, 50)`, [E.id, id, E.canal, preco]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 50)`, [id, E.central, E.id]);
    await db.query(`UPDATE produtos SET estoque_atual = 50 WHERE id = $1`, [id]);
    await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug) VALUES ($1, $2, true, $3)`, [id, E.id, slug]);
}

beforeAll(async () => {
    await criarEmpresa(A, 'Condicoes A');
    await criarEmpresa(B, 'Condicoes B');
    await criarEmpresa(SEM_FLAG, 'Condicoes Sem Flag', { comLoja: false });
    await criarProduto(A, 'barata', 100);
    await criarProduto(A, 'cara', 300);
    await criarProduto(B, 'cara', 500);
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('sem configuração nada muda', () => {
    test('gestão mostra tudo vazio e o institucional público não traz as condições', async () => {
        expect((await gestao(A).get()).body.data).toEqual({ frete_gratis_acima: null, garantia_texto: null, embalagem_presente_texto: null });

        const pub = await institucional(A);

        expect(pub.status).toBe(200);
        expect(pub.body.data).not.toHaveProperty('frete_gratis_acima');
        expect(pub.body.data).not.toHaveProperty('garantia');
        expect(pub.body.data).not.toHaveProperty('embalagem_presente');
    });

    test('pedido grande continua com frete a combinar (null)', async () => {
        const res = await pedir(A, 'cara');

        expect(res.status).toBe(201);
        expect(res.body.data.frete).toBeNull();
        expect(res.body.data.total).toBe(300);
    });
});

describe('gestão: permissão e isolamento', () => {
    test('vendedor 403, sem token 401, empresa sem a loja ligada 403', async () => {
        expect((await gestao(A, 'vendedor').get()).status).toBe(403);
        expect((await gestao(A, 'vendedor').put({ garantia_texto: 'x' })).status).toBe(403);
        expect((await request(app).get('/loja-condicoes')).status).toBe(401);
        expect((await gestao(SEM_FLAG).put({ garantia_texto: 'x' })).status).toBe(403);
    });

    test('salvar numa empresa não aparece na outra', async () => {
        const res = await gestao(A).put({ frete_gratis_acima: 300, garantia_texto: '  Garantia de 1 ano.  ', embalagem_presente_texto: 'Embalagem grátis.' });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ frete_gratis_acima: 300, garantia_texto: 'Garantia de 1 ano.', embalagem_presente_texto: 'Embalagem grátis.' });
        expect((await gestao(B).get()).body.data.frete_gratis_acima).toBeNull();
        expect((await institucional(B)).body.data).not.toHaveProperty('garantia');
    });

    test('o institucional público traz só o que foi preenchido', async () => {
        const pub = (await institucional(A)).body.data;

        expect(pub).toMatchObject({ frete_gratis_acima: 300, garantia: 'Garantia de 1 ano.', embalagem_presente: 'Embalagem grátis.' });
    });

    test('campo ausente fica como está e null limpa', async () => {
        await gestao(A).put({ garantia_texto: null });

        const res = await gestao(A).get();

        expect(res.body.data).toEqual({ frete_gratis_acima: 300, garantia_texto: null, embalagem_presente_texto: 'Embalagem grátis.' });
    });

    test('validação: valor zero, negativo, texto e texto longo são recusados; vírgula é aceita', async () => {
        expect((await gestao(A).put({ frete_gratis_acima: 0 })).status).toBe(400);
        expect((await gestao(A).put({ frete_gratis_acima: -5 })).status).toBe(400);
        expect((await gestao(A).put({ frete_gratis_acima: 'abc' })).status).toBe(400);
        expect((await gestao(A).put({ garantia_texto: 'x'.repeat(301) })).status).toBe(400);
        expect((await gestao(A).put({ frete_gratis_acima: '299,90' })).body.data.frete_gratis_acima).toBe(299.9);
        await gestao(A).put({ frete_gratis_acima: 300 });
    });
});

describe('frete grátis é decidido pelo servidor, no pedido', () => {
    test('subtotal abaixo do valor: frete a combinar (null)', async () => {
        const res = await pedir(A, 'barata', 2);

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ subtotal: 200, frete: null, total: 200 });
    });

    test('subtotal exatamente no valor: frete 0 e total igual ao subtotal', async () => {
        const res = await pedir(A, 'cara');

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ subtotal: 300, frete: 0, total: 300 });
    });

    test('acima do valor: frete 0', async () => {
        const res = await pedir(A, 'barata', 4);

        expect(res.body.data).toMatchObject({ subtotal: 400, frete: 0, total: 400 });
    });

    test('o navegador não consegue impor frete (campo extra recusado)', async () => {
        const res = await request(app).post(`/loja/${A.slug}/pedidos`).set('Idempotency-Key', crypto.randomUUID()).send({
            cliente: { nome: 'Maria', email: `x-${sufixo}@teste.local` }, frete: 0,
            itens: [{ slug: A.p.barata.slug, quantidade: 1, preco_exibido: 100 }]
        });

        expect(res.status).toBe(400);
    });

    test('mudar o valor depois não altera pedido já feito; sem o valor, volta a combinar', async () => {
        const antes = await pedir(A, 'cara');
        await gestao(A).put({ frete_gratis_acima: null });
        const depois = await pedir(A, 'cara');

        expect(antes.body.data.frete).toBe(0);
        expect(depois.body.data.frete).toBeNull();

        const reconsulta = await request(app).get(`/loja/${A.slug}/pedidos/${antes.body.data.codigo}`);

        expect(reconsulta.body.data.frete).toBe(0);
    });

    test('a regra de uma empresa não vale para outra', async () => {
        await gestao(A).put({ frete_gratis_acima: 300 });

        const res = await pedir(B, 'cara');

        expect(res.status).toBe(201);
        expect(res.body.data.frete).toBeNull();
    });
});

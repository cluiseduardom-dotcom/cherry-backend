// Integração de verdade (Postgres de testes): lista dos produtos para a marcação "mostrar na loja".
// Prova: só admin, só com a funcionalidade ligada, isolamento entre lojas, filtros, busca literal, o que decide se a
// peça aparece (preço no canal online), e que custo e margem nunca saem. Empresas "Teste ..." temporárias.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'ProdGestao A' };
const B = { nome: 'ProdGestao B' };
const SEM_FLAG = { nome: 'ProdGestao Sem Flag' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;

async function criarEmpresa(E, { comFlag = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ${E.nome} ${sufixo}`]));
    E.usuarios = {};
    for (const papel of ['admin', 'vendedor', 'estoquista']) {
        const id = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, papel, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.usuarios[papel] = { id, token: makeToken({ id, role: papel, empresa_id: E.id, tv: 0 }) };
    }
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'online') RETURNING id`, [E.id]);
    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    if (comFlag) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

async function produto(E, { nome, tipo = 'acabado', ativo = true, preco = null, saldo = 0, fotos = 0, visivel = null, ordem = 0 }) {
    const id = await um(`INSERT INTO produtos (empresa_id, nome, custo, tipo, ativo, estoque_atual) VALUES ($1, $2, 7.77, $3, $4, $5) RETURNING id`, [E.id, nome, tipo, ativo, saldo]);
    if (preco !== null) {
        await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 1, 1)`, [E.id, id, E.canal, preco]);
    }
    if (saldo > 0) await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, E.central, E.id, saldo]);
    for (let i = 0; i < fotos; i += 1) {
        await db.query(`INSERT INTO produto_imagens (empresa_id, produto_id, chave, content_type, tamanho_bytes, ordem) VALUES ($1, $2, $3, 'image/png', 10, $4)`, [E.id, id, `${E.id}/p/${id}/${crypto.randomUUID()}.png`, i]);
    }
    if (visivel !== null) {
        await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug, ordem) VALUES ($1, $2, $3, $4, $5)`, [id, E.id, visivel, `p-${id}`, ordem]);
    }

    return id;
}

const get = (E, papel, caminho) => request(app).get(caminho).set('Authorization', `Bearer ${E.usuarios[papel].token}`);
const nomes = (res) => res.body.data.itens.map((i) => i.nome);

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await criarEmpresa(SEM_FLAG, { comFlag: false });

    A.p = {
        publicada: await produto(A, { nome: 'Anel Publicado', preco: 120, saldo: 3, fotos: 2, visivel: true, ordem: 1 }),
        semPreco: await produto(A, { nome: 'Brinco SemPreco', saldo: 2, visivel: true, ordem: 2 }),
        naoPublicada: await produto(A, { nome: 'Colar Rascunho', preco: 80, saldo: 0 }),
        oculta: await produto(A, { nome: 'Pulseira Oculta', preco: 50, saldo: 1, visivel: false }),
        percento: await produto(A, { nome: 'Desconto 50% Especial', preco: 10 })
    };
    // Nunca entram: material (não é acabado) e produto inativo.
    await produto(A, { nome: 'Material Bruto', tipo: 'insumo', preco: 5 });
    await produto(A, { nome: 'Peça Inativa', ativo: false, preco: 5 });
    await produto(B, { nome: 'Peça da Outra Loja', preco: 99, visivel: true });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('quem pode ver', () => {
    test('sem token: 401; vendedor e estoquista: 403; admin: 200', async () => {
        expect((await request(app).get('/loja-produtos')).status).toBe(401);
        expect((await get(A, 'vendedor', '/loja-produtos')).status).toBe(403);
        expect((await get(A, 'estoquista', '/loja-produtos')).status).toBe(403);
        expect((await get(A, 'admin', '/loja-produtos')).status).toBe(200);
    });

    test('empresa sem a funcionalidade loja_online: 403 de plano, mesmo para o admin', async () => {
        const res = await get(SEM_FLAG, 'admin', '/loja-produtos');

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/plano/i);
    });

    test('a resposta nunca vai para cache', async () => {
        expect((await get(A, 'admin', '/loja-produtos')).headers['cache-control']).toBe('no-store');
    });
});

describe('o que a lista mostra', () => {
    test('filtro no_carrossel lista só as peças escolhidas para o carrossel de novidades', async () => {
        expect(nomes(await get(A, 'admin', '/loja-produtos?situacao=no_carrossel'))).toEqual([]);

        await db.query('UPDATE produtos_loja SET carrossel_novidades = true WHERE produto_id = $1 AND empresa_id = $2', [A.p.publicada, A.id]);
        try {
            expect(nomes(await get(A, 'admin', '/loja-produtos?situacao=no_carrossel'))).toEqual(['Anel Publicado']);
        } finally {
            await db.query('UPDATE produtos_loja SET carrossel_novidades = false WHERE empresa_id = $1', [A.id]);
        }
    });

    test('cada peça traz se é o destaque da Home (padrão: não)', async () => {
        const res = await get(A, 'admin', '/loja-produtos');
        expect(res.body.data.itens.every((i) => i.destaque_home === false)).toBe(true);
    });

    test('cada peça traz se está escolhida para o carrossel de novidades (padrão: não)', async () => {
        const res = await get(A, 'admin', '/loja-produtos');

        expect(res.body.data.itens.length).toBeGreaterThan(0);
        expect(res.body.data.itens.every((i) => i.carrossel_novidades === false)).toBe(true);
    });

    test('só produtos acabados e ativos da própria empresa; publicados primeiro, depois por ordem e nome', async () => {
        const res = await get(A, 'admin', '/loja-produtos');

        expect(res.body.data.total).toBe(5);
        expect(nomes(res)).toEqual(['Anel Publicado', 'Brinco SemPreco', 'Colar Rascunho', 'Desconto 50% Especial', 'Pulseira Oculta']);
        expect(nomes(res)).not.toContain('Material Bruto');
        expect(nomes(res)).not.toContain('Peça Inativa');
        expect(nomes(res)).not.toContain('Peça da Outra Loja');
    });

    test('traz preço online, saldo do Central, fotos e se a peça aparece de fato na loja', async () => {
        const itens = Object.fromEntries((await get(A, 'admin', '/loja-produtos')).body.data.itens.map((i) => [i.nome, i]));

        expect(itens['Anel Publicado']).toMatchObject({ visivel: true, preco_online: 120, saldo_central: 3, fotos: 2, aparece_na_loja: true, slug: `p-${A.p.publicada}` });
        // Marcado como visível mas sem preço no canal online: a loja não mostra, e a tela precisa avisar.
        expect(itens['Brinco SemPreco']).toMatchObject({ visivel: true, preco_online: null, aparece_na_loja: false });
        expect(itens['Colar Rascunho']).toMatchObject({ visivel: false, slug: null, aparece_na_loja: false, saldo_central: 0 });
    });

    test('nunca traz custo, margem nem identificadores de outra empresa', async () => {
        const texto = JSON.stringify((await get(A, 'admin', '/loja-produtos')).body);

        expect(texto).not.toMatch(/custo|margem|markup|7\.77|empresa_id/i);
    });

    test('isolamento: a outra loja só vê os próprios produtos', async () => {
        expect(nomes(await get(B, 'admin', '/loja-produtos'))).toEqual(['Peça da Outra Loja']);
    });
});

describe('filtros, busca e paginação', () => {
    test('situação: publicados e não publicados', async () => {
        expect(nomes(await get(A, 'admin', '/loja-produtos?situacao=publicados'))).toEqual(['Anel Publicado', 'Brinco SemPreco']);
        expect(nomes(await get(A, 'admin', '/loja-produtos?situacao=nao_publicados')).sort()).toEqual(['Colar Rascunho', 'Desconto 50% Especial', 'Pulseira Oculta']);
    });

    test('busca por nome, sem diferenciar maiúsculas', async () => {
        expect(nomes(await get(A, 'admin', '/loja-produtos?busca=aNeL'))).toEqual(['Anel Publicado']);
    });

    test('a busca é texto literal: % e _ não viram curinga', async () => {
        expect(nomes(await get(A, 'admin', `/loja-produtos?busca=${encodeURIComponent('50%')}`))).toEqual(['Desconto 50% Especial']);
        expect(nomes(await get(A, 'admin', `/loja-produtos?busca=${encodeURIComponent('%')}`))).toEqual(['Desconto 50% Especial']);
        expect(nomes(await get(A, 'admin', `/loja-produtos?busca=${encodeURIComponent('_')}`))).toEqual([]);
    });

    test('paginação: total fixo e páginas diferentes', async () => {
        const p1 = await get(A, 'admin', '/loja-produtos?limite=2&pagina=1');
        const p3 = await get(A, 'admin', '/loja-produtos?limite=2&pagina=3');

        expect(p1.body.data).toMatchObject({ total: 5, pagina: 1, limite: 2 });
        expect(nomes(p1)).toEqual(['Anel Publicado', 'Brinco SemPreco']);
        expect(nomes(p3)).toEqual(['Pulseira Oculta']);
    });

    test('parâmetros inválidos: 400', async () => {
        expect((await get(A, 'admin', '/loja-produtos?situacao=qualquer')).status).toBe(400);
        expect((await get(A, 'admin', '/loja-produtos?limite=999')).status).toBe(400);
        expect((await get(A, 'admin', '/loja-produtos?pagina=0')).status).toBe(400);
        expect((await get(A, 'admin', `/loja-produtos?busca=${'x'.repeat(81)}`)).status).toBe(400);
    });
});

// Integração de verdade (Postgres de testes): API pública da loja online e gestão da marcação de produto.
// Empresas próprias e temporárias (nome "Teste ..."); remove tudo no fim.
//
// O que esta suíte prova: (1) a rota pública só responde para empresa ativa com `loja_online` ligada; (2) nenhum campo
// sensível sai (custo, margem, fornecedor, saldo por local, id interno, texto interno); (3) uma empresa nunca vê dado de
// outra; (4) disponibilidade vem só do estoque Central; (5) novidades e mais vendidos seguem as regras do PO;
// (6) só admin com a funcionalidade ligada marca produto.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { MENSAGEM } = require('../../src/middlewares/exigirFuncionalidade');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const SEGREDO_INTERNO = `NOTA-INTERNA-${sufixo}`;
const A = { slug: `teste-a-${sufixo}`, p: {} };
const B = { slug: `teste-b-${sufixo}`, p: {} };
const SEM_FLAG = { slug: `teste-c-${sufixo}`, p: {} };
const INATIVA = { slug: `teste-d-${sufixo}`, p: {} };
const DESLIGADA = { slug: `teste-e-${sufixo}`, p: {} };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const get = (caminho) => request(app).get(caminho);

async function ligarLoja(empresa_id, ligada = true) {
    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel)
         VALUES ($1, 'loja_online', $2, 'teste', 'teste')
         ON CONFLICT (empresa_id, funcionalidade) DO UPDATE SET ligada = EXCLUDED.ligada`,
        [empresa_id, ligada]
    );
}

async function criarEmpresa(E, { status = 'ativa', comLoja = true, nome }) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, $2, $3) RETURNING id`, [`Teste ${nome} ${sufixo}`, status, E.slug]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'online') RETURNING id`, [E.id]);
    E.canalFisico = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'loja_fisica') RETURNING id`, [E.id]);
    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    E.transito = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'transito', 'Em trânsito') RETURNING id`, [E.id]);
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.slug}@teste.local`]);
    E.vendedor = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Vend', $2, 'x', 'vendedor') RETURNING id`, [E.id, `ven-${E.slug}@teste.local`]);
    E.tokenAdmin = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    E.tokenVendedor = makeToken({ id: E.vendedor, role: 'vendedor', empresa_id: E.id, tv: 0 });
    if (comLoja) await ligarLoja(E.id);
}

async function criarCategoria(E, nivel, codigo, nome) {
    return um(`INSERT INTO categorias_produto (empresa_id, nivel, codigo, nome) VALUES ($1, $2, $3, $4) RETURNING id`, [E.id, nivel, codigo, nome]);
}

// Produto completo: preço no canal online, saldo no Central, marcação visível e (opcional) primeira entrada há N dias.
async function criarProduto(E, chave, { nome, tipo = 'acabado', ativo = true, preco = 100, saldo = 3, visivel = true, titulo = null,
    descricao = null, categorias = [], diasDeEntrada = 0, semPreco = false, saldoTransito = 0 } = {}) {
    const id = await um(
        `INSERT INTO produtos (empresa_id, nome, descricao, custo, preco_venda, tipo, ativo) VALUES ($1, $2, $3, 11.11, 77.77, $4, $5) RETURNING id`,
        [E.id, nome, SEGREDO_INTERNO, tipo, ativo]
    );

    E.p[chave] = id;

    if (!semPreco) {
        await db.query(
            `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual)
             VALUES ($1, $2, $3, $4, 123.45, 55.55)`,
            [E.id, id, E.canal, preco]
        );
    }

    if (saldo > 0) await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, E.central, E.id, saldo]);
    if (saldoTransito > 0) await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, E.transito, E.id, saldoTransito]);

    await db.query(
        `INSERT INTO movimentacoes_estoque (empresa_id, produto_id, tipo, quantidade, estoque_resultante, motivo, local_id, saldo_local_resultante, origem, criado_em)
         VALUES ($1, $2, 'entrada', $3, $3, 'Estoque inicial', $4, $3, 'estoque_inicial', NOW() - ($5::int * INTERVAL '1 day'))`,
        [E.id, id, Math.max(saldo, 1), E.central, diasDeEntrada]
    );

    for (const categoria_id of categorias) {
        await db.query(`INSERT INTO produtos_categorias (produto_id, categoria_id, empresa_id) VALUES ($1, $2, $3)`, [id, categoria_id, E.id]);
    }

    if (visivel !== null) {
        await db.query(
            `INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug, titulo, descricao, materiais, cuidados)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)`,
            [id, E.id, visivel, `${chave}-${id}`, titulo, descricao]
        );
    }

    return id;
}

async function venderFinalizada(E, produto_id, quantidade, status = 'finalizada') {
    const venda = await um(`INSERT INTO vendas (empresa_id, canal_id, status, total) VALUES ($1, $2, $3, 1) RETURNING id`, [E.id, E.canalFisico, status]);
    await db.query(
        `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario, local_id)
         VALUES ($1, $2, $3, $4, 1, 1, $5)`,
        [E.id, venda, produto_id, quantidade, E.central]
    );
}

const itens = (res) => res.body.data.itens;
const slugs = (res) => itens(res).map((i) => i.slug);

beforeAll(async () => {
    await criarEmpresa(A, { nome: 'Loja A' });
    await criarEmpresa(B, { nome: 'Loja B' });
    await criarEmpresa(SEM_FLAG, { nome: 'Loja Sem Flag', comLoja: false });
    await criarEmpresa(INATIVA, { nome: 'Loja Inativa', status: 'inativa' });
    await criarEmpresa(DESLIGADA, { nome: 'Loja Desligada' });
    await ligarLoja(DESLIGADA.id, false);

    const anel = await criarCategoria(A, 1, 'ANE', 'Anel');
    const brinco = await criarCategoria(A, 1, 'BRC', 'Brinco');
    const ouro = await criarCategoria(A, 2, 'BO', 'Banhado Ouro');
    const prata = await criarCategoria(A, 2, 'AG', 'Prata 925');

    await criarProduto(A, 'anel-ouro', { nome: 'Anel solitário ouro', preco: 63, saldo: 2, categorias: [anel, ouro], diasDeEntrada: 2, descricao: 'Descrição pública do anel' });
    await criarProduto(A, 'anel-prata', { nome: 'Anel prisma prata', preco: 90, saldo: 50, categorias: [anel, prata], diasDeEntrada: 60 });
    await criarProduto(A, 'brinco-ouro', { nome: 'Brinco gota', titulo: 'Brinco Gota Dourado', preco: 45, saldo: 1, categorias: [brinco, ouro], diasDeEntrada: 1 });
    await criarProduto(A, 'promo-100', { nome: 'Pingente 100% zircônia', preco: 120, saldo: 4, categorias: [], diasDeEntrada: 90 });
    await criarProduto(A, 'so-transito', { nome: 'Colar só em trânsito', preco: 200, saldo: 0, saldoTransito: 5, diasDeEntrada: 90 });
    // Fora da loja por motivos diferentes:
    await criarProduto(A, 'oculto', { nome: 'Peça oculta', visivel: false });
    await criarProduto(A, 'nunca-marcado', { nome: 'Peça nunca marcada', visivel: null });
    await criarProduto(A, 'insumo', { nome: 'Saquinho', tipo: 'insumo' });
    await criarProduto(A, 'inativo', { nome: 'Peça inativa', ativo: false });
    await criarProduto(A, 'sem-preco', { nome: 'Peça sem preço online', semPreco: true });

    await criarProduto(B, 'b-anel', { nome: 'Anel da outra empresa', preco: 10 });
    await criarProduto(SEM_FLAG, 'c-anel', { nome: 'Anel sem flag' });
    await criarProduto(INATIVA, 'd-anel', { nome: 'Anel empresa inativa' });
    await criarProduto(DESLIGADA, 'e-anel', { nome: 'Anel desligado' });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('quem responde: empresa ativa com loja_online ligada', () => {
    test('empresa ligada responde 200', async () => {
        expect((await get(`/loja/${A.slug}/catalogo`)).status).toBe(200);
    });

    test('inexistente, sem a funcionalidade, inativa e desligada respondem o MESMO 404', async () => {
        const respostas = await Promise.all(
            [`nao-existe-${sufixo}`, SEM_FLAG.slug, INATIVA.slug, DESLIGADA.slug, 'Slug Inválido!'].map((s) => get(`/loja/${encodeURIComponent(s)}/catalogo`))
        );

        for (const res of respostas) {
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ success: false, message: 'Loja não encontrada' });
        }
    });

    test('vale para todas as rotas públicas', async () => {
        for (const caminho of ['categorias', 'vitrines', 'produtos/qualquer-1']) {
            expect((await get(`/loja/${SEM_FLAG.slug}/${caminho}`)).status).toBe(404);
        }
    });

    test('slug maiúsculo é aceito (identificador público não diferencia caixa)', async () => {
        expect((await get(`/loja/${A.slug.toUpperCase()}/catalogo`)).status).toBe(200);
    });

    test('é somente leitura: POST/PUT/DELETE não existem', async () => {
        expect((await request(app).post(`/loja/${A.slug}/catalogo`).send({})).status).toBe(404);
        expect((await request(app).delete(`/loja/${A.slug}/catalogo`)).status).toBe(404);
    });
});

describe('o que entra no catálogo', () => {
    test('só produto acabado, ativo, marcado como visível e com preço no canal online', async () => {
        const res = await get(`/loja/${A.slug}/catalogo?limite=48`);

        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(5);
        expect(slugs(res).sort()).toEqual(['anel-ouro', 'anel-prata', 'brinco-ouro', 'promo-100', 'so-transito'].map((k) => `${k}-${A.p[k]}`).sort());
    });

    test('empresas não se enxergam: produto de B não aparece em A nem pelo slug', async () => {
        const res = await get(`/loja/${A.slug}/catalogo?limite=48`);
        expect(JSON.stringify(res.body)).not.toMatch(/outra empresa/i);

        const slugDeB = `b-anel-${B.p['b-anel']}`;
        expect((await get(`/loja/${A.slug}/produtos/${slugDeB}`)).status).toBe(404);
        expect((await get(`/loja/${B.slug}/produtos/${slugDeB}`)).status).toBe(200);
    });

    test('o preço é o do canal online, não o preço base legado nem o de outro canal', async () => {
        await db.query(
            `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual)
             VALUES ($1, $2, $3, 999, 1, 1)`,
            [A.id, A.p['anel-ouro'], A.canalFisico]
        );

        const res = await get(`/loja/${A.slug}/produtos/anel-ouro-${A.p['anel-ouro']}`);
        expect(res.body.data.preco).toBe(63);
    });

    test('preço novo no canal online vale imediatamente (o mais recente)', async () => {
        await db.query(
            `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, criado_em)
             VALUES ($1, $2, $3, 70, 1, 1, NOW() + INTERVAL '1 second')`,
            [A.id, A.p['anel-ouro'], A.canal]
        );

        const res = await get(`/loja/${A.slug}/produtos/anel-ouro-${A.p['anel-ouro']}`);
        expect(res.body.data.preco).toBe(70);

        await db.query(`DELETE FROM precos_produto WHERE produto_id = $1 AND preco_venda = 70`, [A.p['anel-ouro']]);
    });
});

describe('nenhum dado sensível sai na API pública', () => {
    const PROIBIDOS = /custo|margem|markup|fornecedor|empresa_id|estoque_atual|estoque_minimo|saldo|local_id|"id"|produto_id|11\.11|77\.77|123\.45|55\.55/i;

    test('catálogo, produto, categorias e vitrines não trazem campo nem valor sensível', async () => {
        const caminhos = ['catalogo?limite=48', 'categorias', 'vitrines', `produtos/anel-ouro-${A.p['anel-ouro']}`];

        for (const c of caminhos) {
            const res = await get(`/loja/${A.slug}/${c}`);
            expect(res.status).toBe(200);
            expect(JSON.stringify(res.body)).not.toMatch(PROIBIDOS);
            expect(JSON.stringify(res.body)).not.toContain(SEGREDO_INTERNO);
        }
    });

    test('o produto tem exatamente a lista fixa de campos', async () => {
        const res = await get(`/loja/${A.slug}/produtos/anel-ouro-${A.p['anel-ouro']}`);

        expect(Object.keys(res.body.data).sort()).toEqual(
            ['cuidados', 'categorias', 'descricao', 'disponivel', 'imagens', 'materiais', 'nome', 'novidade', 'preco', 'quantidade_disponivel', 'slug'].sort()
        );
        expect(res.body.data.descricao).toBe('Descrição pública do anel');
    });

    test('a descrição interna do cadastro nunca é usada como texto da loja', async () => {
        const res = await get(`/loja/${A.slug}/produtos/anel-prata-${A.p['anel-prata']}`);
        expect(res.body.data.descricao).toBeNull();
    });
});

describe('disponibilidade: só o estoque Central conta', () => {
    test('saldo no Central = disponível; quantidade exibida é limitada a 10', async () => {
        const a = (await get(`/loja/${A.slug}/produtos/anel-ouro-${A.p['anel-ouro']}`)).body.data;
        const grande = (await get(`/loja/${A.slug}/produtos/anel-prata-${A.p['anel-prata']}`)).body.data;

        expect(a).toMatchObject({ disponivel: true, quantidade_disponivel: 2 });
        expect(grande).toMatchObject({ disponivel: true, quantidade_disponivel: 10 });
    });

    test('saldo só em outro local (Em trânsito) não vende', async () => {
        const res = (await get(`/loja/${A.slug}/produtos/so-transito-${A.p['so-transito']}`)).body.data;

        expect(res).toMatchObject({ disponivel: false, quantidade_disponivel: 0 });
    });

    test('filtro disponivel=true esconde o que não tem saldo no Central', async () => {
        const res = await get(`/loja/${A.slug}/catalogo?disponivel=true&limite=48`);

        expect(slugs(res)).not.toContain(`so-transito-${A.p['so-transito']}`);
        expect(res.body.data.total).toBe(4);
    });

    test('estoque que zera aparece na hora como indisponível', async () => {
        await db.query(`UPDATE estoque_locais SET saldo = 0 WHERE produto_id = $1`, [A.p['brinco-ouro']]);

        const res = (await get(`/loja/${A.slug}/produtos/brinco-ouro-${A.p['brinco-ouro']}`)).body.data;
        expect(res.disponivel).toBe(false);

        await db.query(`UPDATE estoque_locais SET saldo = 1 WHERE produto_id = $1`, [A.p['brinco-ouro']]);
    });
});

describe('filtros, busca, ordenação e paginação', () => {
    test('filtra por categoria de nível 1 e 2 (códigos, sem diferenciar caixa)', async () => {
        const aneis = await get(`/loja/${A.slug}/catalogo?n1=ane`);
        expect(slugs(aneis).sort()).toEqual([`anel-ouro-${A.p['anel-ouro']}`, `anel-prata-${A.p['anel-prata']}`].sort());

        const aneisOuro = await get(`/loja/${A.slug}/catalogo?n1=ANE&n2=BO`);
        expect(slugs(aneisOuro)).toEqual([`anel-ouro-${A.p['anel-ouro']}`]);
    });

    test('categoria de outra empresa não filtra nada além do vazio', async () => {
        const res = await get(`/loja/${B.slug}/catalogo?n1=ANE`);
        expect(res.body.data.total).toBe(0);
    });

    test('busca por nome ou título, sem diferenciar caixa e acento do texto digitado', async () => {
        expect(slugs(await get(`/loja/${A.slug}/catalogo?q=solit%C3%A1rio`))).toEqual([`anel-ouro-${A.p['anel-ouro']}`]);
        expect(slugs(await get(`/loja/${A.slug}/catalogo?q=DOURADO`))).toEqual([`brinco-ouro-${A.p['brinco-ouro']}`]);
    });

    test('% e _ na busca são texto literal, não curinga', async () => {
        expect(slugs(await get(`/loja/${A.slug}/catalogo?q=${encodeURIComponent('100%')}`))).toEqual([`promo-100-${A.p['promo-100']}`]);
        expect((await get(`/loja/${A.slug}/catalogo?q=${encodeURIComponent('A_')}`)).body.data.total).toBe(0);
        expect((await get(`/loja/${A.slug}/catalogo?q=${encodeURIComponent("'; DROP TABLE produtos;--")}`)).status).toBe(200);
    });

    test('faixa de preço e ordenação por preço', async () => {
        const faixa = await get(`/loja/${A.slug}/catalogo?preco_min=50&preco_max=100&ordem=preco_desc`);
        expect(itens(faixa).map((i) => i.preco)).toEqual([90, 63]);

        const asc = await get(`/loja/${A.slug}/catalogo?ordem=preco_asc&limite=48`);
        expect(itens(asc).map((i) => i.preco)).toEqual([45, 63, 90, 120, 200]);
    });

    test('paginação devolve total, página e limite', async () => {
        const p1 = await get(`/loja/${A.slug}/catalogo?ordem=preco_asc&limite=2&pagina=1`);
        const p3 = await get(`/loja/${A.slug}/catalogo?ordem=preco_asc&limite=2&pagina=3`);

        expect(p1.body.data).toMatchObject({ total: 5, pagina: 1, limite: 2 });
        expect(itens(p1).map((i) => i.preco)).toEqual([45, 63]);
        expect(itens(p3).map((i) => i.preco)).toEqual([200]);
    });

    test('valor inválido é 400 e nunca chega ao SQL', async () => {
        for (const qs of ['ordem=drop', 'preco_min=abc', 'preco_min=-1', 'preco_min=9&preco_max=1', 'limite=1000', 'limite=0', 'pagina=0', 'q=a', 'n1=ABCD', 'novidades=talvez']) {
            const res = await get(`/loja/${A.slug}/catalogo?${qs}`);
            expect([qs, res.status]).toEqual([qs, 400]);
            expect(res.body.success).toBe(false);
        }
    });

    test('categorias do menu: só as que têm produto visível, com a contagem', async () => {
        const res = await get(`/loja/${A.slug}/categorias`);
        const por = Object.fromEntries(res.body.data.map((c) => [`${c.nivel}:${c.codigo}`, c.quantidade]));

        expect(por).toEqual({ '1:ANE': 2, '1:BRC': 1, '2:AG': 1, '2:BO': 2 });
    });
});

describe('Novidades e Mais vendidos (regras do PO)', () => {
    test('novidade = primeira entrada de estoque nos últimos 30 dias', async () => {
        const res = await get(`/loja/${A.slug}/catalogo?novidades=true&ordem=novidades`);

        expect(slugs(res)).toEqual([`brinco-ouro-${A.p['brinco-ouro']}`, `anel-ouro-${A.p['anel-ouro']}`]);

        const antigo = (await get(`/loja/${A.slug}/produtos/anel-prata-${A.p['anel-prata']}`)).body.data;
        expect(antigo.novidade).toBe(false);
    });

    test('vitrines: novidades preenchidas; mais vendidos vazio enquanto há menos de 4 peças com venda', async () => {
        await venderFinalizada(A, A.p['anel-ouro'], 5);
        await venderFinalizada(A, A.p['anel-prata'], 1);
        await venderFinalizada(A, A.p['brinco-ouro'], 9, 'cancelada');

        const res = await get(`/loja/${A.slug}/vitrines`);

        expect(res.body.data.novidades.map((i) => i.slug)).toEqual([`brinco-ouro-${A.p['brinco-ouro']}`, `anel-ouro-${A.p['anel-ouro']}`]);
        expect(res.body.data.mais_vendidos).toEqual([]);
    });

    test('com 4 ou mais peças vendidas, mais vendidos aparece ordenado por quantidade (cancelada não conta)', async () => {
        await venderFinalizada(A, A.p['promo-100'], 3);
        await venderFinalizada(A, A.p['brinco-ouro'], 2);

        const res = await get(`/loja/${A.slug}/vitrines`);

        expect(res.body.data.mais_vendidos.map((i) => i.slug)).toEqual([
            `anel-ouro-${A.p['anel-ouro']}`,
            `promo-100-${A.p['promo-100']}`,
            `brinco-ouro-${A.p['brinco-ouro']}`,
            `anel-prata-${A.p['anel-prata']}`
        ]);
        // A API ordena por vendas, mas nunca revela quantas foram vendidas.
        expect(JSON.stringify(res.body)).not.toMatch(/"(qtd_vendida|quantidade_vendida|vendidas|vendas|total_vendido)"/i);
    });
});

describe('carrossel de novidades da Home (curadoria por peça)', () => {
    const put = (E, id, corpo) => request(app).put(`/produtos/${id}/loja`).set('Authorization', `Bearer ${E.tokenAdmin}`).send(corpo);
    const carrossel = async () => (await get(`/loja/${A.slug}/vitrines`)).body.data.carrossel.map((i) => i.slug);
    const fotos = [];

    async function addFoto(E, produto_id, n = 1) {
        for (let i = 0; i < n; i += 1) {
            const chave = `teste/${sufixo}/${produto_id}-${i}.jpg`;
            await db.query(
                `INSERT INTO produto_imagens (empresa_id, produto_id, chave, content_type, tamanho_bytes, ordem) VALUES ($1, $2, $3, 'image/jpeg', 10, $4)`,
                [E.id, produto_id, chave, i]
            );
            fotos.push(chave);
        }
    }

    beforeAll(async () => {
        // Só peça com foto entra no carrossel. O brinco (novidade) fica sem foto de propósito.
        await addFoto(A, A.p['anel-ouro'], 2);
        await addFoto(A, A.p['anel-prata']);
        await addFoto(A, A.p['promo-100']);
    });

    afterAll(async () => {
        await db.query('DELETE FROM produto_imagens WHERE chave = ANY($1::text[])', [fotos]);
        await db.query('UPDATE produtos_loja SET carrossel_novidades = false WHERE empresa_id = $1', [A.id]);
    });

    test('nada escolhido: entram automaticamente as novidades que têm foto (sem foto e sem ser novidade ficam de fora)', async () => {
        expect(await carrossel()).toEqual([`anel-ouro-${A.p['anel-ouro']}`]);
    });

    test('com peça escolhida, mostra SÓ as escolhidas (mesmo que não sejam novidade), na ordem da loja', async () => {
        expect((await put(A, A.p['promo-100'], { carrossel_novidades: true })).body.data.carrossel_novidades).toBe(true);
        expect(await carrossel()).toEqual([`promo-100-${A.p['promo-100']}`]);

        await put(A, A.p['anel-prata'], { carrossel_novidades: true, ordem: 0 });
        await put(A, A.p['promo-100'], { ordem: 5 });
        expect(await carrossel()).toEqual([`anel-prata-${A.p['anel-prata']}`, `promo-100-${A.p['promo-100']}`]);
    });

    test('escolhida sem foto, oculta ou sem preço não entra; se sobrar nenhuma, volta ao automático', async () => {
        await db.query('UPDATE produtos_loja SET carrossel_novidades = false WHERE empresa_id = $1', [A.id]);
        await put(A, A.p['brinco-ouro'], { carrossel_novidades: true });
        await put(A, A.p['oculto'], { carrossel_novidades: true });
        await put(A, A.p['sem-preco'], { carrossel_novidades: true });

        expect(await carrossel()).toEqual([`anel-ouro-${A.p['anel-ouro']}`]);
    });

    test('no máximo 6 peças, e o carrossel só traz o formato público (nada interno)', async () => {
        await db.query('UPDATE produtos_loja SET carrossel_novidades = false WHERE empresa_id = $1', [A.id]);
        const ids = [];
        for (let i = 0; i < 7; i += 1) {
            const id = await criarProduto(A, `car-${i}`, { nome: `Peça carrossel ${i}`, preco: 10 + i });
            await addFoto(A, id);
            await db.query('UPDATE produtos_loja SET carrossel_novidades = true, ordem = $2 WHERE produto_id = $1', [id, 100 + i]);
            ids.push(id);
        }

        const res = await get(`/loja/${A.slug}/vitrines`);
        expect(res.body.data.carrossel).toHaveLength(6);
        expect(res.body.data.carrossel.map((i) => i.slug)).toEqual(ids.slice(0, 6).map((id, i) => `car-${i}-${id}`));
        expect(Object.keys(res.body.data.carrossel[0]).sort()).toEqual(
            ['cuidados', 'categorias', 'descricao', 'disponivel', 'imagens', 'materiais', 'nome', 'novidade', 'preco', 'quantidade_disponivel', 'slug'].sort()
        );
        expect(JSON.stringify(res.body)).not.toMatch(/carrossel_novidades/);
    });

    test('uma empresa nunca vê o carrossel da outra', async () => {
        const res = await get(`/loja/${B.slug}/vitrines`);
        expect(res.body.data.carrossel).toEqual([]);
    });

    test('vendedor não escolhe peça para o carrossel (só admin) e valor inválido é 400', async () => {
        const vend = await request(app).put(`/produtos/${A.p['anel-ouro']}/loja`).set('Authorization', `Bearer ${A.tokenVendedor}`).send({ carrossel_novidades: true });
        expect([401, 403]).toContain(vend.status);
        expect((await put(A, A.p['anel-ouro'], { carrossel_novidades: 'sim' })).status).toBe(400);
    });
});

describe('menu de categorias com as variações que existem', () => {
    const menu = async (E = A) => (await get(`/loja/${E.slug}/menu`)).body.data;
    const tipo = (m, codigo) => m.find((t) => t.codigo === codigo);
    const fotos = [];
    let n3;

    const baseAnterior = process.env.R2_PUBLIC_BASE_URL;

    beforeAll(async () => {
        process.env.R2_PUBLIC_BASE_URL = 'https://fotos.exemplo.test';
        n3 = await criarCategoria(A, 3, 'MAS', 'Masculino');
        await db.query(`INSERT INTO produtos_categorias (produto_id, categoria_id, empresa_id) VALUES ($1, $2, $3)`, [A.p['anel-ouro'], n3, A.id]);
        for (const chave of ['anel-ouro', 'anel-prata']) {
            const arq = `teste/${sufixo}/menu-${chave}.jpg`;
            await db.query(`INSERT INTO produto_imagens (empresa_id, produto_id, chave, content_type, tamanho_bytes, ordem) VALUES ($1, $2, $3, 'image/jpeg', 10, 0)`, [A.id, A.p[chave], arq]);
            fotos.push(arq);
        }
    });

    afterAll(async () => {
        if (baseAnterior === undefined) delete process.env.R2_PUBLIC_BASE_URL; else process.env.R2_PUBLIC_BASE_URL = baseAnterior;
        await db.query('DELETE FROM produto_imagens WHERE chave = ANY($1::text[])', [fotos]);
        await db.query('DELETE FROM produtos_categorias WHERE categoria_id = $1', [n3]);
    });

    test('cada tipo traz SÓ as variações que existem nas peças à venda daquele tipo (Brinco não oferece Prata)', async () => {
        const m = await menu();

        expect(m.map((t) => t.codigo)).toEqual(['ANE', 'BRC']);
        expect(tipo(m, 'ANE').n2.map((c) => c.codigo)).toEqual(['BO', 'AG']);
        expect(tipo(m, 'BRC').n2.map((c) => c.codigo)).toEqual(['BO']);
        expect(tipo(m, 'ANE').n3).toEqual([{ codigo: 'MAS', nome: 'Masculino', quantidade: 1 }]);
        expect(tipo(m, 'BRC').n3).toEqual([]);
    });

    test('as quantidades contam peças distintas visíveis à venda (oculta, insumo, inativa e sem preço ficam de fora)', async () => {
        const m = await menu();

        expect(tipo(m, 'ANE')).toMatchObject({ nome: 'Anel', quantidade: 2 });
        expect(tipo(m, 'ANE').n2.find((c) => c.codigo === 'BO').quantidade).toBe(1);
        expect(tipo(m, 'BRC').quantidade).toBe(1);
    });

    test('a peça mais nova com foto de cada tipo (null se nenhuma tem foto), só com dado público', async () => {
        const m = await menu();

        expect(tipo(m, 'ANE').novidade).toMatchObject({ slug: `anel-ouro-${A.p['anel-ouro']}`, nome: 'Anel solitário ouro' });
        expect(tipo(m, 'ANE').novidade.imagem).toContain(`teste/${sufixo}/menu-anel-ouro.jpg`);
        expect(Object.keys(tipo(m, 'ANE').novidade).sort()).toEqual(['imagem', 'nome', 'slug']);
        expect(tipo(m, 'BRC').novidade).toBeNull();
        expect(JSON.stringify(m)).not.toMatch(/custo|margem|fornecedor|empresa_id|preco/i);
    });

    test('uma empresa nunca vê o menu da outra; loja sem a funcionalidade é 404', async () => {
        expect(await menu(B)).toEqual([]);
        expect((await get(`/loja/${SEM_FLAG.slug}/menu`)).status).toBe(404);
        expect((await get('/loja/nao-existe/menu')).status).toBe(404);
    });
});

describe('destaque da Home (a peça do momento, escolhida pela loja)', () => {
    const put = (E, id, corpo) => request(app).put(`/produtos/${id}/loja`).set('Authorization', `Bearer ${E.tokenAdmin}`).send(corpo);
    const destaque = async () => (await get(`/loja/${A.slug}/vitrines`)).body.data.destaque;
    const fotos = [];

    beforeAll(async () => {
        for (const chave of ['anel-ouro', 'anel-prata']) {
            const arq = `teste/${sufixo}/destaque-${chave}.jpg`;
            await db.query(
                `INSERT INTO produto_imagens (empresa_id, produto_id, chave, content_type, tamanho_bytes, ordem) VALUES ($1, $2, $3, 'image/jpeg', 10, 0)`,
                [A.id, A.p[chave], arq]
            );
            fotos.push(arq);
        }
    });

    afterAll(async () => {
        await db.query('DELETE FROM produto_imagens WHERE chave = ANY($1::text[])', [fotos]);
        await db.query('UPDATE produtos_loja SET destaque_home = false WHERE empresa_id = $1', [A.id]);
    });

    test('nada escolhido: o destaque é null (a Home usa a peça automática de sempre)', async () => {
        expect(await destaque()).toBeNull();
    });

    test('escolher uma peça a põe no destaque, com o mesmo formato público (nada interno)', async () => {
        const res = await put(A, A.p['anel-ouro'], { destaque_home: true });
        expect(res.status).toBe(200);
        expect(res.body.data.destaque_home).toBe(true);

        const d = await destaque();
        expect(d.slug).toBe(`anel-ouro-${A.p['anel-ouro']}`);
        expect(Object.keys(d).sort()).toEqual(['cuidados', 'categorias', 'descricao', 'disponivel', 'imagens', 'materiais', 'nome', 'novidade', 'preco', 'quantidade_disponivel', 'slug'].sort());
        expect(JSON.stringify(await destaque())).not.toMatch(/destaque_home/);
    });

    test('só UMA peça é o destaque: escolher outra tira a anterior', async () => {
        await put(A, A.p['anel-prata'], { destaque_home: true });

        expect((await destaque()).slug).toBe(`anel-prata-${A.p['anel-prata']}`);
        const { rows } = await db.query('SELECT produto_id FROM produtos_loja WHERE empresa_id = $1 AND destaque_home', [A.id]);
        expect(rows.map((r) => r.produto_id)).toEqual([A.p['anel-prata']]);
    });

    test('tirar o destaque volta ao null; peça sem foto, despublicada ou sem preço não aparece', async () => {
        await put(A, A.p['anel-prata'], { destaque_home: false });
        expect(await destaque()).toBeNull();

        await put(A, A.p['brinco-ouro'], { destaque_home: true }); // sem foto de propósito
        expect(await destaque()).toBeNull();
    });

    test('despublicar a peça tira o destaque dela; só peça publicada pode ser destaque (409)', async () => {
        await put(A, A.p['anel-ouro'], { destaque_home: true });
        await put(A, A.p['anel-ouro'], { visivel: false });
        expect(await destaque()).toBeNull();
        expect((await db.query('SELECT destaque_home FROM produtos_loja WHERE produto_id = $1', [A.p['anel-ouro']])).rows[0].destaque_home).toBe(false);
        await put(A, A.p['anel-ouro'], { visivel: true });
        expect(await destaque()).toBeNull();

        const nao = await put(A, A.p['oculto'], { destaque_home: true });
        expect(nao.status).toBe(409);
    });

    test('o banco também garante no máximo um destaque por empresa (índice único)', async () => {
        await put(A, A.p['anel-prata'], { destaque_home: true });
        await expect(db.query('UPDATE produtos_loja SET destaque_home = true WHERE produto_id = $1', [A.p['anel-ouro']])).rejects.toThrow();
    });

    test('valor inválido é 400; uma empresa nunca vê o destaque da outra', async () => {
        expect((await put(A, A.p['anel-ouro'], { destaque_home: 'sim' })).status).toBe(400);
        expect((await get(`/loja/${B.slug}/vitrines`)).body.data.destaque).toBeNull();
    });
});

describe('gestão da marcação do produto (autenticada)', () => {
    const put = (E, id, corpo, token = E.tokenAdmin) => request(app).put(`/produtos/${id}/loja`).set('Authorization', `Bearer ${token}`).send(corpo);
    const getM = (E, id, token = E.tokenAdmin) => request(app).get(`/produtos/${id}/loja`).set('Authorization', `Bearer ${token}`);

    test('sem a funcionalidade ligada a rota responde 403 de plano', async () => {
        const res = await put(SEM_FLAG, SEM_FLAG.p['c-anel'], { visivel: true });

        expect(res.status).toBe(403);
        expect(res.body.message).toBe(MENSAGEM);
    });

    test('vendedor não marca produto (só admin)', async () => {
        expect((await put(A, A.p['oculto'], { visivel: true }, A.tokenVendedor)).status).toBe(403);
        expect((await getM(A, A.p['oculto'], A.tokenVendedor)).status).toBe(403);
    });

    test('sem token responde 401', async () => {
        expect((await request(app).put(`/produtos/${A.p['oculto']}/loja`).send({ visivel: true })).status).toBe(401);
    });

    test('produto sem marcação devolve o padrão (não visível), sem inventar texto', async () => {
        const res = await getM(A, A.p['nunca-marcado']);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ visivel: false, slug: null, materiais: null, cuidados: null });
    });

    test('o admin recebe também o cadastro (nome, descrição e material = categorias de nível 2) para pré-preencher o formulário', async () => {
        const res = await getM(A, A.p['anel-ouro']);

        expect(res.status).toBe(200);
        expect(res.body.data.cadastro).toEqual({ nome: 'Anel solitário ouro', descricao: SEGREDO_INTERNO, material: 'Banhado Ouro' });
    });

    test('produto sem descrição nem material no cadastro: cadastro com null, sem inventar', async () => {
        const res = await getM(A, A.p['nunca-marcado']);

        expect(res.body.data.cadastro.material).toBeNull();
        expect(typeof res.body.data.cadastro.nome).toBe('string');
    });

    test('a API pública nunca lê o cadastro ao vivo: só mostra o que está na marcação da loja', async () => {
        const publico = JSON.stringify((await get(`/loja/${A.slug}/produtos/anel-ouro-${A.p['anel-ouro']}`)).body);

        expect(publico).toContain('Descrição pública do anel');
        expect(publico).not.toContain(SEGREDO_INTERNO);
        expect(publico).not.toContain('cadastro');
    });

    describe('copiar do cadastro para a loja', () => {
        const comMaterial = async (chave, nome, material) => {
            const cat = await criarCategoria(A, 2, `X${crypto.randomBytes(3).toString('hex').toUpperCase()}`, material);
            return criarProduto(A, chave, { nome, visivel: null, categorias: [cat], saldo: 1 });
        };

        test('ao publicar, copia a descrição e o material do cadastro que ainda estão vazios, e a loja pública já mostra', async () => {
            const id = await comMaterial('copia-pub', 'Peça Cópia', 'Aço Teste');
            const res = await put(A, id, { visivel: true });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ visivel: true, descricao: SEGREDO_INTERNO, materiais: 'Aço Teste', titulo: null });

            const vitrine = await get(`/loja/${A.slug}/produtos/peca-copia-${id}`);
            expect(vitrine.body.data).toMatchObject({ descricao: SEGREDO_INTERNO, materiais: 'Aço Teste' });
        });

        test('é uma cópia no ato da publicação: mudar o cadastro depois não muda a loja, e republicar não sobrescreve', async () => {
            const id = await comMaterial('copia-fixa', 'Peça Cópia Fixa', 'Latão Teste');
            await put(A, id, { visivel: true });
            await db.query(`UPDATE produtos SET descricao = 'Texto novo do cadastro' WHERE id = $1`, [id]);

            expect((await getM(A, id)).body.data).toMatchObject({ descricao: SEGREDO_INTERNO });

            await put(A, id, { descricao: 'Editado na loja' });
            await put(A, id, { visivel: false });
            const de_novo = await put(A, id, { visivel: true });

            expect(de_novo.body.data.descricao).toBe('Editado na loja');
        });

        test('nunca troca o que a pessoa já escreveu nem o que vem explícito na própria publicação', async () => {
            const id = await comMaterial('copia-explicita', 'Peça Explícita', 'Zinco Teste');
            const res = await put(A, id, { visivel: true, descricao: 'Texto próprio', materiais: '' });

            expect(res.body.data).toMatchObject({ descricao: 'Texto próprio', materiais: null });
        });

        test('produto sem descrição e sem material no cadastro: nada é inventado', async () => {
            const id = await criarProduto(A, 'copia-vazia', { nome: 'Peça Sem Cadastro', visivel: null, saldo: 1 });
            await db.query(`UPDATE produtos SET descricao = NULL WHERE id = $1`, [id]);
            const res = await put(A, id, { visivel: true });

            expect(res.body.data).toMatchObject({ descricao: null, materiais: null });
        });

        describe('em lote (POST /loja-produtos/preencher-do-cadastro)', () => {
            const lote = (E, papel = 'admin') => request(app).post('/loja-produtos/preencher-do-cadastro').set('Authorization', `Bearer ${papel === 'admin' ? E.tokenAdmin : E.tokenVendedor}`);
            const linha = async (id) => (await db.query('SELECT descricao, materiais FROM produtos_loja WHERE produto_id = $1', [id])).rows[0];

            test('preenche só o que está vazio nas peças marcadas; não troca texto, não toca peça fora da loja nem de outra empresa', async () => {
                const vazia = await comMaterial('lote-vazia', 'Peça Lote Vazia', 'Cobre Teste');
                const propria = await comMaterial('lote-propria', 'Peça Lote Própria', 'Níquel Teste');
                const fora = await comMaterial('lote-fora', 'Peça Lote Fora', 'Ferro Teste');
                await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug, descricao, materiais) VALUES ($1, $2, true, $3, NULL, NULL)`, [vazia, A.id, `lote-vazia-${vazia}`]);
                await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug, descricao, materiais) VALUES ($1, $2, true, $3, 'Meu texto', 'Meu material')`, [propria, A.id, `lote-propria-${propria}`]);
                await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug, descricao, materiais) VALUES ($1, $2, false, $3, NULL, NULL)`, [fora, A.id, `lote-fora-${fora}`]);
                const antesB = (await linha(B.p['b-anel'])) ?? null;

                const res = await lote(A);

                expect(res.status).toBe(200);
                expect(res.body.data.atualizados).toBeGreaterThanOrEqual(1);
                expect(await linha(vazia)).toEqual({ descricao: SEGREDO_INTERNO, materiais: 'Cobre Teste' });
                expect(await linha(propria)).toEqual({ descricao: 'Meu texto', materiais: 'Meu material' });
                expect(await linha(fora)).toEqual({ descricao: null, materiais: null });
                expect(await linha(B.p['b-anel'])).toEqual(antesB);
            });

            test('rodar de novo não muda mais nada (0 atualizados)', async () => {
                expect((await lote(A)).body.data.atualizados).toBe(0);
            });

            test('só admin, só com a funcionalidade, e sem token é 401', async () => {
                expect((await lote(A, 'vendedor')).status).toBe(403);
                expect((await request(app).post('/loja-produtos/preencher-do-cadastro')).status).toBe(401);
                expect((await request(app).post('/loja-produtos/preencher-do-cadastro').set('Authorization', `Bearer ${SEM_FLAG.tokenAdmin}`)).status).toBe(403);
            });
        });
    });

    test('publica: cria a marcação, gera slug estável e entra no catálogo; renomear não muda o slug', async () => {
        const id = A.p['nunca-marcado'];
        const publicado = await put(A, id, { visivel: true, titulo: '  Peça Linda  ', materiais: 'Banhado a ouro 18k', cuidados: '' });

        expect(publicado.status).toBe(200);
        expect(publicado.body.data).toMatchObject({ visivel: true, slug: `peca-nunca-marcada-${id}`, titulo: 'Peça Linda', materiais: 'Banhado a ouro 18k', cuidados: null });
        expect(publicado.body.data.publicado_em).not.toBeNull();

        const vitrine = await get(`/loja/${A.slug}/produtos/peca-nunca-marcada-${id}`);
        expect(vitrine.status).toBe(200);
        expect(vitrine.body.data).toMatchObject({ nome: 'Peça Linda', materiais: 'Banhado a ouro 18k' });

        await db.query(`UPDATE produtos SET nome = 'Nome totalmente novo' WHERE id = $1`, [id]);
        const de_novo = await put(A, id, { ordem: 3 });

        expect(de_novo.body.data.slug).toBe(`peca-nunca-marcada-${id}`);
        expect(de_novo.body.data).toMatchObject({ ordem: 3, titulo: 'Peça Linda', visivel: true });
        expect(de_novo.body.data.publicado_em).toBe(publicado.body.data.publicado_em);
    });

    test('despublicar tira da loja na hora e mantém o texto', async () => {
        const id = A.p['nunca-marcado'];
        const res = await put(A, id, { visivel: false });

        expect(res.body.data).toMatchObject({ visivel: false, titulo: 'Peça Linda' });
        expect((await get(`/loja/${A.slug}/produtos/peca-nunca-marcada-${id}`)).status).toBe(404);
    });

    test('insumo e produto inativo não podem ser publicados (409)', async () => {
        for (const chave of ['insumo', 'inativo']) {
            const res = await put(A, A.p[chave], { visivel: true });
            expect([chave, res.status]).toEqual([chave, 409]);
        }
    });

    test('produto de outra empresa é 404 (nunca altera dado alheio)', async () => {
        expect((await put(A, B.p['b-anel'], { visivel: false })).status).toBe(404);
        expect((await getM(A, B.p['b-anel'])).status).toBe(404);

        const { rows } = await db.query('SELECT visivel FROM produtos_loja WHERE produto_id = $1', [B.p['b-anel']]);
        expect(rows[0].visivel).toBe(true);
    });

    test('corpo estrito: preço, estoque e campo desconhecido são 400; id inválido é 400', async () => {
        for (const corpo of [{ preco: 1 }, { estoque: 9 }, { visivel: 'sim' }, { ordem: -1 }, { titulo: 'x'.repeat(161) }]) {
            const res = await put(A, A.p['oculto'], corpo);
            expect([JSON.stringify(corpo), res.status]).toEqual([JSON.stringify(corpo), 400]);
        }

        expect((await put(A, 'abc', { visivel: true })).status).toBe(400);
    });

    test('dois pedidos simultâneos para o mesmo produto não duplicam a marcação nem quebram', async () => {
        const id = A.p['oculto'];
        const [r1, r2] = await Promise.all([put(A, id, { visivel: true }), put(A, id, { visivel: true })]);

        expect([r1.status, r2.status]).toEqual([200, 200]);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM produtos_loja WHERE produto_id = $1', [id])).rows[0].n).toBe(1);
    });
});

describe('funcionalidade desligada derruba a loja inteira na hora', () => {
    test('desligar a funcionalidade passa a responder 404 mesmo com produtos marcados', async () => {
        expect((await get(`/loja/${A.slug}/catalogo`)).status).toBe(200);

        await ligarLoja(A.id, false);
        expect((await get(`/loja/${A.slug}/catalogo`)).status).toBe(404);

        await ligarLoja(A.id, true);
        expect((await get(`/loja/${A.slug}/catalogo`)).status).toBe(200);
    });

    // A loja decide "hoje" pela data de Brasília; o teste usa a mesma (CURRENT_DATE do banco é UTC e diverge entre 00h e 03h UTC).
    test('ligação com vigência vencida não vale', async () => {
        await db.query(
            `UPDATE empresa_funcionalidades SET vigencia_inicio = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 10, vigencia_fim = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1
              WHERE empresa_id = $1 AND funcionalidade = 'loja_online'`,
            [A.id]
        );
        expect((await get(`/loja/${A.slug}/catalogo`)).status).toBe(404);

        await db.query(`UPDATE empresa_funcionalidades SET vigencia_inicio = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date, vigencia_fim = NULL WHERE empresa_id = $1 AND funcionalidade = 'loja_online'`, [A.id]);
        expect((await get(`/loja/${A.slug}/catalogo`)).status).toBe(200);
    });
});

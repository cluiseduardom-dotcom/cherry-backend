// Integração (Postgres de testes): preparo fiscal — dados da empresa, NCM/origem dos produtos e prontidão.
// Só cadastro (nenhuma nota é emitida). Formato validado, isolamento entre empresas, flag `fiscal_cadastro` e RBAC.
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
const C = { u: {}, p: {} }; // sem a funcionalidade fiscal_cadastro

async function criarEmpresa(alvo, rotulo, { fiscal, uf = 'SP' }) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status, uf) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste Fiscal ${rotulo} ${sufixo}`, uf]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'estoquista', 'vendedor']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
    if (fiscal) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'fiscal_cadastro', true, 'teste', 'teste')`,
            [alvo.empresaId]
        );
    }
}

async function criarProduto(alvo, chave, { tipo = 'acabado', ativo = true, ncm = null, origem = null } = {}) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, tipo, ativo, ncm, origem_mercadoria) VALUES ($1, $2, $3, 1, 1, 0, $4, $5, $6, $7) RETURNING id`,
        [alvo.empresaId, `FIS-${chave}-${alvo.empresaId}-${sufixo}`, `Produto ${chave}`, tipo, ativo, ncm, origem]
    );
    alvo.p[chave] = rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const enviar = (metodo) => (alvo, papel, url, corpo) => request(app)[metodo](url).set(como(alvo, papel)).send(corpo);
const put = enviar('put');
const patch = enviar('patch');
const post = enviar('post');

beforeAll(async () => {
    await criarEmpresa(A, 'A', { fiscal: true });
    await criarEmpresa(B, 'B', { fiscal: true });
    await criarEmpresa(C, 'C', { fiscal: false });
    for (const k of ['anel', 'colar', 'brinco', 'pulseira']) await criarProduto(A, k);
    await criarProduto(A, 'embalagem', { tipo: 'insumo' }); // insumo não é vendido: fora do fiscal
    await criarProduto(A, 'antigo', { ativo: false }); // inativo: fora da prontidão
    await criarProduto(B, 'outro');
    await criarProduto(C, 'c1');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET/PUT /fiscal/empresa', () => {
    test('começa vazio, trazendo o que já está no cadastro da empresa', async () => {
        const res = await get(A, 'admin', '/fiscal/empresa');

        expect(res.status).toBe(200);
        expect(res.body.data.empresa).toMatchObject({ uf: 'SP', cnpj: null });
        expect(res.body.data.fiscal).toEqual({
            regime_tributario: null, inscricao_estadual: null, inscricao_municipal: null, cnae_principal: null, codigo_municipio_ibge: null, ambiente: 'homologacao'
        });
    });

    test('grava os dados fiscais (normalizando máscara) e relê; PUT parcial preserva o resto; null limpa', async () => {
        const res = await put(A, 'admin', '/fiscal/empresa', {
            regime_tributario: 'simples_nacional', inscricao_estadual: '123.456.789.110', inscricao_municipal: 'IM-123', cnae_principal: '4781-4/00', codigo_municipio_ibge: '3550308'
        });

        expect(res.status).toBe(200);
        expect(res.body.data.fiscal).toMatchObject({
            regime_tributario: 'simples_nacional', inscricao_estadual: '123456789110', inscricao_municipal: 'IM-123', cnae_principal: '4781400', codigo_municipio_ibge: '3550308', ambiente: 'homologacao'
        });

        const parcial = await put(A, 'admin', '/fiscal/empresa', { ambiente: 'producao' });

        expect(parcial.body.data.fiscal).toMatchObject({ ambiente: 'producao', regime_tributario: 'simples_nacional', cnae_principal: '4781400' });

        const limpo = await put(A, 'admin', '/fiscal/empresa', { inscricao_municipal: null });

        expect(limpo.body.data.fiscal.inscricao_municipal).toBeNull();
        expect((await get(A, 'admin', '/fiscal/empresa')).body.data.fiscal.regime_tributario).toBe('simples_nacional');
    });

    test('inscrição estadual aceita ISENTO (em qualquer caixa)', async () => {
        const res = await put(A, 'admin', '/fiscal/empresa', { inscricao_estadual: 'isento' });

        expect(res.body.data.fiscal.inscricao_estadual).toBe('ISENTO');
    });

    test('valores inválidos = 400: regime, IE, CNAE, IBGE, ambiente, campo desconhecido e corpo vazio', async () => {
        const invalidos = [
            { regime_tributario: 'lucro_arbitrado' },
            { inscricao_estadual: '1' },
            { inscricao_estadual: '12A456' },
            { cnae_principal: '12345' },
            { codigo_municipio_ibge: '35503' },
            { ambiente: 'teste' },
            { empresa_id: B.empresaId },
            { cnpj: '11222333000181' },
            { ncm: '71171900' },
            {}
        ];

        for (const corpo of invalidos) expect((await put(A, 'admin', '/fiscal/empresa', corpo)).status).toBe(400);
    });

    test('município de outro estado = 400 (a empresa é de SP e o código é do RJ)', async () => {
        const res = await put(A, 'admin', '/fiscal/empresa', { codigo_municipio_ibge: '3304557' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/UF/);
        expect((await get(A, 'admin', '/fiscal/empresa')).body.data.fiscal.codigo_municipio_ibge).toBe('3550308');
    });

    test('só admin; sem a funcionalidade 403; sem token 401; uma empresa não enxerga a outra', async () => {
        for (const papel of ['estoquista', 'vendedor']) {
            expect((await get(A, papel, '/fiscal/empresa')).status).toBe(403);
            expect((await put(A, papel, '/fiscal/empresa', { ambiente: 'producao' })).status).toBe(403);
        }
        expect((await get(C, 'admin', '/fiscal/empresa')).status).toBe(403);
        expect((await request(app).get('/fiscal/empresa')).status).toBe(401);
        expect((await get(B, 'admin', '/fiscal/empresa')).body.data.fiscal.regime_tributario).toBeNull();
    });
});

describe('produtos: PATCH /fiscal/produtos/:id e GET /fiscal/produtos', () => {
    test('grava NCM, CEST, origem e unidade fiscal; limpa com null', async () => {
        const res = await patch(A, 'estoquista', `/fiscal/produtos/${A.p.anel}`, { ncm: '71171900', cest: '2800300', origem_mercadoria: 0, unidade_fiscal: 'UN' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: A.p.anel, ncm: '71171900', cest: '2800300', origem_mercadoria: 0, unidade_fiscal: 'UN' });

        const limpo = await patch(A, 'admin', `/fiscal/produtos/${A.p.anel}`, { cest: null });

        expect(limpo.body.data).toMatchObject({ ncm: '71171900', cest: null, origem_mercadoria: 0 });
    });

    test('aceita a máscara do NCM e do CEST e grava só os dígitos', async () => {
        const res = await patch(A, 'admin', `/fiscal/produtos/${A.p.colar}`, { ncm: '7117.19.00', cest: '28.003.00' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ ncm: '71171900', cest: '2800300' });
        // a unidade fiscal também é normalizada para maiúsculas
        expect((await patch(A, 'admin', `/fiscal/produtos/${A.p.colar}`, { unidade_fiscal: 'kg' })).body.data.unidade_fiscal).toBe('KG');
        await patch(A, 'admin', `/fiscal/produtos/${A.p.colar}`, { ncm: null, cest: null, unidade_fiscal: null });
    });

    test('formato inválido = 400 (NCM do capítulo 77, CEST curto, origem 9, unidade longa ou com número, campo estranho, vazio)', async () => {
        const invalidos = [
            { ncm: '77010000' }, { ncm: '1234567' }, { cest: '28003' }, { origem_mercadoria: 9 }, { origem_mercadoria: 1.5 },
            { unidade_fiscal: 'UNIDADEX' }, { unidade_fiscal: 'U1' }, { preco_venda: 10 }, { empresa_id: B.empresaId }, {}
        ];

        for (const corpo of invalidos) expect((await patch(A, 'admin', `/fiscal/produtos/${A.p.colar}`, corpo)).status).toBe(400);
    });

    test('produto de outra empresa ou inexistente = 404; vendedor 403; sem a funcionalidade 403', async () => {
        expect((await patch(A, 'admin', `/fiscal/produtos/${B.p.outro}`, { ncm: '71171900' })).status).toBe(404);
        expect((await patch(A, 'admin', '/fiscal/produtos/99999999', { ncm: '71171900' })).status).toBe(404);
        expect((await patch(A, 'admin', '/fiscal/produtos/abc', { ncm: '71171900' })).status).toBe(400);
        expect((await patch(A, 'vendedor', `/fiscal/produtos/${A.p.colar}`, { ncm: '71171900' })).status).toBe(403);
        expect((await patch(C, 'admin', `/fiscal/produtos/${C.p.c1}`, { ncm: '71171900' })).status).toBe(403);
        const { rows } = await db.query('SELECT ncm FROM produtos WHERE id = $1', [B.p.outro]);

        expect(rows[0].ncm).toBeNull();
    });

    test('lista só produto vendido (acabado); "pendentes" = sem NCM ou sem origem; busca por nome ou SKU', async () => {
        await patch(A, 'admin', `/fiscal/produtos/${A.p.colar}`, { ncm: '71171900' }); // NCM sem origem: continua pendente
        const pendentes = await get(A, 'estoquista', '/fiscal/produtos?filtro=pendentes&pageSize=100');

        expect(pendentes.status).toBe(200);
        const nomes = pendentes.body.data.items.map((p) => p.nome);

        expect(nomes).toEqual(expect.arrayContaining(['Produto colar', 'Produto brinco', 'Produto pulseira']));
        expect(nomes).not.toContain('Produto anel'); // completo
        expect(nomes).not.toContain('Produto embalagem'); // insumo
        expect(nomes).not.toContain('Produto outro'); // outra empresa
        const todos = await get(A, 'admin', '/fiscal/produtos?filtro=todos&pageSize=100');

        expect(todos.body.data.items.map((p) => p.nome)).toContain('Produto anel');
        expect(Object.keys(todos.body.data.items[0])).toEqual(expect.arrayContaining(['id', 'sku', 'nome', 'unidade', 'ncm', 'cest', 'origem_mercadoria', 'unidade_fiscal']));
        const busca = await get(A, 'admin', '/fiscal/produtos?filtro=todos&q=pulseira');

        expect(busca.body.data.items.map((p) => p.nome)).toEqual(['Produto pulseira']);
        expect((await get(A, 'admin', '/fiscal/produtos?filtro=outro')).status).toBe(400);
        expect((await get(A, 'vendedor', '/fiscal/produtos')).status).toBe(403);
    });
});

describe('POST /fiscal/produtos/lote', () => {
    test('aplica os mesmos dados a vários produtos de uma vez', async () => {
        const ids = [A.p.brinco, A.p.pulseira];
        const res = await post(A, 'estoquista', '/fiscal/produtos/lote', { produto_ids: ids, ncm: '71171900', origem_mercadoria: 0 });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ atualizados: 2 });
        const { rows } = await db.query('SELECT ncm, origem_mercadoria FROM produtos WHERE id = ANY($1::int[])', [ids]);

        expect(rows).toEqual([{ ncm: '71171900', origem_mercadoria: 0 }, { ncm: '71171900', origem_mercadoria: 0 }]);
    });

    test('um id de outra empresa = 404 e NADA é aplicado', async () => {
        const antes = (await db.query('SELECT unidade_fiscal FROM produtos WHERE id = $1', [A.p.colar])).rows[0].unidade_fiscal;
        const res = await post(A, 'admin', '/fiscal/produtos/lote', { produto_ids: [A.p.colar, B.p.outro], unidade_fiscal: 'KG' });

        expect(res.status).toBe(404);
        expect((await db.query('SELECT unidade_fiscal FROM produtos WHERE id = $1', [A.p.colar])).rows[0].unidade_fiscal).toBe(antes);
        expect((await db.query('SELECT unidade_fiscal FROM produtos WHERE id = $1', [B.p.outro])).rows[0].unidade_fiscal).toBeNull();
    });

    test('entrada inválida = 400: sem ids, mais de 200, sem campo, campo ruim, id repetido', async () => {
        const ids = [A.p.colar];

        for (const corpo of [
            { ncm: '71171900' }, { produto_ids: [], ncm: '71171900' }, { produto_ids: Array.from({ length: 201 }, (_, i) => i + 1), ncm: '71171900' },
            { produto_ids: ids }, { produto_ids: ids, ncm: '123' }, { produto_ids: [A.p.colar, A.p.colar], ncm: '71171900' }, { produto_ids: ['x'], ncm: '71171900' }
        ]) {
            expect((await post(A, 'admin', '/fiscal/produtos/lote', corpo)).status).toBe(400);
        }
        expect((await post(A, 'vendedor', '/fiscal/produtos/lote', { produto_ids: ids, ncm: '71171900' })).status).toBe(403);
        expect((await post(C, 'admin', '/fiscal/produtos/lote', { produto_ids: [C.p.c1], ncm: '71171900' })).status).toBe(403);
    });
});

describe('GET /fiscal/prontidao', () => {
    const item = (res, grupo, id) => res.body.data.grupos.find((g) => g.id === grupo).itens.find((i) => i.id === id);

    test('mostra o que falta e continua "não pronto" enquanto faltar o obrigatório', async () => {
        const res = await get(A, 'admin', '/fiscal/prontidao');

        expect(res.status).toBe(200);
        expect(res.body.data.pronto).toBe(false);
        expect(item(res, 'empresa', 'cnpj')).toMatchObject({ ok: false, obrigatorio: true });
        expect(item(res, 'empresa', 'regime_tributario')).toMatchObject({ ok: true });
        expect(item(res, 'empresa', 'inscricao_estadual')).toMatchObject({ ok: true });
        expect(item(res, 'empresa', 'codigo_municipio_ibge')).toMatchObject({ ok: true });
        expect(item(res, 'empresa', 'endereco')).toMatchObject({ ok: false });
        expect(item(res, 'empresa', 'cnae_principal')).toMatchObject({ ok: true, obrigatorio: false });
        // produtos: 4 vendidos e ativos (anel, colar, brinco, pulseira); insumo e inativo ficam de fora.
        // Todos têm NCM; só o colar está sem origem.
        expect(item(res, 'produtos', 'ncm')).toMatchObject({ ok: true, total: 4, preenchidos: 4, faltando: 0 });
        expect(item(res, 'produtos', 'origem_mercadoria')).toMatchObject({ ok: false, total: 4, preenchidos: 3, faltando: 1 });
        expect(res.body.data.produtos_pendentes).toEqual([expect.objectContaining({ nome: 'Produto colar', falta: ['origem_mercadoria'] })]);
        expect(Array.isArray(res.body.data.avisos)).toBe(true);
        expect(res.body.data.avisos.join(' ')).toMatch(/contador/i);
    });

    test('CNPJ inválido não conta; CNPJ alfanumérico válido conta; endereço completo conta', async () => {
        await db.query(`UPDATE empresas SET cnpj = '11222333000182' WHERE id = $1`, [A.empresaId]);
        expect(item(await get(A, 'admin', '/fiscal/prontidao'), 'empresa', 'cnpj').ok).toBe(false);

        await db.query(
            `UPDATE empresas SET cnpj = '12ABC34501DE35', razao_social = 'Joias Teste LTDA', cep = '01001000', logradouro = 'Praça da Sé', numero = '1', bairro = 'Sé', cidade = 'São Paulo', uf = 'SP' WHERE id = $1`,
            [A.empresaId]
        );
        const res = await get(A, 'admin', '/fiscal/prontidao');

        expect(item(res, 'empresa', 'cnpj').ok).toBe(true);
        expect(item(res, 'empresa', 'razao_social').ok).toBe(true);
        expect(item(res, 'empresa', 'endereco').ok).toBe(true);
    });

    test('com tudo preenchido, fica pronto; produto novo sem NCM tira o "pronto"', async () => {
        await patch(A, 'admin', `/fiscal/produtos/${A.p.colar}`, { ncm: '71171900', origem_mercadoria: 0 });
        const pronto = await get(A, 'admin', '/fiscal/prontidao');

        expect(pronto.body.data.pronto).toBe(true);
        expect(pronto.body.data.produtos_pendentes).toEqual([]);

        await criarProduto(A, 'novo');
        const depois = await get(A, 'admin', '/fiscal/prontidao');

        expect(depois.body.data.pronto).toBe(false);
        expect(item(depois, 'produtos', 'ncm')).toMatchObject({ total: 5, faltando: 1 });
    });

    test('isolamento e permissões: empresa B vê só o dela; estoquista e vendedor não acessam; sem flag 403', async () => {
        const b = await get(B, 'admin', '/fiscal/prontidao');

        expect(b.body.data.pronto).toBe(false);
        expect(item(b, 'produtos', 'ncm')).toMatchObject({ total: 1, preenchidos: 0 });
        expect((await get(A, 'estoquista', '/fiscal/prontidao')).status).toBe(403);
        expect((await get(A, 'vendedor', '/fiscal/prontidao')).status).toBe(403);
        expect((await get(C, 'admin', '/fiscal/prontidao')).status).toBe(403);
    });
});

// Integração (Postgres de testes): grade de produtos. Cada variação é um produto normal ligado a uma grade;
// SKU pelas categorias, estoque e preço próprios; nome único; combinação sem repetição; isolamento e flag `grade`.
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

const A = { u: {}, c: {} };
const B = { u: {}, c: {} };
const C = { u: {}, c: {} }; // sem a funcionalidade grade

async function criarEmpresa(alvo, rotulo, { grade }) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Grade ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'estoquista', 'vendedor']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
    await db.query(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'loja_fisica')`, [alvo.empresaId]);
    if (grade) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'grade', true, 'teste', 'teste')`,
            [alvo.empresaId]
        );
    }

    // Categorias e padrão de SKU de produto: nível 1 = Tipo (obrigatório), nível 2 = Tamanho (opcional).
    const { rows: [cfg] } = await db.query(
        `INSERT INTO configuracoes_sku (empresa_id, nome, tipo_sku, separador, prefixo, sufixo, tamanho_sequencia, inicio_sequencia, ativo, padrao, escopo)
         VALUES ($1, 'Padrão', 'numerico', '-', '', '', 3, 1, true, true, 'produto') RETURNING id`,
        [alvo.empresaId]
    );
    await db.query(
        `INSERT INTO configuracoes_sku_segmentos (configuracao_id, nivel, ordem, nome, obrigatorio, participa_sku)
         VALUES ($1, 1, 1, 'Tipo', true, true), ($1, 2, 2, 'Tamanho', false, true)`,
        [cfg.id]
    );
    for (const [nivel, codigo, nome] of [[1, 'CAM', 'Camisetas'], [1, 'CAL', 'Calças'], [2, 'P', 'P'], [2, 'M', 'M'], [2, 'G', 'G']]) {
        const { rows: [c] } = await db.query(
            `INSERT INTO categorias_produto (empresa_id, nivel, codigo, nome, configuracao_sku_id, escopo) VALUES ($1, $2, $3, $4, $5, 'produto') RETURNING id`,
            [alvo.empresaId, nivel, codigo, nome, cfg.id]
        );
        alvo.c[codigo] = c.id;
    }
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const post = (alvo, papel, url, corpo) => request(app).post(url).set(como(alvo, papel)).send(corpo);
const patch = (alvo, papel, url, corpo) => request(app).patch(url).set(como(alvo, papel)).send(corpo);

const NOME = `Camiseta Básica ${sufixo}`;
const corpoGrade = (alvo, extra = {}) => ({
    nome: NOME,
    descricao: 'Algodão',
    eixos: ['Tamanho', 'Cor'],
    custo: 20,
    preco_venda: 59.9,
    categoria_ids: [alvo.c.CAM],
    variacoes: [
        { valores: { Tamanho: 'P', Cor: 'Azul' }, categoria_ids: [alvo.c.P] },
        { valores: { Tamanho: 'M', Cor: 'Azul' }, categoria_ids: [alvo.c.M] },
        { valores: { Tamanho: 'P', Cor: 'Vermelha' }, categoria_ids: [alvo.c.P] }
    ],
    ...extra
});

beforeAll(async () => {
    await criarEmpresa(A, 'A', { grade: true });
    await criarEmpresa(B, 'B', { grade: true });
    await criarEmpresa(C, 'C', { grade: false });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('POST /grades (criar grade com as variações)', () => {
    test('cria a grade e uma variação por combinação, como produtos normais, com SKU pelas categorias', async () => {
        const res = await post(A, 'admin', '/grades', corpoGrade(A));

        expect(res.status).toBe(201);
        A.gradeId = res.body.data.grade.id;
        expect(res.body.data.grade).toMatchObject({ nome: NOME, descricao: 'Algodão', eixos: ['Tamanho', 'Cor'] });
        const nomes = res.body.data.variacoes.map((v) => [v.nome, v.sku]);

        expect(nomes).toEqual([
            [`${NOME} P / Azul`, 'CAM-P-001'],
            [`${NOME} M / Azul`, 'CAM-M-001'],
            [`${NOME} P / Vermelha`, 'CAM-P-002'] // mesma combinação de categorias: próxima sequência
        ]);

        const { rows } = await db.query(
            `SELECT nome, tipo, custo::float, preco_venda::float, estoque_atual, ativo, grade_id, variacao FROM produtos WHERE grade_id = $1 ORDER BY id`,
            [A.gradeId]
        );

        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ tipo: 'acabado', custo: 20, preco_venda: 59.9, estoque_atual: 0, ativo: true, variacao: { Tamanho: 'P', Cor: 'Azul' } });
        const { rows: mov } = await db.query('SELECT COUNT(*)::int AS n FROM movimentacoes_estoque WHERE empresa_id = $1', [A.empresaId]);

        expect(mov[0].n).toBe(0); // criar a grade nunca lança estoque
    });

    test('as variações aparecem em /produtos como produtos normais, com grade_id e variacao', async () => {
        const lista = await get(A, 'admin', '/produtos?canal=loja_fisica&pageSize=100');
        const variacao = lista.body.data.items.find((p) => p.sku === 'CAM-M-001');

        expect(variacao).toMatchObject({ grade_id: A.gradeId, variacao: { Tamanho: 'M', Cor: 'Azul' } });
        const normal = await post(A, 'admin', '/produtos', { nome: `Avulso ${sufixo}`, custo: 5 });

        expect(normal.body.data).toMatchObject({ grade_id: null, variacao: null });
    });

    test('nome de grade repetido na empresa = 409 (sem diferenciar maiúsculas); em outra empresa pode', async () => {
        const repetido = await post(A, 'admin', '/grades', corpoGrade(A, { nome: NOME.toUpperCase() }));

        expect(repetido.status).toBe(409);
        expect(repetido.body.message).toMatch(/já existe/i);
        expect((await post(B, 'admin', '/grades', corpoGrade(B))).status).toBe(201);
    });

    test('entrada inválida = 400 e nada é criado', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM produtos WHERE empresa_id = $1', [A.empresaId])).rows[0].n;
        const invalidos = [
            { eixos: [] },
            { eixos: ['A', 'B', 'C', 'D'] },
            { eixos: ['Tamanho', 'tamanho'] },
            { eixos: ['Tamanho', ' '] },
            { custo: 0 },
            { custo: -1 },
            { custo: undefined },
            { nome: '' },
            { variacoes: [] },
            { variacoes: [{ valores: { Tamanho: 'P' } }] },
            { variacoes: [{ valores: { Tamanho: 'P', Cor: 'Azul', Extra: 'x' } }] },
            { variacoes: [{ valores: { Tamanho: 'P', Cor: ' ' } }] },
            { variacoes: [{ valores: { Tamanho: 'P', Cor: 'Azul' } }, { valores: { Tamanho: 'p', Cor: 'AZUL' } }] },
            { variacoes: Array.from({ length: 101 }, (_, i) => ({ valores: { Tamanho: `T${i}`, Cor: 'X' } })) },
            { empresa_id: B.empresaId },
            { estoque_atual: 10 }
        ];

        for (const extra of invalidos) {
            const corpo = corpoGrade(A, { nome: `Inválida ${sufixo}`, ...extra });

            for (const [chave, valor] of Object.entries(extra)) if (valor === undefined) delete corpo[chave];
            expect((await post(A, 'admin', '/grades', corpo)).status).toBe(400);
        }
        expect((await db.query('SELECT COUNT(*)::int AS n FROM produtos WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes);
        expect((await db.query(`SELECT COUNT(*)::int AS n FROM grades_produto WHERE empresa_id = $1 AND nome = $2`, [A.empresaId, `Inválida ${sufixo}`])).rows[0].n).toBe(0);
    });

    test('categoria de outra empresa, inexistente ou mesmo nível repetido = 400 antes de criar qualquer coisa', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM produtos WHERE empresa_id = $1', [A.empresaId])).rows[0].n;
        const casos = [
            { categoria_ids: [B.c.CAM] },
            { categoria_ids: [99999999] },
            { variacoes: [{ valores: { Tamanho: 'P', Cor: 'Azul' }, categoria_ids: [A.c.CAL] }] } // CAM (comum) + CAL: dois do nível 1
        ];

        for (const [i, extra] of casos.entries()) {
            expect((await post(A, 'admin', '/grades', corpoGrade(A, { nome: `Cat inválida ${i} ${sufixo}`, ...extra }))).status).toBe(400);
        }
        expect((await db.query('SELECT COUNT(*)::int AS n FROM produtos WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes);
    });

    test('sem categorias a variação nasce sem SKU (como produto sem categoria) e dá para categorizar depois', async () => {
        const res = await post(A, 'admin', '/grades', {
            nome: `Caneca ${sufixo}`, eixos: ['Cor'], custo: 8, variacoes: [{ valores: { Cor: 'Branca' } }, { valores: { Cor: 'Preta' } }]
        });

        expect(res.status).toBe(201);
        expect(res.body.data.variacoes.map((v) => v.sku)).toEqual([null, null]);
        expect(res.body.data.variacoes.map((v) => v.nome)).toEqual([`Caneca ${sufixo} Branca`, `Caneca ${sufixo} Preta`]);
    });
});

describe('GET /grades e /grades/:id', () => {
    test('lista com número de variações e estoque total; detalhe com cada variação', async () => {
        const [v1] = (await db.query('SELECT id FROM produtos WHERE grade_id = $1 ORDER BY id', [A.gradeId])).rows;

        await db.query('UPDATE produtos SET estoque_atual = 7 WHERE id = $1', [v1.id]);
        const lista = await get(A, 'admin', '/grades');
        const grade = lista.body.data.items.find((g) => g.id === A.gradeId);

        expect(lista.status).toBe(200);
        expect(grade).toMatchObject({ nome: NOME, eixos: ['Tamanho', 'Cor'], variacoes: 3, estoque_total: 7 });

        const detalhe = await get(A, 'admin', `/grades/${A.gradeId}`);

        expect(detalhe.body.data.grade).toMatchObject({ id: A.gradeId, nome: NOME });
        expect(detalhe.body.data.variacoes).toHaveLength(3);
        expect(detalhe.body.data.variacoes[0]).toMatchObject({ sku: 'CAM-P-001', estoque_atual: 7, variacao: { Tamanho: 'P', Cor: 'Azul' }, custo: 20, preco_venda: 59.9 });
    });

    test('estoquista lê, mas sem custo; vendedor não acessa', async () => {
        const res = await get(A, 'estoquista', `/grades/${A.gradeId}`);

        expect(res.status).toBe(200);
        expect(res.body.data.variacoes[0]).not.toHaveProperty('custo');
        expect((await get(A, 'vendedor', `/grades/${A.gradeId}`)).status).toBe(403);
        expect((await get(A, 'vendedor', '/grades')).status).toBe(403);
    });

    test('grade de outra empresa ou inexistente = 404; id inválido = 400', async () => {
        const idB = (await db.query('SELECT id FROM grades_produto WHERE empresa_id = $1 LIMIT 1', [B.empresaId])).rows[0].id;

        expect((await get(A, 'admin', `/grades/${idB}`)).status).toBe(404);
        expect((await get(A, 'admin', '/grades/99999999')).status).toBe(404);
        expect((await get(A, 'admin', '/grades/abc')).status).toBe(400);
        const listaA = await get(A, 'admin', '/grades');

        expect(listaA.body.data.items.every((g) => g.id !== idB)).toBe(true);
    });
});

describe('POST /grades/:id/variacoes (acrescentar)', () => {
    test('acrescenta variações; combinação repetida (mesmo com outra caixa) = 409 e nada entra', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM produtos WHERE grade_id = $1', [A.gradeId])).rows[0].n;
        const dup = await post(A, 'admin', `/grades/${A.gradeId}/variacoes`, { variacoes: [{ valores: { Tamanho: 'G', Cor: 'Azul' } }, { valores: { Tamanho: 'p', Cor: 'azul' } }] });

        expect(dup.status).toBe(409);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM produtos WHERE grade_id = $1', [A.gradeId])).rows[0].n).toBe(antes); // nem a G/Azul válida entrou

        const ok = await post(A, 'admin', `/grades/${A.gradeId}/variacoes`, { variacoes: [{ valores: { Tamanho: 'G', Cor: 'Azul' }, categoria_ids: [A.c.G] }] });

        expect(ok.status).toBe(201);
        expect(ok.body.data.variacoes[0]).toMatchObject({ nome: `${NOME} G / Azul`, sku: 'CAM-G-001' });
    });

    test('a variação nova herda custo, preço e unidade da grade; pode ter custo próprio', async () => {
        const res = await post(A, 'admin', `/grades/${A.gradeId}/variacoes`, { variacoes: [{ valores: { Tamanho: 'G', Cor: 'Vermelha' }, custo: 25 }] });

        expect(res.status).toBe(201);
        const { rows } = await db.query('SELECT custo::float, preco_venda::float FROM produtos WHERE id = $1', [res.body.data.variacoes[0].id]);

        expect(rows[0]).toEqual({ custo: 25, preco_venda: 59.9 });
    });

    test('valores fora dos eixos da grade = 400; grade de outra empresa = 404', async () => {
        expect((await post(A, 'admin', `/grades/${A.gradeId}/variacoes`, { variacoes: [{ valores: { Tamanho: 'GG' } }] })).status).toBe(400);
        const idB = (await db.query('SELECT id FROM grades_produto WHERE empresa_id = $1 LIMIT 1', [B.empresaId])).rows[0].id;

        expect((await post(A, 'admin', `/grades/${idB}/variacoes`, { variacoes: [{ valores: { Tamanho: 'P', Cor: 'Azul' } }] })).status).toBe(404);
    });
});

describe('PATCH /grades/:id', () => {
    test('renomeia e muda a descrição, sem tocar nos eixos nem nos produtos; nome repetido = 409', async () => {
        const res = await patch(A, 'admin', `/grades/${A.gradeId}`, { descricao: 'Algodão pima' });

        expect(res.status).toBe(200);
        expect(res.body.data.grade).toMatchObject({ nome: NOME, descricao: 'Algodão pima', eixos: ['Tamanho', 'Cor'] });
        expect((await patch(A, 'admin', `/grades/${A.gradeId}`, { eixos: ['Outro'] })).status).toBe(400);
        expect((await patch(A, 'admin', `/grades/${A.gradeId}`, {})).status).toBe(400);

        const outra = (await post(A, 'admin', '/grades', { nome: `Bermuda ${sufixo}`, eixos: ['Tamanho'], custo: 30, variacoes: [{ valores: { Tamanho: 'M' } }] })).body.data.grade.id;

        expect((await patch(A, 'admin', `/grades/${outra}`, { nome: NOME })).status).toBe(409);
        expect((await patch(A, 'admin', `/grades/${outra}`, { nome: `Bermuda Jeans ${sufixo}` })).status).toBe(200);
    });
});

describe('flag, permissões e banco', () => {
    test('sem a funcionalidade grade = 403 em tudo; estoquista não escreve; sem token 401', async () => {
        expect((await get(C, 'admin', '/grades')).status).toBe(403);
        expect((await post(C, 'admin', '/grades', corpoGrade(C))).status).toBe(403);
        expect((await post(A, 'estoquista', '/grades', corpoGrade(A, { nome: `X ${sufixo}` }))).status).toBe(403);
        expect((await post(A, 'vendedor', '/grades', corpoGrade(A, { nome: `Y ${sufixo}` }))).status).toBe(403);
        expect((await patch(A, 'estoquista', `/grades/${A.gradeId}`, { descricao: 'x' })).status).toBe(403);
        expect((await request(app).get('/grades')).status).toBe(401);
        expect((await get(C, 'admin', '/produtos?canal=loja_fisica')).status).toBe(200); // o resto do sistema segue igual
    });

    test('o banco recusa variação duplicada na grade e variação sem grade', async () => {
        const { rows: [p] } = await db.query('SELECT grade_id, variacao FROM produtos WHERE grade_id = $1 LIMIT 1', [A.gradeId]);

        await expect(db.query(
            `INSERT INTO produtos (empresa_id, nome, custo, tipo, grade_id, variacao) VALUES ($1, 'dup', 1, 'acabado', $2, $3)`,
            [A.empresaId, p.grade_id, JSON.stringify(p.variacao)]
        )).rejects.toMatchObject({ code: '23505' });
        await expect(db.query(
            `INSERT INTO produtos (empresa_id, nome, custo, tipo, variacao) VALUES ($1, 'sem grade', 1, 'acabado', '{"Tamanho":"P"}')`,
            [A.empresaId]
        )).rejects.toMatchObject({ code: '23514' });
    });
});

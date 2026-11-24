// Integração (Postgres de testes): modelos prontos por nicho (categorias e padrão de SKU de partida).
// Aplicar só em empresa sem categoria de produto, tudo na mesma transação, isolado por empresa; o SKU sai pelo padrão.
jest.setTimeout(60000);
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { criarEmpresaComAdmin, criarTenant } = require('../../src/services/onboardingService');
const { onboardingSchema } = require('../../src/validations/onboardingValidation');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);
const SENHA_FORTE = `Aa1-${crypto.randomBytes(8).toString('hex')}`;

const A = { u: {} };
const B = { u: {} };
const C = { u: {} };
const D = { u: {} };
const E = { u: {} };

// Empresa nova, do jeito que o onboarding cria (padrão de SKU de produto sem segmentos, nenhuma categoria de produto).
async function novaEmpresa(alvo, rotulo, extras = {}) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const { empresa, usuario } = await criarEmpresaComAdmin(client, {
            empresa_nome: `Teste Nicho ${rotulo} ${sufixo}`,
            nome_admin: `Admin ${rotulo}`,
            email_admin: `admin-${rotulo}-${sufixo}@teste.invalid`,
            senha: SENHA_FORTE,
            ...extras
        });

        await client.query('COMMIT');
        alvo.empresaId = registro.registrar(empresa.id);
        alvo.u.admin = usuario.id;
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }

    for (const papel of ['vendedor', 'estoquista']) {
        const { rows } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${rotulo}`, `${papel}-${rotulo}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = rows[0].id;
    }
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const post = (alvo, papel, url, corpo = {}) => request(app).post(url).set(como(alvo, papel)).send(corpo);
const patch = (alvo, papel, url, corpo = {}) => request(app).patch(url).set(como(alvo, papel)).send(corpo);
const contar = async (tabela, alvo, extra = '') => (await db.query(`SELECT COUNT(*)::int AS n FROM ${tabela} WHERE empresa_id = $1 ${extra}`, [alvo.empresaId])).rows[0].n;

beforeAll(async () => {
    await novaEmpresa(A, 'A');
    await novaEmpresa(B, 'B');
    await novaEmpresa(C, 'C');
    await novaEmpresa(D, 'D');
    await novaEmpresa(E, 'E');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /modelos-nicho', () => {
    test('admin vê os modelos com níveis, categorias e um exemplo de SKU', async () => {
        const res = await get(A, 'admin', '/modelos-nicho');

        expect(res.status).toBe(200);
        expect(res.body.data.map((m) => m.id).sort()).toEqual(['adega', 'celulares_eletronicos', 'confeitaria', 'do_zero', 'lanchonete', 'moda', 'semijoias']);
        const confeitaria = res.body.data.find((m) => m.id === 'confeitaria');

        expect(confeitaria).toMatchObject({ nome: 'Confeitaria e doces', exemplo_sku: 'BOL-P-001' });
        expect(confeitaria.niveis[0]).toMatchObject({ nivel: 1, nome: 'Tipo' });
        expect(confeitaria.niveis[0].categorias[0]).toEqual({ codigo: 'BOL', nome: 'Bolos' });
    });

    test('só admin; sem token 401', async () => {
        expect((await get(A, 'vendedor', '/modelos-nicho')).status).toBe(403);
        expect((await get(A, 'estoquista', '/modelos-nicho')).status).toBe(403);
        expect((await request(app).get('/modelos-nicho')).status).toBe(401);
    });
});

describe('POST /modelos-nicho/:id/aplicar', () => {
    test('celulares_eletronicos e do_zero aplicam em empresas sem categoria', async () => {
        const cel = await post(D, 'admin', '/modelos-nicho/celulares_eletronicos/aplicar');

        expect(cel.status).toBe(200);
        expect(cel.body.data).toMatchObject({ modelo: 'celulares_eletronicos', niveis: 2, categorias: 15 });

        const zero = await post(E, 'admin', '/modelos-nicho/do_zero/aplicar');

        expect(zero.status).toBe(200);
        expect(zero.body.data).toMatchObject({ modelo: 'do_zero', niveis: 1, categorias: 0 });
        expect(await contar('categorias_produto', E, `AND escopo = 'produto' AND deletado_em IS NULL`)).toBe(0);
    });

    test('cria níveis, categorias e os segmentos do padrão; o SKU nasce pelo padrão e a sequência é por combinação', async () => {
        const insumosAntes = await contar('categorias_produto', A, `AND escopo = 'insumo'`);
        const res = await post(A, 'admin', '/modelos-nicho/confeitaria/aplicar');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ modelo: 'confeitaria', niveis: 2, categorias: 12 });
        expect(await contar('niveis_categoria', A, `AND escopo = 'produto'`)).toBe(2);
        expect(await contar('categorias_produto', A, `AND escopo = 'produto' AND deletado_em IS NULL`)).toBe(12);
        expect(await contar('categorias_produto', A, `AND escopo = 'insumo'`)).toBe(insumosAntes); // insumo não é tocado

        const { rows: seg } = await db.query(
            `SELECT s.nivel, s.nome, s.obrigatorio FROM configuracoes_sku c JOIN configuracoes_sku_segmentos s ON s.configuracao_id = c.id
              WHERE c.empresa_id = $1 AND c.escopo = 'produto' AND c.ativo AND c.padrao ORDER BY s.ordem`,
            [A.empresaId]
        );

        expect(seg).toEqual([{ nivel: 1, nome: 'Tipo', obrigatorio: true }, { nivel: 2, nome: 'Tamanho', obrigatorio: false }]);

        const lista = await get(A, 'admin', '/categorias?pageSize=100');
        const id = (codigo) => lista.body.data.items.find((c) => c.codigo === codigo).id;
        const produto = async (nome) => (await post(A, 'admin', '/produtos', { nome, custo: 5 })).body.data.id;

        const p1 = await produto(`Bolo de cenoura ${sufixo}`);
        const p2 = await produto(`Bolo de chocolate ${sufixo}`);
        const p3 = await produto(`Torta de limão ${sufixo}`);
        const sku = async (idProduto, codigos) => (await patch(A, 'admin', `/produtos/${idProduto}/categoria`, { categoria_ids: codigos.map(id) })).body.data.sku;

        expect(await sku(p1, ['BOL', 'P'])).toBe('BOL-P-001');
        expect(await sku(p2, ['BOL', 'P'])).toBe('BOL-P-002'); // mesma combinação, próxima sequência
        expect(await sku(p3, ['TOR', 'G'])).toBe('TOR-G-001'); // outra combinação, sequência própria
    });

    test('não aplica de novo (409) nem em empresa que já tem categoria de produto, e nada muda', async () => {
        expect((await post(A, 'admin', '/modelos-nicho/moda/aplicar')).status).toBe(409);
        expect(await contar('categorias_produto', A, `AND escopo = 'produto' AND deletado_em IS NULL`)).toBe(12);

        await db.query(`INSERT INTO niveis_categoria (empresa_id, nivel, nome, escopo) VALUES ($1, 1, 'Meu nível', 'produto')`, [B.empresaId]);
        await db.query(`INSERT INTO categorias_produto (empresa_id, nivel, codigo, nome, escopo) VALUES ($1, 1, 'XYZ', 'Minha', 'produto')`, [B.empresaId]);
        const res = await post(B, 'admin', '/modelos-nicho/moda/aplicar');

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/categorias/);
        expect(await contar('categorias_produto', B, `AND escopo = 'produto'`)).toBe(1);
        expect((await db.query(`SELECT nome FROM niveis_categoria WHERE empresa_id = $1 AND escopo = 'produto'`, [B.empresaId])).rows).toEqual([{ nome: 'Meu nível' }]);
    });

    test('modelo desconhecido = 404; vendedor e estoquista = 403; sem token = 401', async () => {
        expect((await post(C, 'admin', '/modelos-nicho/padaria-lunar/aplicar')).status).toBe(404);
        expect((await post(C, 'vendedor', '/modelos-nicho/adega/aplicar')).status).toBe(403);
        expect((await post(C, 'estoquista', '/modelos-nicho/adega/aplicar')).status).toBe(403);
        expect((await request(app).post('/modelos-nicho/adega/aplicar')).status).toBe(401);
        expect(await contar('categorias_produto', C, `AND escopo = 'produto'`)).toBe(0);
    });

    test('isolamento: aplicar na empresa C não toca nas outras', async () => {
        const antesA = await contar('categorias_produto', A);
        const antesB = await contar('categorias_produto', B);

        expect((await post(C, 'admin', '/modelos-nicho/adega/aplicar')).status).toBe(200);
        expect(await contar('categorias_produto', A)).toBe(antesA);
        expect(await contar('categorias_produto', B)).toBe(antesB);
        expect(await contar('categorias_produto', C, `AND escopo = 'produto'`)).toBe(12);
    });
});

describe('na criação da empresa (onboarding)', () => {
    test('modelo_nicho opcional aplica o modelo na mesma transação da criação', async () => {
        const dados = { empresa_nome: `Teste Nicho D ${sufixo}`, nome_admin: 'Admin D', email_admin: `admin-d-${sufixo}@teste.invalid`, senha_admin: SENHA_FORTE, modelo_nicho: 'lanchonete' };
        const { empresa } = await criarTenant(dados);

        registro.registrar(empresa.id);
        const { rows } = await db.query(`SELECT codigo FROM categorias_produto WHERE empresa_id = $1 AND escopo = 'produto' AND nivel = 1 ORDER BY codigo`, [empresa.id]);

        expect(rows.map((r) => r.codigo)).toEqual(['ACO', 'BEB', 'COM', 'LAN', 'POR', 'PRA', 'SOB']);
    });

    test('sem modelo, nada muda: a empresa nasce sem categoria de produto, como sempre', async () => {
        const { empresa } = await criarTenant({ empresa_nome: `Teste Nicho E ${sufixo}`, nome_admin: 'Admin E', email_admin: `admin-e-${sufixo}@teste.invalid`, senha_admin: SENHA_FORTE });

        registro.registrar(empresa.id);
        expect((await db.query(`SELECT COUNT(*)::int AS n FROM categorias_produto WHERE empresa_id = $1 AND escopo = 'produto'`, [empresa.id])).rows[0].n).toBe(0);
    });

    test('modelo inexistente derruba a criação inteira: nenhuma empresa fica pela metade', async () => {
        const nome = `Teste Nicho F ${sufixo}`;

        await expect(criarTenant({ empresa_nome: nome, nome_admin: 'Admin F', email_admin: `admin-f-${sufixo}@teste.invalid`, senha_admin: SENHA_FORTE, modelo_nicho: 'nao-existe' })).rejects.toThrow(/modelo/i);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM empresas WHERE nome = $1', [nome])).rows[0].n).toBe(0);
    });

    test('a validação do onboarding aceita só os modelos do catálogo', () => {
        const base = { empresa_nome: 'Doces da Ana', nome_admin: 'Ana', email_admin: 'ana@teste.invalid', senha_admin: SENHA_FORTE };

        expect(onboardingSchema.safeParse({ ...base, modelo_nicho: 'confeitaria' }).success).toBe(true);
        expect(onboardingSchema.safeParse({ ...base }).success).toBe(true);
        expect(onboardingSchema.safeParse({ ...base, modelo_nicho: 'padaria-lunar' }).success).toBe(false);
    });
});

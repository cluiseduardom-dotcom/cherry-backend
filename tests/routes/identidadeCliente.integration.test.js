// Integração de verdade (Postgres): identidade por cliente. Prova a rota PÚBLICA mínima (só tema,
// 404 uniforme), o controle do operador da plataforma (acesso lido do banco, auditoria, unicidade,
// concorrência) e a migration 081. Empresas e usuários temporários, removidos no fim.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA = `S-${crypto.randomBytes(6).toString('hex')}`;
const HASH = bcrypt.hashSync(SENHA, 4);

const operador = {};
const comum = {};
const alvo = {};

async function criarEmpresa(rotulo, { status = 'ativa', admin = true } = {}) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, $2) RETURNING id`, [`Teste Identidade ${rotulo} ${sufixo}`, status]);
    const empresa = { id: registro.registrar(rows[0].id), nome: `Teste Identidade ${rotulo} ${sufixo}` };

    if (admin) {
        empresa.email = `admin-${rotulo}-${sufixo}@teste.invalid`;
        empresa.adminId = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
            [empresa.id, `admin ${rotulo}`, empresa.email, HASH]
        )).rows[0].id;
    }

    return empresa;
}

const slugDe = (rotulo) => `t${sufixo}-${rotulo}`;
const como = (empresa) => ({ Authorization: `Bearer ${makeToken({ id: empresa.adminId, role: 'admin', empresa_id: empresa.id, tv: 0 })}` });
const patch = (empresa, corpo, quem = operador) => request(app).patch(`/plataforma/empresas/${empresa.id}/identidade`).set(como(quem)).send(corpo);
const eventos = async (empresaId) => (await db.query(
    `SELECT tema_anterior, tema_novo, slug_anterior, slug_novo, responsavel FROM empresas_identidade_eventos WHERE empresa_id = $1 ORDER BY id`, [empresaId]
)).rows;

beforeAll(async () => {
    Object.assign(operador, await criarEmpresa('Operador'));
    Object.assign(comum, await criarEmpresa('Comum'));
    for (const rotulo of ['a', 'b', 'c']) alvo[rotulo] = await criarEmpresa(rotulo.toUpperCase(), { admin: false });
    alvo.inativa = await criarEmpresa('Inativa', { status: 'inativa', admin: false });
    await db.query('UPDATE usuarios SET plataforma_admin = true WHERE id = $1', [operador.adminId]);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('acesso do operador', () => {
    const rotas = [
        ['get', '/plataforma/empresas/identidade'],
        ['get', '/plataforma/empresas/1/identidade/historico'],
        ['patch', '/plataforma/empresas/1/identidade']
    ];

    test.each(rotas)('%s %s: sem token 401; admin de empresa comum 403', async (metodo, caminho) => {
        expect((await request(app)[metodo](caminho)).status).toBe(401);
        expect((await request(app)[metodo](caminho).set(como(comum)).send({ tema_visual: 'cherry' })).status).toBe(403);
    });

    test('reivindicar plataforma_admin no token não abre o acesso (vem do banco)', async () => {
        const forjado = makeToken({ id: comum.adminId, role: 'admin', empresa_id: comum.id, tv: 0, plataforma_admin: true });
        expect((await request(app).get('/plataforma/empresas/identidade').set('Authorization', `Bearer ${forjado}`)).status).toBe(403);
    });

    test('a lista traz os temas aceitos e as empresas com tema e slug', async () => {
        const res = await request(app).get('/plataforma/empresas/identidade').set(como(operador));
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('no-store');
        expect(res.body.data.temas).toEqual(['vertumno', 'cherry', 'valvazori']);
        const linha = res.body.data.empresas.find((e) => e.empresa_id === alvo.a.id);
        expect(linha).toMatchObject({ empresa_nome: alvo.a.nome, status: 'ativa', tema_visual: 'vertumno', slug: null });
    });
});

describe('alterar tema e slug', () => {
    test('define tema e slug, registra o responsável e o login passa a devolver o tema', async () => {
        const res = await patch(alvo.a, { tema_visual: 'valvazori', slug: slugDe('a') });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ tema_visual: 'valvazori', slug: slugDe('a'), alterado: true });

        expect(await eventos(alvo.a.id)).toEqual([{
            tema_anterior: 'vertumno', tema_novo: 'valvazori', slug_anterior: null, slug_novo: slugDe('a'),
            responsavel: `${operador.email} (#${operador.adminId})`
        }]);
    });

    test('quem entra pela empresa com tema valvazori recebe o tema no login', async () => {
        await patch(comum, { tema_visual: 'valvazori' });
        const login = await request(app).post('/auth/login').send({ email: comum.email, senha: SENHA });
        expect(login.status).toBe(200);
        expect(login.body.data.usuario.empresa.tema).toBe('valvazori');
    });

    test('o responsável vem do usuário autenticado, não do corpo (campo extra é recusado)', async () => {
        const res = await patch(alvo.b, { tema_visual: 'cherry', responsavel: 'outra pessoa' });
        expect(res.status).toBe(400);
        expect(await eventos(alvo.b.id)).toEqual([]);
    });

    test('sem mudança real não grava evento', async () => {
        await patch(alvo.b, { tema_visual: 'cherry' });
        const repetido = await patch(alvo.b, { tema_visual: 'cherry' });
        expect(repetido.status).toBe(200);
        expect(repetido.body.data.alterado).toBe(false);
        expect(await eventos(alvo.b.id)).toHaveLength(1);
    });

    test('slug null remove o identificador (e a marca pública some)', async () => {
        await patch(alvo.c, { slug: slugDe('c') });
        expect((await request(app).get(`/publico/marca/${slugDe('c')}`)).status).toBe(200);

        expect((await patch(alvo.c, { slug: null })).status).toBe(200);
        expect((await request(app).get(`/publico/marca/${slugDe('c')}`)).status).toBe(404);
    });

    test.each([
        [{ tema_visual: 'azul' }],
        [{ slug: 'admin' }],
        [{ slug: 'Com Espaço' }],
        [{}]
    ])('recusa com 400: %j', async (corpo) => {
        expect((await patch(alvo.b, corpo)).status).toBe(400);
    });

    test('empresa inexistente: 404; id inválido: 400', async () => {
        const res = await request(app).patch('/plataforma/empresas/999999999/identidade').set(como(operador)).send({ tema_visual: 'cherry' });
        expect(res.status).toBe(404);
        expect((await request(app).patch('/plataforma/empresas/abc/identidade').set(como(operador)).send({ tema_visual: 'cherry' })).status).toBe(400);
    });

    test('slug já usado por outra empresa: 409 e nada muda', async () => {
        const res = await patch(alvo.b, { slug: slugDe('a') });
        expect(res.status).toBe(409);
        expect((await db.query('SELECT slug FROM empresas WHERE id = $1', [alvo.b.id])).rows[0].slug).toBeNull();
    });

    test('concorrência: duas empresas disputando o mesmo slug, só uma fica', async () => {
        const disputado = slugDe('disputa');
        const respostas = await Promise.all([patch(alvo.b, { slug: disputado }), patch(alvo.c, { slug: disputado })]);

        expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
        const { rows } = await db.query('SELECT count(*)::int AS n FROM empresas WHERE slug = $1', [disputado]);
        expect(rows[0].n).toBe(1);
    });

    test('histórico lista as mudanças da mais nova para a mais antiga', async () => {
        const res = await request(app).get(`/plataforma/empresas/${alvo.a.id}/identidade/historico`).set(como(operador));
        expect(res.status).toBe(200);
        expect(res.body.data[0]).toMatchObject({ tema_novo: 'valvazori', slug_novo: slugDe('a') });
    });
});

describe('rota pública /publico/marca/:slug', () => {
    test('sem login devolve só slug e tema, e nenhum dado da empresa', async () => {
        const res = await request(app).get(`/publico/marca/${slugDe('a')}`);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('no-store');
        expect(res.body).toEqual({ success: true, data: { slug: slugDe('a'), tema: 'valvazori' } });
        expect(JSON.stringify(res.body)).not.toContain(alvo.a.nome);
    });

    test('aceita maiúsculas (o slug é minúsculo)', async () => {
        const res = await request(app).get(`/publico/marca/${slugDe('a').toUpperCase()}`);
        expect(res.status).toBe(200);
        expect(res.body.data.slug).toBe(slugDe('a'));
    });

    test('inexistente, malformado e empresa inativa respondem exatamente o mesmo 404', async () => {
        await db.query('UPDATE empresas SET slug = $1 WHERE id = $2', [slugDe('inativa'), alvo.inativa.id]);

        const corpos = [];
        for (const slug of [slugDe('naoexiste'), 'com espaco', '-x', 'a'.repeat(60), slugDe('inativa')]) {
            const res = await request(app).get(`/publico/marca/${encodeURIComponent(slug)}`);
            expect(res.status).toBe(404);
            corpos.push(res.body);
        }
        expect(new Set(corpos.map((c) => JSON.stringify(c))).size).toBe(1);
    });

    test('um slug com tentativa de injeção de SQL é tratado como não encontrado', async () => {
        const res = await request(app).get(`/publico/marca/${encodeURIComponent("x' OR '1'='1")}`);
        expect(res.status).toBe(404);
    });
});

describe('migration 081', () => {
    test('é idempotente; o banco recusa slug inválido, slug repetido e tema fora do conjunto', async () => {
        const sql = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/081_empresas_slug_identidade.sql'), 'utf8');
        await db.query(sql);
        await db.query(sql);

        const slugMau = (valor) => db.query('UPDATE empresas SET slug = $1 WHERE id = $2', [valor, alvo.c.id]);
        await expect(slugMau('Maiúscula')).rejects.toMatchObject({ code: '23514' });
        await expect(slugMau('-comeca')).rejects.toMatchObject({ code: '23514' });
        await expect(slugMau(slugDe('a'))).rejects.toMatchObject({ code: '23505' });
        await expect(db.query(`UPDATE empresas SET tema_visual = 'azul' WHERE id = $1`, [alvo.c.id])).rejects.toMatchObject({ code: '23514' });
        await db.query(`UPDATE empresas SET tema_visual = 'valvazori' WHERE id = $1`, [alvo.c.id]);
    });
});

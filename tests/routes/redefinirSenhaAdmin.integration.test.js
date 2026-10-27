// Integração de verdade: POST /usuarios/:id/redefinir-senha (admin) + obrigação de trocar a senha temporária.
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
const SENHA_ADMIN = `Ad1-${crypto.randomBytes(6).toString('hex')}`;
const SENHA_VEND = `Ve1-${crypto.randomBytes(6).toString('hex')}`;
const NOVA = `Nv2-${crypto.randomBytes(6).toString('hex')}`;
const A = { u: {}, email: {} };
const B = { u: {}, email: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Redef ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const [papel, senha] of [['admin', SENHA_ADMIN], ['vendedor', SENHA_VEND], ['estoquista', SENHA_VEND]]) {
        alvo.email[papel] = `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`;
        alvo.u[papel] = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, alvo.email[papel], bcrypt.hashSync(senha, 4), papel]
        )).rows[0].id;
    }
}

const tk = (alvo, papel, tv = 0) => makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv });
const redefinir = (alvo, quem, alvoId, corpo) =>
    request(app).post(`/usuarios/${alvoId}/redefinir-senha`).set('Authorization', `Bearer ${tk(alvo, quem)}`).send(corpo);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('POST /usuarios/:id/redefinir-senha', () => {
    test('só admin: vendedor recebe 403 mesmo sobre outro usuário', async () => {
        const res = await redefinir(A, 'vendedor', A.u.estoquista, { senha_confirmacao: SENHA_VEND });
        expect(res.status).toBe(403);
    });

    test('exige a senha do admin; errada = 403 e nada muda', async () => {
        const res = await redefinir(A, 'admin', A.u.vendedor, { senha_confirmacao: 'errada-123' });
        expect(res.status).toBe(403);
        const { rows } = await db.query('SELECT senha, senha_temporaria, token_version FROM usuarios WHERE id = $1', [A.u.vendedor]);
        expect(await bcrypt.compare(SENHA_VEND, rows[0].senha)).toBe(true);
        expect(rows[0].senha_temporaria).toBe(false);
        expect(rows[0].token_version).toBe(0);
    });

    test('corpo estrito e id inválido são recusados; não redefine a própria senha', async () => {
        expect((await redefinir(A, 'admin', A.u.vendedor, { senha_confirmacao: SENHA_ADMIN, senha: 'x' })).status).toBe(400);
        expect((await redefinir(A, 'admin', 'abc', { senha_confirmacao: SENHA_ADMIN })).status).toBe(400);
        expect((await redefinir(A, 'admin', A.u.admin, { senha_confirmacao: SENHA_ADMIN })).status).toBe(400);
    });

    test('isolamento: admin da empresa A não redefine usuário da empresa B (404)', async () => {
        const res = await redefinir(A, 'admin', B.u.vendedor, { senha_confirmacao: SENHA_ADMIN });
        expect(res.status).toBe(404);
        const { rows } = await db.query('SELECT senha_temporaria FROM usuarios WHERE id = $1', [B.u.vendedor]);
        expect(rows[0].senha_temporaria).toBe(false);
    });

    test('fluxo completo: senha temporária única, login, bloqueio até trocar, troca libera', async () => {
        const res = await redefinir(A, 'admin', A.u.vendedor, { senha_confirmacao: SENHA_ADMIN });
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toMatch(/no-store/);
        const temp = res.body.data.senha_temporaria;
        expect(temp).toMatch(/^[A-Za-z0-9]{12}$/);
        expect(res.body.data.usuario).toMatchObject({ id: A.u.vendedor });

        // Só o hash fica no banco.
        const { rows } = await db.query('SELECT senha, senha_temporaria, token_version FROM usuarios WHERE id = $1', [A.u.vendedor]);
        expect(rows[0].senha).not.toBe(temp);
        expect(rows[0]).toMatchObject({ senha_temporaria: true, token_version: 1 });

        // Sessão antiga caiu; senha antiga não loga; a temporária loga e sinaliza a troca.
        expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${tk(A, 'vendedor', 0)}`)).status).toBe(401);
        expect((await request(app).post('/auth/login').send({ email: A.email.vendedor, senha: SENHA_VEND })).status).toBe(401);
        const login = await request(app).post('/auth/login').send({ email: A.email.vendedor, senha: temp });
        expect(login.status).toBe(200);
        expect(login.body.data.usuario.senha_temporaria).toBe(true);
        const token = login.body.data.token;

        // Com senha temporária: /auth/me responde (e avisa); o resto é 403.
        const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
        expect(me.status).toBe(200);
        expect(me.body.data.senha_temporaria).toBe(true);
        expect((await request(app).get('/produtos').set('Authorization', `Bearer ${token}`)).status).toBe(403);

        // Trocar a senha libera o acesso.
        const troca = await request(app).post('/auth/senha').set('Authorization', `Bearer ${token}`)
            .send({ senha_atual: temp, nova_senha: NOVA });
        expect(troca.status).toBe(200);
        const novoToken = troca.body.data.token;
        const liberado = await request(app).get('/produtos').set('Authorization', `Bearer ${novoToken}`);
        expect([401, 403]).not.toContain(liberado.status);
        const meDepois = await request(app).get('/auth/me').set('Authorization', `Bearer ${novoToken}`);
        expect(meDepois.body.data.senha_temporaria).toBe(false);

        // Trilha: evento do admin sobre o vendedor (e a troca do próprio vendedor).
        const ev = await db.query(
            `SELECT executado_por, campos FROM usuarios_eventos WHERE alvo_usuario_id = $1 AND empresa_id = $2 ORDER BY id`,
            [A.u.vendedor, A.empresaId]
        );
        expect(ev.rows).toEqual([
            { executado_por: A.u.admin, campos: ['senha'] },
            { executado_por: A.u.vendedor, campos: ['senha'] }
        ]);
    });
});

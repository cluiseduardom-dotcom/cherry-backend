// Integração de verdade: POST /auth/senha (troca da própria senha) com authMiddleware e banco reais.
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
const SENHA = `Aa1-${crypto.randomBytes(6).toString('hex')}`;
const NOVA = `Bb2-${crypto.randomBytes(6).toString('hex')}`;
let empresaId;
let usuarioId;
let outroId;
let email;

const token = (id = usuarioId, tv = 0) => makeToken({ id, role: 'vendedor', empresa_id: empresaId, tv });
const trocar = (corpo, t = token()) => request(app).post('/auth/senha').set('Authorization', `Bearer ${t}`).send(corpo);

beforeAll(async () => {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Senha ${sufixo}`]);
    empresaId = registro.registrar(rows[0].id);
    email = `u-${sufixo}@teste.invalid`;
    usuarioId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Usuario', $2, $3, 'vendedor') RETURNING id`,
        [empresaId, email, bcrypt.hashSync(SENHA, 4)]
    )).rows[0].id;
    outroId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Outro', $2, $3, 'vendedor') RETURNING id`,
        [empresaId, `o-${sufixo}@teste.invalid`, bcrypt.hashSync(SENHA, 4)]
    )).rows[0].id;
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('POST /auth/senha', () => {
    test('exige autenticação', async () => {
        const res = await request(app).post('/auth/senha').send({ senha_atual: SENHA, nova_senha: NOVA });
        expect(res.status).toBe(401);
    });

    test('senha atual errada: 403 e nada muda', async () => {
        const res = await trocar({ senha_atual: 'errada-123', nova_senha: NOVA });
        expect(res.status).toBe(403);
        const { rows } = await db.query('SELECT senha, token_version FROM usuarios WHERE id = $1', [usuarioId]);
        expect(await bcrypt.compare(SENHA, rows[0].senha)).toBe(true);
        expect(rows[0].token_version).toBe(0);
    });

    test('valida a nova senha (mínimo 8, diferente da atual)', async () => {
        expect((await trocar({ senha_atual: SENHA, nova_senha: 'curta' })).status).toBe(400);
        expect((await trocar({ senha_atual: SENHA, nova_senha: SENHA })).status).toBe(400);
        expect((await trocar({ senha_atual: SENHA })).status).toBe(400);
    });

    test('troca: nova senha loga, antiga não, token antigo cai, token novo vale, há trilha', async () => {
        const res = await trocar({ senha_atual: SENHA, nova_senha: NOVA });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();
        expect(JSON.stringify(res.body)).not.toContain(NOVA);

        expect((await request(app).post('/auth/login').send({ email, senha: NOVA })).status).toBe(200);
        expect((await request(app).post('/auth/login').send({ email, senha: SENHA })).status).toBe(401);

        // Sessão antiga (tv 0) foi derrubada; a nova (devolvida pela troca) continua válida.
        expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${token()}`)).status).toBe(401);
        expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${res.body.data.token}`)).status).toBe(200);

        const { rows } = await db.query(
            `SELECT acao, campos, executado_por, alvo_usuario_id FROM usuarios_eventos WHERE alvo_usuario_id = $1 AND empresa_id = $2`,
            [usuarioId, empresaId]
        );
        expect(rows).toEqual([{ acao: 'editar', campos: ['senha'], executado_por: usuarioId, alvo_usuario_id: usuarioId }]);
    });

    test('só troca a própria senha: outro usuário da empresa não é afetado', async () => {
        const { rows } = await db.query('SELECT senha, token_version FROM usuarios WHERE id = $1', [outroId]);
        expect(await bcrypt.compare(SENHA, rows[0].senha)).toBe(true);
        expect(rows[0].token_version).toBe(0);
    });
});

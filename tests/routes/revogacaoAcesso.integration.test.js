// Integração de verdade (Postgres da CI/dev, sem mock de sessão): prova que a
// migration 044 + sessaoRepository + authMiddleware + login revogam o acesso.
// Cria a própria empresa/usuário temporários e remove tudo no fim; não depende
// do seed nem toca em dados dele.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');

const senha = crypto.randomBytes(12).toString('hex');
const email = `revogacao-${crypto.randomBytes(4).toString('hex')}@teste.invalid`;

let empresaId;
let usuarioId;

async function login() {
  return request(app).post('/auth/login').send({ email, senha });
}

const listarClientes = (token) => request(app).get('/clientes').set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  const empresa = await db.query(
    `INSERT INTO empresas (nome, status) VALUES ('Teste Revogacao #87', 'ativa') RETURNING id`
  );
  empresaId = empresa.rows[0].id;

  const usuario = await db.query(
    `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin Revogacao', $2, $3, 'admin') RETURNING id`,
    [empresaId, email, await bcrypt.hash(senha, 4)]
  );
  usuarioId = usuario.rows[0].id;
});

afterAll(async () => {
  await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [empresaId]);
  await db.query('DELETE FROM empresas WHERE id = $1', [empresaId]);
  await db.end();
});

beforeEach(async () => {
  await db.query(`UPDATE usuarios SET ativo = true, token_version = 0 WHERE id = $1`, [usuarioId]);
  await db.query(`UPDATE empresas SET status = 'ativa' WHERE id = $1`, [empresaId]);
});

describe('revogação de acesso com banco real (#87 item 5)', () => {
  test('usuário novo nasce ativo e na token_version 0 (migration 044 é aditiva)', async () => {
    const { rows } = await db.query('SELECT ativo, token_version FROM usuarios WHERE id = $1', [usuarioId]);

    expect(rows[0]).toEqual({ ativo: true, token_version: 0 });
  });

  test('login válido emite token que acessa a API', async () => {
    const res = await login();

    expect(res.status).toBe(200);
    expect((await listarClientes(res.body.data.token)).status).toBe(200);
  });

  test('desativar o usuário derruba o token já emitido e bloqueia novo login', async () => {
    const { body } = await login();
    await db.query('UPDATE usuarios SET ativo = false WHERE id = $1', [usuarioId]);

    expect((await listarClientes(body.data.token)).status).toBe(401);

    const novoLogin = await login();
    expect(novoLogin.status).toBe(401);
    expect(novoLogin.body.message).toBe('Email ou senha inválidos');
  });

  test('avançar a token_version revoga o token antigo; um novo login volta a funcionar', async () => {
    const antigo = (await login()).body.data.token;
    await db.query('UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1', [usuarioId]);

    expect((await listarClientes(antigo)).status).toBe(401);

    const novo = (await login()).body.data.token;
    expect((await listarClientes(novo)).status).toBe(200);
    expect((await listarClientes(antigo)).status).toBe(401);
  });

  test('empresa inativa derruba o token e impede login', async () => {
    const { body } = await login();
    await db.query(`UPDATE empresas SET status = 'inativa' WHERE id = $1`, [empresaId]);

    expect((await listarClientes(body.data.token)).status).toBe(401);
    expect((await login()).status).toBe(401);
  });

  test('token com empresa_id adulterado para outra empresa não vale (usuário não pertence a ela)', async () => {
    const jwt = require('jsonwebtoken');
    const forjado = jwt.sign({ id: usuarioId, role: 'admin', empresa_id: empresaId + 100000, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });

    expect((await listarClientes(forjado)).status).toBe(401);
  });
});

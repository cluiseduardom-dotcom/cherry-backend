// Integração de verdade (Postgres da CI, sem mock de sessão): prova que a migration 049 +
// usuarioRepository + authService devolvem o tema da empresa do usuário autenticado.
// Cria as próprias empresas/usuários temporários e remove tudo no fim; não depende do seed.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);

const senha = crypto.randomBytes(12).toString('hex');
const sufixo = crypto.randomBytes(4).toString('hex');
const emailCherry = `tema-cherry-${sufixo}@teste.invalid`;
const emailPadrao = `tema-padrao-${sufixo}@teste.invalid`;

let empresaCherry;
let empresaPadrao;

const login = (email, extra = {}) => request(app).post('/auth/login').send({ email, senha, ...extra });

async function criarEmpresaComAdmin(nome, tema, email) {
  const empresa = await db.query(
    `INSERT INTO empresas (nome, status, tema_visual) VALUES ($1, 'ativa', $2) RETURNING id`,
    [nome, tema]
  );
  const id = registro.registrar(empresa.rows[0].id);

  await db.query(
    `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin Tema', $2, $3, 'admin')`,
    [id, email, await bcrypt.hash(senha, 4)]
  );

  return id;
}

beforeAll(async () => {
  empresaCherry = await criarEmpresaComAdmin(`Teste Tema Cherry ${sufixo}`, 'cherry', emailCherry);
  empresaPadrao = await criarEmpresaComAdmin(`Teste Tema Padrao ${sufixo}`, 'vertumno', emailPadrao);
});

afterAll(async () => {
  try {
    await db.query('DELETE FROM usuarios WHERE empresa_id = ANY($1)', [[empresaCherry, empresaPadrao].filter(Boolean)]);
    await db.query('DELETE FROM empresas WHERE id = ANY($1)', [[empresaCherry, empresaPadrao].filter(Boolean)]);
  } finally {
    try {
      await registro.limpar();
    } finally {
      await db.end();
    }
  }
});

describe('tema visual da empresa no login, com banco real (cherry-frontend#63)', () => {
  test('cada usuário recebe o tema da própria empresa, e os campos antigos continuam', async () => {
    const cherry = await login(emailCherry);
    const padrao = await login(emailPadrao);

    expect(cherry.status).toBe(200);
    expect(cherry.body.data.usuario).toMatchObject({
      papel: 'admin', empresa_id: empresaCherry, empresa: { id: empresaCherry, tema: 'cherry' }
    });
    expect(padrao.body.data.usuario).toMatchObject({
      empresa_id: empresaPadrao, empresa: { id: empresaPadrao, tema: 'vertumno' }
    });
  });

  test('o JWT não carrega o tema', async () => {
    const { token } = (await login(emailCherry)).body.data;
    const payload = jwt.decode(token);

    expect(Object.keys(payload).sort()).toEqual(['empresa_id', 'exp', 'iat', 'id', 'role', 'tv']);
  });

  test('tema, empresa_id e empresa no corpo ou na query não mudam o resultado', async () => {
    const res = await request(app)
      .post('/auth/login?tema=cherry&empresa_id=1')
      .send({ email: emailPadrao, senha, tema: 'cherry', empresa_id: empresaCherry, empresa: { tema: 'cherry' } });

    expect(res.status).toBe(200);
    expect(res.body.data.usuario.empresa).toEqual({ id: empresaPadrao, tema: 'vertumno' });
  });

  test('empresa inativa não autentica e a resposta não revela o tema', async () => {
    await db.query(`UPDATE empresas SET status = 'inativa' WHERE id = $1`, [empresaCherry]);
    try {
      const res = await login(emailCherry);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: 'Email ou senha inválidos' });
      expect(JSON.stringify(res.body)).not.toMatch(/cherry|tema/i);
    } finally {
      await db.query(`UPDATE empresas SET status = 'ativa' WHERE id = $1`, [empresaCherry]);
    }
  });
});

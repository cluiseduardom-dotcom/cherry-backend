// Integração de verdade (Postgres real): login pelo código de usuário (ex.: EGASIL), único POR EMPRESA e
// feito na página da loja (slug). Prova: e-mail continua valendo; código só entra na própria loja; o mesmo
// código pode existir em duas lojas; criação gera o código (repetido ganha número); troca com auditoria.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarRegistroDeEmpresas, removerEmpresasPorNome } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const senha = crypto.randomBytes(12).toString('hex');
const NOME = (r) => `Teste Login Codigo ${r} ${sufixo}`;
const lojas = {};

async function criarLoja(rotulo) {
  const slug = `t-login-${rotulo.toLowerCase()}-${sufixo}`;
  const { rows } = await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [NOME(rotulo), slug]);
  const id = registro.registrar(rows[0].id);
  const hash = await bcrypt.hash(senha, 4);
  const admin = await db.query(
    `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, login) VALUES ($1, 'Luís Eduardo Martins Cardoso', $2, $3, 'admin', 'LEMCAR') RETURNING id`,
    [id, `lemcar-${rotulo}-${sufixo}@teste.invalid`, hash]
  );
  lojas[rotulo] = { id, slug, adminId: admin.rows[0].id, email: `lemcar-${rotulo}-${sufixo}@teste.invalid` };
}

const entrar = (corpo) => request(app).post('/auth/login').send({ senha, ...corpo });

beforeAll(async () => {
  await removerEmpresasPorNome(db, `Teste Login Codigo % ${sufixo}`).catch(() => {});
  await criarLoja('A');
  await criarLoja('B');
  const res = await entrar({ email: lojas.A.email });
  lojas.A.token = res.body.data.token;
});

afterAll(async () => {
  try {
    await registro.limpar();
  } finally {
    await db.end();
  }
});

describe('login por código de usuário', () => {
  test('e-mail continua entrando em qualquer tela', async () => {
    const res = await entrar({ email: lojas.A.email });
    expect(res.status).toBe(200);
    expect(res.body.data.usuario.login).toBe('LEMCAR');
  });

  test('código + loja entra (maiúsculas/minúsculas e espaços não importam)', async () => {
    const res = await entrar({ identificador: ' lemcar ', empresa_slug: lojas.A.slug });
    expect(res.status).toBe(200);
    expect(res.body.data.usuario.empresa_id).toBe(lojas.A.id);
    // O navegador usa o slug devolvido para lembrar a loja (login por código sem digitar o endereço).
    expect(res.body.data.usuario.empresa.slug).toBe(lojas.A.slug);
  });

  test('o mesmo código em duas lojas: cada loja autentica o seu', async () => {
    const res = await entrar({ identificador: 'LEMCAR', empresa_slug: lojas.B.slug });
    expect(res.status).toBe(200);
    expect(res.body.data.usuario.empresa_id).toBe(lojas.B.id);
  });

  test.each([
    ['código sem loja', { identificador: 'LEMCAR' }],
    ['loja inexistente', { identificador: 'LEMCAR', empresa_slug: `nao-existe-${sufixo}` }],
    ['código inexistente', { identificador: 'ZZZZZZ', empresa_slug: 'x' }]
  ])('%s: 401 com a mesma mensagem de senha errada', async (_, corpo) => {
    const res = await entrar({ ...corpo, empresa_slug: corpo.empresa_slug === 'x' ? lojas.A.slug : corpo.empresa_slug });
    expect(res.status).toBe(401);
    const errada = await request(app).post('/auth/login').send({ identificador: 'LEMCAR', empresa_slug: lojas.A.slug, senha: 'errada-123' });
    expect(res.body.message).toBe(errada.body.message);
  });
});

describe('criação e troca do código', () => {
  const auth = () => ({ Authorization: `Bearer ${lojas.A.token}` });

  test('criar sem código gera pelo nome; repetido ganha número; o escolhido vale', async () => {
    const corpo = (n, extra = {}) => ({ nome: 'Emilly Graziela Alves da Silva', email: `egasil${n}-${sufixo}@teste.invalid`, senha: 'senha-forte-1', papel: 'vendedor', telefone: '11987654321', ...extra });
    const r1 = await request(app).post('/usuarios').set(auth()).send(corpo(1));
    const r2 = await request(app).post('/usuarios').set(auth()).send(corpo(2));
    const r3 = await request(app).post('/usuarios').set(auth()).send(corpo(3, { login: 'emilly' }));
    expect([r1.status, r2.status, r3.status]).toEqual([201, 201, 201]);
    expect(r1.body.data.usuario.login).toBe('EGASIL');
    expect(r2.body.data.usuario.login).toBe('EGASIL2');
    expect(r3.body.data.usuario.login).toBe('EMILLY');

    const dup = await request(app).post('/usuarios').set(auth()).send(corpo(4, { login: 'EGASIL' }));
    expect(dup.status).toBe(409);
  });

  test('trocar o código: valida formato, recusa repetido, grava trilha e passa a entrar com o novo', async () => {
    const { rows } = await db.query(`SELECT id FROM usuarios WHERE empresa_id = $1 AND login = 'EGASIL2'`, [lojas.A.id]);
    const id = rows[0].id;

    expect((await request(app).patch(`/usuarios/${id}/login`).set(auth()).send({ login: 'X' })).status).toBe(400);
    expect((await request(app).patch(`/usuarios/${id}/login`).set(auth()).send({ login: 'EGASIL' })).status).toBe(409);

    const ok = await request(app).patch(`/usuarios/${id}/login`).set(auth()).send({ login: 'egsilva' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ alterado: true, login: 'EGSILVA' });

    const ev = await db.query(`SELECT campos FROM usuarios_eventos WHERE empresa_id = $1 AND alvo_usuario_id = $2 AND acao = 'editar'`, [lojas.A.id, id]);
    expect(ev.rows.map(r => r.campos)).toContainEqual(['login']);

    const res = await request(app).post('/auth/login').send({ identificador: 'EGSILVA', empresa_slug: lojas.A.slug, senha: 'senha-forte-1' });
    expect(res.status).toBe(200);
  });

  test('editar o nome completo: grava, registra na trilha e não muda o login', async () => {
    const res = await request(app).patch(`/usuarios/${lojas.A.adminId}/nome`).set(auth()).send({ nome: '  Luís   Eduardo Cardoso ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ alterado: true, nome: 'Luís Eduardo Cardoso' });

    const { rows } = await db.query('SELECT nome, login FROM usuarios WHERE id = $1', [lojas.A.adminId]);
    expect(rows[0]).toEqual({ nome: 'Luís Eduardo Cardoso', login: 'LEMCAR' });

    const igual = await request(app).patch(`/usuarios/${lojas.A.adminId}/nome`).set(auth()).send({ nome: 'Luís Eduardo Cardoso' });
    expect(igual.body.data).toEqual({ alterado: false, nome: 'Luís Eduardo Cardoso' });

    const ev = await db.query(`SELECT campos FROM usuarios_eventos WHERE alvo_usuario_id = $1 AND acao = 'editar'`, [lojas.A.adminId]);
    expect(ev.rows.map(r => r.campos)).toContainEqual(['nome']);

    expect((await request(app).patch(`/usuarios/${lojas.A.adminId}/nome`).set(auth()).send({ nome: '   ' })).status).toBe(400);
    expect((await request(app).patch(`/usuarios/${lojas.B.adminId}/nome`).set(auth()).send({ nome: 'Invasor' })).status).toBe(404);
  });

  test('usuário de outra loja não é encontrado (isolamento)', async () => {
    const res = await request(app).patch(`/usuarios/${lojas.B.adminId}/login`).set(auth()).send({ login: 'INVASOR' });
    expect(res.status).toBe(404);
  });

  test('a lista de usuários traz o código', async () => {
    const res = await request(app).get('/usuarios').set(auth());
    expect(res.body.data.find(u => u.id === lojas.A.adminId).login).toBe('LEMCAR');
  });
});

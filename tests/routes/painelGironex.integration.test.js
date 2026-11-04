// Integração de verdade (Postgres real): Painel GiroNex. Prova o login em três fatores (e-mail, senha, código
// TOTP), a separação total do ERP (token de um não abre o outro), a senha temporária obrigatória, o reúso de
// código recusado, a criação de empresa com admin de senha temporária e a trilha das ações.
const crypto = require('node:crypto');

process.env.PAINEL_JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.PAINEL_ENC_KEY = crypto.randomBytes(32).toString('base64');

jest.unmock('../../src/repositories/sessaoRepository');

const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const totp = require('../../src/utils/totp');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const email = `op-${sufixo}@teste.invalid`;
const senhaInicial = crypto.randomBytes(12).toString('hex');
const senhaNova = `nova-${crypto.randomBytes(10).toString('hex')}`;
let operadorId;
let segredo;
let sessao;
let tokenErp;
let empresaExistente;

// O servidor aceita o passo atual ±1 e nunca o mesmo passo duas vezes: a configuração usa o passo anterior
// e o login seguinte usa o atual (sem esperar 30 s de verdade).
const codigoDoPasso = (delta) => totp.gerarCodigo(segredo, Date.now() + delta * 30_000);

beforeAll(async () => {
  const { rows } = await db.query(
    `INSERT INTO plataforma_operadores (nome, email, senha, senha_temporaria) VALUES ('Operador Teste', $1, $2, true) RETURNING id`,
    [email, await bcrypt.hash(senhaInicial, 4)]
  );
  operadorId = rows[0].id;

  const emp = await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste Painel ${sufixo}`, `t-painel-${sufixo}`]);
  empresaExistente = registro.registrar(emp.rows[0].id);
  const erpEmail = `erp-${sufixo}@teste.invalid`;
  await db.query(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin ERP', $2, $3, 'admin')`, [empresaExistente, erpEmail, await bcrypt.hash(senhaInicial, 4)]);
  tokenErp = (await request(app).post('/auth/login').send({ email: erpEmail, senha: senhaInicial })).body.data.token;
});

afterAll(async () => {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL vertumno.limpeza_teste = 'on'`);
    await c.query('DELETE FROM plataforma_eventos WHERE operador_id = $1', [operadorId]);
    await c.query('DELETE FROM plataforma_operadores WHERE id = $1', [operadorId]);
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  try {
    await registro.limpar();
  } finally {
    await db.end();
  }
});

describe('Painel GiroNex: login em três fatores', () => {
  test('primeiro acesso: senha certa devolve só o token de configuração do 2FA', async () => {
    const res = await request(app).post('/painel/auth/login').send({ email, senha: senhaInicial });
    expect(res.status).toBe(200);
    expect(res.body.data.etapa).toBe('configurar_2fa');
    expect(res.body.data.token).toBeUndefined();

    const ini = await request(app).post('/painel/auth/2fa/iniciar').send({ token_2fa: res.body.data.token_2fa });
    expect(ini.status).toBe(200);
    segredo = ini.body.data.segredo;
    expect(ini.body.data.otpauth).toContain('otpauth://totp/GiroNex');

    const { rows } = await db.query('SELECT totp_segredo FROM plataforma_operadores WHERE id = $1', [operadorId]);
    expect(rows[0].totp_segredo).not.toContain(segredo); // gravado cifrado

    expect((await request(app).post('/painel/auth/2fa/confirmar').send({ token_2fa: res.body.data.token_2fa, codigo: '000000' })).status).toBe(401);

    const conf = await request(app).post('/painel/auth/2fa/confirmar').send({ token_2fa: res.body.data.token_2fa, codigo: codigoDoPasso(-1) });
    expect(conf.status).toBe(200);
    sessao = conf.body.data.token;
    expect(conf.body.data.operador.senha_temporaria).toBe(true);
  });

  test('com senha temporária, só dá para trocar a senha', async () => {
    expect((await request(app).get('/painel/taxas').set('Authorization', `Bearer ${sessao}`)).status).toBe(403);
    expect((await request(app).post('/painel/auth/senha').set('Authorization', `Bearer ${sessao}`).send({ senha_atual: senhaInicial, nova_senha: 'curta' })).status).toBe(400);

    const troca = await request(app).post('/painel/auth/senha').set('Authorization', `Bearer ${sessao}`).send({ senha_atual: senhaInicial, nova_senha: senhaNova });
    expect(troca.status).toBe(200);
    expect((await request(app).get('/painel/auth/me').set('Authorization', `Bearer ${sessao}`)).status).toBe(401); // sessão antiga caiu
    sessao = troca.body.data.token;
    expect((await request(app).get('/painel/taxas').set('Authorization', `Bearer ${sessao}`)).status).toBe(200);
  });

  test('login normal exige o código; código errado, ausente ou repetido é recusado com a mesma mensagem', async () => {
    const sem = await request(app).post('/painel/auth/login').send({ email, senha: senhaNova });
    const errado = await request(app).post('/painel/auth/login').send({ email, senha: senhaNova, codigo: '123456' });
    const senhaErrada = await request(app).post('/painel/auth/login').send({ email, senha: 'x', codigo: '123456' });
    expect([sem.status, errado.status, senhaErrada.status]).toEqual([401, 401, 401]);
    expect(new Set([sem.body.message, errado.body.message, senhaErrada.body.message]).size).toBe(1);

    const codigo = codigoDoPasso(0);
    const ok = await request(app).post('/painel/auth/login').send({ email, senha: senhaNova, codigo });
    expect(ok.status).toBe(200);
    expect(ok.body.data.etapa).toBe('ok');
    const repetido = await request(app).post('/painel/auth/login').send({ email, senha: senhaNova, codigo });
    expect(repetido.status).toBe(401);
    sessao = ok.body.data.token;
  });
});

describe('Painel GiroNex: separado do ERP', () => {
  test('token do ERP (mesmo de admin) não abre o painel', async () => {
    expect((await request(app).get('/painel/taxas').set('Authorization', `Bearer ${tokenErp}`)).status).toBe(401);
  });

  test('token do painel não abre o ERP', async () => {
    expect((await request(app).get('/usuarios').set('Authorization', `Bearer ${sessao}`)).status).toBe(401);
    expect((await request(app).get('/plataforma/taxas').set('Authorization', `Bearer ${sessao}`)).status).toBe(404); // rota antiga removida
  });
});

describe('Painel GiroNex: operação', () => {
  test('criar empresa: admin com senha temporária e login gerado; sem token da loja; vai para a trilha', async () => {
    const res = await request(app).post('/painel/empresas').set('Authorization', `Bearer ${sessao}`)
      .send({ empresa_nome: `Teste Painel Nova ${sufixo}`, nome_admin: 'Maria Clara Souza', email_admin: `maria-${sufixo}@teste.invalid` });
    expect(res.status).toBe(201);
    registro.registrar(res.body.data.empresa.id);
    expect(res.body.data.admin.login).toBe('MCSOU');
    expect(res.body.data.senha_temporaria).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(res.body.data.token).toBeUndefined();

    const { rows } = await db.query('SELECT senha_temporaria, papel FROM usuarios WHERE id = $1', [res.body.data.admin.id]);
    expect(rows[0]).toEqual({ senha_temporaria: true, papel: 'admin' });

    const login = await request(app).post('/auth/login').send({ email: `maria-${sufixo}@teste.invalid`, senha: res.body.data.senha_temporaria });
    expect(login.status).toBe(200);
    expect(login.body.data.usuario.senha_temporaria).toBe(true);

    const ev = await db.query(`SELECT acao, detalhe FROM plataforma_eventos WHERE operador_id = $1 AND acao = 'empresa_criada'`, [operadorId]);
    expect(ev.rows[0].detalhe.admin_login).toBe('MCSOU');
    expect(JSON.stringify(ev.rows[0].detalhe)).not.toContain(res.body.data.senha_temporaria);
  });

  test('alterar identidade pelo painel: assina como painel e registra o evento', async () => {
    const res = await request(app).patch(`/painel/empresas/${empresaExistente}/identidade`).set('Authorization', `Bearer ${sessao}`).send({ tema_visual: 'valvazori' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));

    const hist = await db.query('SELECT responsavel FROM empresas_identidade_eventos WHERE empresa_id = $1 ORDER BY id DESC LIMIT 1', [empresaExistente]);
    expect(hist.rows[0].responsavel).toBe(`painel:${email} (#${operadorId})`);

    const ev = await request(app).get('/painel/eventos').set('Authorization', `Bearer ${sessao}`);
    expect(ev.body.data.items.map((e) => e.acao)).toEqual(expect.arrayContaining(['identidade_alterada', 'empresa_criada', 'login', '2fa_configurado', 'senha_alterada']));
  });

  test('trilha é imutável', async () => {
    await expect(db.query('UPDATE plataforma_eventos SET acao = $1 WHERE operador_id = $2', ['x', operadorId])).rejects.toThrow(/imutável/);
  });
});

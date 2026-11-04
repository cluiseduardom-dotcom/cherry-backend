// Integração (Postgres real): sincronização da conta Mercado Pago. O cliente do provedor e a leitura do token
// são simulados; o resto (SQL, idempotência, saldo, isolamento) é real.
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');

jest.unmock('../../src/repositories/sessaoRepository');

jest.mock('../../src/integrations/mercadoPagoClient', () => ({ buscarPagamento: jest.fn() }));
jest.mock('../../src/services/mercadoPagoService', () => ({
  exigirConfig: jest.fn(() => ({ apiUrl: 'https://mp.invalid' })),
  obterAccessToken: jest.fn(async () => 'token-de-teste')
}));

const db = require('../../src/config/db');
const app = require('../../src/app');
const mpClient = require('../../src/integrations/mercadoPagoClient');
const mpService = require('../../src/services/mercadoPagoService');
const AppError = require('../../src/errors/AppError');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const senha = crypto.randomBytes(12).toString('hex');
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const iso = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString();

let empresaA; let empresaB; let adminA; let adminB; let vendedorA; let usuarioAId; let contaId;

async function criarUsuario(empresaId, papel, rotulo) {
  const email = `${rotulo}-${sufixo}@teste.invalid`;
  const { rows } = await db.query(
    'INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [empresaId, `U ${rotulo}`, email, await bcrypt.hash(senha, 4), papel]
  );
  const res = await request(app).post('/auth/login').send({ email, senha });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: rows[0].id };
}

const com = (t) => ({ Authorization: `Bearer ${t}` });
const sincronizar = (t, corpo) => request(app).post('/bancos/mercadopago/sincronizar').set(com(t)).send(corpo);
const saldo = async (t, id) => Number((await request(app).get(`/bancos/contas/${id}`).set(com(t))).body.data.saldo_atual);
const aLiberar = async (t, id) => Number((await request(app).get(`/bancos/contas/${id}`).set(com(t))).body.data.a_liberar);

async function cobranca(empresaId, usuarioId, idExterno, { status = 'pago', valor = 100, metodo = 'pix' } = {}) {
  const { rows } = await db.query(
    `INSERT INTO cobrancas_pagamento (codigo, empresa_id, metodo, valor, status, id_externo, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [crypto.randomUUID(), empresaId, metodo, valor, status, idExterno, usuarioId]
  );
  return rows[0].id;
}

const pagamento = (id, extra = {}) => ({
  id: Number(id), status: 'approved', transaction_amount: 100,
  transaction_details: { net_received_amount: 98.51 },
  fee_details: [{ type: 'mercadopago_fee', amount: 0.99 }, { type: 'application_fee', amount: 0.5 }],
  money_release_date: iso(-0.0005), date_approved: iso(-0.0005), ...extra
});

beforeAll(async () => {
  empresaA = registro.registrar((await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1,'ativa',$2) RETURNING id`, [`Teste MP A ${sufixo}`, `t-mp-a-${sufixo}`])).rows[0].id);
  empresaB = registro.registrar((await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1,'ativa',$2) RETURNING id`, [`Teste MP B ${sufixo}`, `t-mp-b-${sufixo}`])).rows[0].id);
  const a = await criarUsuario(empresaA, 'admin', 'mp-admin-a');
  adminA = a.token; usuarioAId = a.id;
  vendedorA = (await criarUsuario(empresaA, 'vendedor', 'mp-vend-a')).token;
  adminB = (await criarUsuario(empresaB, 'admin', 'mp-admin-b')).token;
  const conta = await request(app).post('/bancos/contas').set(com(adminA))
    .send({ nome: 'Mercado Pago', tipo: 'CONTA_PAGAMENTO', saldo_inicial: 50, data_saldo_inicial: hoje() });
  expect(conta.status).toBe(201);
  contaId = Number(conta.body.data.id);
});

afterAll(async () => {
  try { await registro.limpar(); } finally { await db.end(); }
});

describe('Bancos: sincronizar Mercado Pago', () => {
  test('vendedor 403; conta de outra empresa 404; corpo com campo extra 400; tipo errado 409', async () => {
    expect((await sincronizar(vendedorA, { conta_bancaria_id: contaId })).status).toBe(403);
    expect((await sincronizar(adminB, { conta_bancaria_id: contaId })).status).toBe(404);
    expect((await sincronizar(adminA, { conta_bancaria_id: contaId, empresa_id: 1 })).status).toBe(400);
    const caixa = await request(app).post('/bancos/contas').set(com(adminA)).send({ nome: 'Caixa', tipo: 'CAIXA' });
    expect((await sincronizar(adminA, { conta_bancaria_id: Number(caixa.body.data.id) })).status).toBe(409);
  });

  test('sem conexão com o Mercado Pago: 409 e nada é lançado', async () => {
    mpService.obterAccessToken.mockRejectedValueOnce(new AppError('Conecte o Mercado Pago.', 409));
    await cobranca(empresaA, usuarioAId, '9000001');
    expect((await sincronizar(adminA, { conta_bancaria_id: contaId })).status).toBe(409);
    expect(await saldo(adminA, contaId)).toBe(50);
  });

  test('lança o líquido na data de liberação; reprocessar não duplica', async () => {
    mpClient.buscarPagamento.mockImplementation(async (_c, { idExterno }) => pagamento(idExterno));
    const r1 = await sincronizar(adminA, { conta_bancaria_id: contaId });
    expect(r1.status).toBe(200);
    expect(r1.body.data).toMatchObject({ entradas: 1, saidas: 0, erros: [], tem_mais: false });
    expect(await saldo(adminA, contaId)).toBeCloseTo(50 + 98.51, 2);

    const r2 = await sincronizar(adminA, { conta_bancaria_id: contaId });
    expect(r2.body.data).toMatchObject({ entradas: 0, saidas: 0, erros: [] });
    expect(await saldo(adminA, contaId)).toBeCloseTo(148.51, 2);

    const mov = (await db.query(`SELECT * FROM movimentos_bancarios WHERE conta_bancaria_id=$1 AND referencia_externa='mp:pay:9000001'`, [contaId])).rows;
    expect(mov).toHaveLength(1);
    expect(mov[0]).toMatchObject({ origem: 'API_BANCO', tipo: 'ENTRADA', empresa_id: String(empresaA) });
    expect(mov[0].observacao).toMatch(/tarifa MP/);
    const conta = (await db.query('SELECT provedor, ultima_sincronizacao_em FROM contas_bancarias WHERE id=$1', [contaId])).rows[0];
    expect(conta.provedor).toBe('mercadopago');
    expect(conta.ultima_sincronizacao_em).not.toBeNull();
  });

  test('liberação futura vai para "a liberar" e não para o saldo atual', async () => {
    await cobranca(empresaA, usuarioAId, '9000002', { metodo: 'cartao_link' });
    mpClient.buscarPagamento.mockImplementation(async (_c, { idExterno }) =>
      pagamento(idExterno, { transaction_details: { net_received_amount: 40 }, money_release_date: iso(10) }));
    const r = await sincronizar(adminA, { conta_bancaria_id: contaId });
    expect(r.body.data.entradas).toBe(1);
    expect(await saldo(adminA, contaId)).toBeCloseTo(148.51, 2);
    expect(await aLiberar(adminA, contaId)).toBeCloseTo(40, 2);
  });

  test('falha em um pagamento não impede os outros e não derruba a execução', async () => {
    await cobranca(empresaA, usuarioAId, '9000003');
    await cobranca(empresaA, usuarioAId, '9000004');
    mpClient.buscarPagamento.mockImplementation(async (_c, { idExterno }) => {
      if (idExterno === '9000003') throw new AppError('O Mercado Pago recusou a operação.', 424);
      return pagamento(idExterno, { transaction_details: { net_received_amount: 10 } });
    });
    const r = await sincronizar(adminA, { conta_bancaria_id: contaId });
    expect(r.status).toBe(200);
    expect(r.body.data.entradas).toBe(1);
    expect(r.body.data.erros).toEqual([{ referencia: 'mp:pay:9000003', erro: 'O Mercado Pago recusou a operação.' }]);
  });

  test('pagamento sem valor líquido ou não aprovado vira erro, sem lançamento', async () => {
    await cobranca(empresaA, usuarioAId, '9000005');
    mpClient.buscarPagamento.mockImplementation(async (_c, { idExterno }) =>
      pagamento(idExterno, { transaction_details: {} }));
    const r = await sincronizar(adminA, { conta_bancaria_id: contaId });
    expect(r.body.data.entradas).toBe(0);
    expect(r.body.data.erros.map((e) => e.referencia)).toContain('mp:pay:9000005');
    const n = (await db.query(`SELECT COUNT(*)::int n FROM movimentos_bancarios WHERE referencia_externa='mp:pay:9000005'`)).rows[0].n;
    expect(n).toBe(0);
  });

  test('devolução concluída vira saída; cobranças de outra empresa e anteriores ao saldo inicial não entram', async () => {
    const cb = await cobranca(empresaA, usuarioAId, '9000006', { status: 'estornado' });
    await db.query(
      `INSERT INTO cobranca_devolucoes (empresa_id, cobranca_id, valor, status, motivo, solicitado_por) VALUES ($1,$2,30,'concluida','teste',$3)`,
      [empresaA, cb, usuarioAId]
    );
    const antiga = await cobranca(empresaA, usuarioAId, '9000007');
    await db.query(`UPDATE cobrancas_pagamento SET criado_em = NOW() - INTERVAL '40 days' WHERE id=$1`, [antiga]);
    const { rows: u } = await db.query(`SELECT id FROM usuarios WHERE empresa_id=$1 LIMIT 1`, [empresaB]);
    await cobranca(empresaB, u[0].id, '9000008');

    mpClient.buscarPagamento.mockImplementation(async (_c, { idExterno }) =>
      pagamento(idExterno, { transaction_details: { net_received_amount: 5 } }));
    const antes = await saldo(adminA, contaId);
    const r = await sincronizar(adminA, { conta_bancaria_id: contaId });
    // 9000003 e 9000005 falharam antes e continuam pendentes: entram agora junto com a estornada 9000006.
    expect(r.body.data).toMatchObject({ entradas: 3, saidas: 1 });
    expect(await saldo(adminA, contaId)).toBeCloseTo(antes + 15 - 30, 2);
    const chamadas = mpClient.buscarPagamento.mock.calls.map((c) => c[1].idExterno);
    expect(chamadas).not.toContain('9000007');
    expect(chamadas).not.toContain('9000008');
  });
});

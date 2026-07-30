jest.mock('../../src/services/contasReceberService');

const request = require('supertest');
const contasReceberService = require('../../src/services/contasReceberService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedorToken = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('access control (admin only)', () => {
  const requests = [
    ['get', '/contas-receber'],
    ['get', '/contas-receber/1'],
    ['patch', '/contas-receber/1/receber']
  ];

  test.each(requests)('%s %s returns 401 without a token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  test.each(requests)('%s %s returns 403 for a vendedor', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });

  test.each(requests)('%s %s returns 403 for an estoquista', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /contas-receber (list + filters)', () => {
  const paginatedResult = {
    items: [{ id: 1, descricao: 'Venda #1', valor: '150.00', status: 'pendente', data_vencimento: '2026-08-10', atrasado: false }],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1
  };

  test('returns 200 with the wrapped list for an admin', async () => {
    contasReceberService.listar.mockResolvedValue(paginatedResult);

    const res = await request(app).get('/contas-receber').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: paginatedResult });
  });

  test('forwards a status filter', async () => {
    contasReceberService.listar.mockResolvedValue(paginatedResult);

    await request(app).get('/contas-receber?status=recebido').set('Authorization', `Bearer ${adminToken}`);

    expect(contasReceberService.listar).toHaveBeenCalledWith(expect.objectContaining({ status: 'recebido' }), 1);
  });

  test('returns 400 for an invalid status filter', async () => {
    const res = await request(app).get('/contas-receber?status=pago').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(contasReceberService.listar).not.toHaveBeenCalled();
  });

  test('forwards a vencimento_de/vencimento_ate date range', async () => {
    contasReceberService.listar.mockResolvedValue(paginatedResult);

    await request(app)
      .get('/contas-receber?vencimento_de=2026-01-01&vencimento_ate=2026-12-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(contasReceberService.listar).toHaveBeenCalledWith(expect.objectContaining({
      vencimentoDe: '2026-01-01',
      vencimentoAte: '2026-12-31'
    }), 1);
  });
});

describe('GET /contas-receber/:id', () => {
  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/contas-receber/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 404 when the service throws', async () => {
    contasReceberService.buscarPorId.mockRejectedValue(new AppError('Conta a receber não encontrada', 404));

    const res = await request(app).get('/contas-receber/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with the conta for an admin', async () => {
    const conta = { id: 1, descricao: 'Venda #1', valor: '150.00', status: 'pendente', atrasado: false };
    contasReceberService.buscarPorId.mockResolvedValue(conta);

    const res = await request(app).get('/contas-receber/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(conta);
  });
});

describe('PATCH /contas-receber/:id/receber', () => {
  test('returns 200 and marks the conta recebida for an admin', async () => {
    contasReceberService.marcarComoRecebida.mockResolvedValue({ id: 1, status: 'recebido', data_recebimento: '2026-07-27' });

    const res = await request(app).patch('/contas-receber/1/receber').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('recebido');
  });

  test('returns 409 when the conta is not pendente', async () => {
    contasReceberService.marcarComoRecebida.mockRejectedValue(
      new AppError('Somente contas pendentes podem ser marcadas como recebidas', 409)
    );

    const res = await request(app).patch('/contas-receber/1/receber').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });
});

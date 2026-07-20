jest.mock('../../src/services/vendasService');

const request = require('supertest');
const vendasService = require('../../src/services/vendasService');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const token = makeToken({ id: 1, role: 'vendedor' });

beforeEach(() => {
  jest.clearAllMocks();
});

test('GET /vendas/resumo returns 401 without a token', async () => {
  const res = await request(app).get('/vendas/resumo');
  expect(res.status).toBe(401);
});

test('GET /vendas/resumo returns the wrapped summary', async () => {
  vendasService.resumo.mockResolvedValue({ total_vendas: 3, faturamento: 100 });

  const res = await request(app).get('/vendas/resumo').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: { total_vendas: 3, faturamento: 100 } });
});

describe('POST /vendas', () => {
  test('returns 400 when itens is empty', async () => {
    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: 1, itens: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A venda deve ter ao menos um item');
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 and the created venda on success', async () => {
    vendasService.criar.mockResolvedValue({ id: 1, cliente_id: 1, total: 10 });

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 10 }] });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: 1, cliente_id: 1, total: 10 });
    expect(vendasService.criar).toHaveBeenCalledWith(1, [
      { produto_id: 1, quantidade: 1, preco_unitario: 10 }
    ]);
  });

  test('returns 500 when the service/transaction fails', async () => {
    vendasService.criar.mockRejectedValue(new Error('foreign key violation'));

    const res = await request(app)
      .post('/vendas')
      .set('Authorization', `Bearer ${token}`)
      .send({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 10 }] });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

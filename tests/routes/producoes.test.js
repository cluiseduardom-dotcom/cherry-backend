jest.mock('../../src/services/producoesService');

const request = require('supertest');
const producoesService = require('../../src/services/producoesService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => jest.clearAllMocks());

describe('access control (admin + estoquista only)', () => {
  const requests = [
    ['get', '/producoes'],
    ['post', '/producoes'],
    ['get', '/producoes/1'],
    ['patch', '/producoes/1/cancelar']
  ];

  test.each(requests)('%s %s returns 401 without a token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  test.each(requests)('%s %s returns 403 for a vendedor', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /producoes', () => {
  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 1 });

    expect(res.status).toBe(400);
    expect(producoesService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 with a full quantidade_produzida for an admin', async () => {
    producoesService.criar.mockResolvedValue({ id: 1, quantidade_solicitada: 10, quantidade_produzida: 10, parcial: false });

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data.parcial).toBe(false);
  });

  test('returns 201 flagged parcial for an estoquista when stock only allows part of it', async () => {
    producoesService.criar.mockResolvedValue({ id: 1, quantidade_solicitada: 10, quantidade_produzida: 6, parcial: true });

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data.quantidade_produzida).toBe(6);
    expect(res.body.data.parcial).toBe(true);
  });

  test('returns 409 when no insumo has stock for even 1 unit', async () => {
    producoesService.criar.mockRejectedValue(new AppError('Estoque insuficiente para produzir ao menos uma unidade', 409));

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(409);
  });

  test('returns 400 when the produto has no ficha técnica cadastrada', async () => {
    producoesService.criar.mockRejectedValue(new AppError('Produto não possui ficha técnica cadastrada', 400));

    const res = await request(app)
      .post('/producoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ produto_id: 5, quantidade_solicitada: 10 });

    expect(res.status).toBe(400);
  });
});

describe('GET /producoes/:id', () => {
  test('returns 404 when the producao does not exist (or belongs to another empresa)', async () => {
    producoesService.buscarPorId.mockRejectedValue(new AppError('Produção não encontrada', 404));

    const res = await request(app).get('/producoes/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with custo_total visible for an admin', async () => {
    producoesService.buscarPorId.mockResolvedValue({
      id: 1, produto_id: 5, custo_total: 60,
      itens: [{ insumo_produto_id: 2, custo_unitario: 10, subtotal_custo: 60 }]
    });

    const res = await request(app).get('/producoes/1').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.custo_total).toBe(60);
  });

  test('returns 200 with custo_total and item custo hidden for an estoquista', async () => {
    producoesService.buscarPorId.mockResolvedValue({
      id: 1, produto_id: 5, custo_total: 60,
      itens: [{ insumo_produto_id: 2, custo_unitario: 10, subtotal_custo: 60 }]
    });

    const res = await request(app).get('/producoes/1').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.custo_total).toBeUndefined();
    expect(res.body.data.itens[0].custo_unitario).toBeUndefined();
    expect(res.body.data.itens[0].insumo_produto_id).toBe(2);
  });
});

describe('PATCH /producoes/:id/cancelar', () => {
  test('returns 200 and cancels for an admin', async () => {
    producoesService.cancelar.mockResolvedValue({ id: 1, status: 'cancelada' });

    const res = await request(app).patch('/producoes/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelada');
  });

  test('returns 409 when the acabado stock cannot absorb the estorno', async () => {
    producoesService.cancelar.mockRejectedValue(new AppError('Estoque insuficiente para estornar esta produção', 409));

    const res = await request(app).patch('/producoes/1/cancelar').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
  });
});

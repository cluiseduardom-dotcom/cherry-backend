jest.mock('../../src/services/fichasTecnicasService');

const request = require('supertest');
const fichasTecnicasService = require('../../src/services/fichasTecnicasService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => jest.clearAllMocks());

describe('access control', () => {
  const requests = [
    ['post', '/produtos/1/ficha-tecnica'],
    ['get', '/produtos/1/ficha-tecnica'],
    ['get', '/produtos/1/ficha-tecnica/historico']
  ];

  test.each(requests)('%s %s returns 403 for a vendedor', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });

  test('GET .../historico returns 403 for an estoquista (admin only)', async () => {
    const res = await request(app).get('/produtos/1/ficha-tecnica/historico').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /produtos/:id/ficha-tecnica', () => {
  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [] });

    expect(res.status).toBe(400);
    expect(fichasTecnicasService.criar).not.toHaveBeenCalled();
  });

  test('returns 201 for an admin, with custo_sugerido visible', async () => {
    fichasTecnicasService.criar.mockResolvedValue({
      id: 1, produto_id: 1, vigente: true, custo_sugerido: 40,
      itens: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 2, custo_unitario: 10, subtotal_custo: 20 }]
    });

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.custo_sugerido).toBe(40);
  });

  test('returns 201 for an estoquista, with custo_sugerido and item custo hidden', async () => {
    fichasTecnicasService.criar.mockResolvedValue({
      id: 1, produto_id: 1, vigente: true, custo_sugerido: 40,
      itens: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 2, custo_unitario: 10, subtotal_custo: 20 }]
    });

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.custo_sugerido).toBeUndefined();
    expect(res.body.data.itens[0].custo_unitario).toBeUndefined();
    expect(res.body.data.itens[0].subtotal_custo).toBeUndefined();
    expect(res.body.data.itens[0].insumo_produto_id).toBe(2);
  });

  test('returns 404 when the produto belongs to another empresa', async () => {
    fichasTecnicasService.criar.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(404);
  });

  test('returns 400 when the produto is not tipo acabado', async () => {
    fichasTecnicasService.criar.mockRejectedValue(new AppError("Produto deve ser do tipo 'acabado' para ter ficha técnica", 400));

    const res = await request(app)
      .post('/produtos/1/ficha-tecnica')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itens: [{ insumo_produto_id: 2, quantidade_necessaria: 2 }] });

    expect(res.status).toBe(400);
  });
});

describe('GET /produtos/:id/ficha-tecnica', () => {
  test('returns 404 when there is no vigente ficha', async () => {
    fichasTecnicasService.buscarVigente.mockRejectedValue(new AppError('Ficha técnica não encontrada', 404));

    const res = await request(app).get('/produtos/1/ficha-tecnica').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('returns 200 with custo hidden for an estoquista', async () => {
    fichasTecnicasService.buscarVigente.mockResolvedValue({
      id: 1, produto_id: 1, custo_sugerido: 40, itens: [{ id: 1, insumo_produto_id: 2, quantidade_necessaria: 2, custo_unitario: 10, subtotal_custo: 20 }]
    });

    const res = await request(app).get('/produtos/1/ficha-tecnica').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.custo_sugerido).toBeUndefined();
  });
});

describe('GET /produtos/:id/ficha-tecnica/historico', () => {
  test('returns 200 with the full version list for an admin', async () => {
    fichasTecnicasService.historico.mockResolvedValue([
      { id: 2, vigente: true, custo_sugerido: 40 },
      { id: 1, vigente: false, custo_sugerido: 35 }
    ]);

    const res = await request(app).get('/produtos/1/ficha-tecnica/historico').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].custo_sugerido).toBe(40);
  });
});

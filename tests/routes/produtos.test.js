jest.mock('../../src/services/produtosService');

const request = require('supertest');
const produtosService = require('../../src/services/produtosService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const token = makeToken({ id: 1, role: 'vendedor' });

beforeEach(() => {
  jest.clearAllMocks();
});

test('GET /produtos returns 401 without a token', async () => {
  const res = await request(app).get('/produtos');
  expect(res.status).toBe(401);
});

test('GET /produtos returns the wrapped list on success', async () => {
  produtosService.listar.mockResolvedValue([{ id: 1, nome: 'Camiseta' }]);

  const res = await request(app).get('/produtos').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: [{ id: 1, nome: 'Camiseta' }] });
});

test('POST /produtos returns 400 for an invalid body', async () => {
  const res = await request(app)
    .post('/produtos')
    .set('Authorization', `Bearer ${token}`)
    .send({ nome: 'X' });

  expect(res.status).toBe(400);
  expect(res.body.message).toBe('Preço de venda é obrigatório');
  expect(produtosService.criar).not.toHaveBeenCalled();
});

test('POST /produtos returns 201 and the created produto on success', async () => {
  produtosService.criar.mockResolvedValue({ id: 1, nome: 'X', preco_venda: 10, custo: 5 });

  const res = await request(app)
    .post('/produtos')
    .set('Authorization', `Bearer ${token}`)
    .send({ nome: 'X', preco_venda: 10, custo: 5 });

  expect(res.status).toBe(201);
  expect(res.body.data.id).toBe(1);
});

describe('read-only sub-routes', () => {
  const cases = [
    ['/produtos/mais-vendidos', 'maisVendidos'],
    ['/produtos/curva-abc', 'curvaABC'],
    ['/produtos/reposicao', 'reposicao'],
    ['/produtos/sugestao-preco', 'sugestaoPreco'],
    ['/produtos/giro', 'giro'],
    ['/produtos/parados', 'parados'],
    ['/produtos/pricing', 'pricingProfissional'],
    ['/produtos/pricing-profissional', 'pricingProfissional'],
    ['/produtos/lucro', 'lucroPorProduto'],
    ['/produtos/alerta-prejuizo', 'alertaPrejuizo'],
    ['/produtos/inteligencia', 'inteligencia'],
    ['/produtos/dashboard', 'dashboard']
  ];

  test.each(cases)('GET %s calls service.%s and wraps the result', async (path, serviceMethod) => {
    produtosService[serviceMethod].mockResolvedValue({ ok: true });

    const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true } });
    expect(produtosService[serviceMethod]).toHaveBeenCalled();
  });
});

test('a thrown AppError from the service maps to its status code', async () => {
  produtosService.listar.mockRejectedValue(new AppError('boom', 404));

  const res = await request(app).get('/produtos').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ success: false, message: 'boom' });
});

jest.mock('../../src/services/pontoEquilibrioService');

const request = require('supertest');
const pontoEquilibrioService = require('../../src/services/pontoEquilibrioService');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedorToken = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('access control (admin only)', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).get('/financeiro/ponto-equilibrio');
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app).get('/financeiro/ponto-equilibrio').set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });

  test('returns 403 for an estoquista', async () => {
    const res = await request(app).get('/financeiro/ponto-equilibrio').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /financeiro/ponto-equilibrio', () => {
  const resultadoMock = {
    periodo: { inicio: '2026-08-01', fim: '2026-08-19' },
    receita: 20000,
    custoVariavelTotal: 9000,
    margemContribuicao: 0.55,
    custoFixoTotal: 6000,
    pontoEquilibrio: 10909.09,
    faltaParaAtingir: 0,
    inviavel: false
  };

  test('returns 200 with the calculated result for an admin', async () => {
    pontoEquilibrioService.calcular.mockResolvedValue(resultadoMock);

    const res = await request(app).get('/financeiro/ponto-equilibrio').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: resultadoMock });
  });

  test('defaults to mês corrente (dia 1 até hoje) when no period is given', async () => {
    pontoEquilibrioService.calcular.mockResolvedValue(resultadoMock);

    await request(app).get('/financeiro/ponto-equilibrio').set('Authorization', `Bearer ${adminToken}`);

    const [periodo, empresaId] = pontoEquilibrioService.calcular.mock.calls[0];
    expect(empresaId).toBe(1);
    expect(periodo.dataInicio).toMatch(/^\d{4}-\d{2}-01$/);
    expect(periodo.dataFim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('forwards data_inicio/data_fim when provided', async () => {
    pontoEquilibrioService.calcular.mockResolvedValue(resultadoMock);

    await request(app)
      .get('/financeiro/ponto-equilibrio?data_inicio=2026-01-01&data_fim=2026-01-31')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(pontoEquilibrioService.calcular).toHaveBeenCalledWith(
      { dataInicio: '2026-01-01', dataFim: '2026-01-31' }, 1
    );
  });

  test('returns 400 when data_inicio is after data_fim', async () => {
    const res = await request(app)
      .get('/financeiro/ponto-equilibrio?data_inicio=2026-08-19&data_fim=2026-08-01')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(pontoEquilibrioService.calcular).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid date', async () => {
    const res = await request(app)
      .get('/financeiro/ponto-equilibrio?data_inicio=not-a-date')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });
});

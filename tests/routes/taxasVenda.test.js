jest.mock('../../src/services/taxasVendaService');

const request = require('supertest');
const taxasVendaService = require('../../src/services/taxasVendaService');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 7 });
const vendedorToken = makeToken({ id: 2, role: 'vendedor', empresa_id: 7 });
const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 7 });

const RESPOSTA = {
  items: [{ id: 1, venda_id: 5, percentual: '0.1500', base_calculo: '100.00', valor: '0.15', status: 'apurada' }],
  totais: { total_base: '100.00', total_taxa: '0.15' },
  page: 1, pageSize: 20, total: 1, totalPages: 1
};

beforeEach(() => {
  jest.clearAllMocks();
  taxasVendaService.listar.mockResolvedValue(RESPOSTA);
});

describe('GET /financeiro/taxas-venda — controle de acesso (admin da loja apenas)', () => {
  test('401 sem token', async () => {
    const res = await request(app).get('/financeiro/taxas-venda');
    expect(res.status).toBe(401);
    expect(taxasVendaService.listar).not.toHaveBeenCalled();
  });

  test('403 para vendedor', async () => {
    const res = await request(app).get('/financeiro/taxas-venda').set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
    expect(taxasVendaService.listar).not.toHaveBeenCalled();
  });

  test('403 para estoquista', async () => {
    const res = await request(app).get('/financeiro/taxas-venda').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
    expect(taxasVendaService.listar).not.toHaveBeenCalled();
  });

  test('200 para admin, no formato { success, data }', async () => {
    const res = await request(app).get('/financeiro/taxas-venda').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: RESPOSTA });
  });
});

describe('GET /financeiro/taxas-venda — isolamento por empresa e validação', () => {
  test('empresa_id vem SEMPRE do JWT; empresa_id na query é ignorado', async () => {
    await request(app)
      .get('/financeiro/taxas-venda?empresa_id=999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(taxasVendaService.listar).toHaveBeenCalledTimes(1);
    const [filtros, empresaId] = taxasVendaService.listar.mock.calls[0];
    expect(empresaId).toBe(7);
    expect(filtros).not.toHaveProperty('empresa_id');
  });

  test('repassa período e paginação normalizados', async () => {
    await request(app)
      .get('/financeiro/taxas-venda?data_inicio=2026-10-01&data_fim=2026-10-31&page=2&pageSize=500')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(taxasVendaService.listar).toHaveBeenCalledWith(
      { page: 2, pageSize: 100, data_inicio: '2026-10-01', data_fim: '2026-10-31' },
      7
    );
  });

  test('paginação padrão (página 1, 20 itens)', async () => {
    await request(app).get('/financeiro/taxas-venda').set('Authorization', `Bearer ${adminToken}`);

    expect(taxasVendaService.listar).toHaveBeenCalledWith({ page: 1, pageSize: 20 }, 7);
  });

  test.each([
    ['data_inicio=31-10-2026', 'Data inicial inválida'],
    ['data_fim=2026-13-40', 'Data final inválida'],
    ['data_inicio=2026-10-31&data_fim=2026-10-01', 'Data inicial não pode ser depois da data final']
  ])('400 para período inválido (%s)', async (query, mensagem) => {
    const res = await request(app).get(`/financeiro/taxas-venda?${query}`).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: mensagem });
    expect(taxasVendaService.listar).not.toHaveBeenCalled();
  });
});

describe('a taxa interna não tem rota de escrita nem de política para o tenant', () => {
  test.each([
    ['post', '/financeiro/taxas-venda'],
    ['put', '/financeiro/taxas-venda/1'],
    ['patch', '/financeiro/taxas-venda/1'],
    ['delete', '/financeiro/taxas-venda/1'],
    ['get', '/financeiro/politicas-taxa'],
    ['post', '/financeiro/politicas-taxa'],
    ['put', '/financeiro/politicas-taxa/1'],
    ['get', '/politicas-taxa-plataforma'],
    ['post', '/politicas-taxa-plataforma']
  ])('%s %s não existe (404) mesmo para admin da loja', async (metodo, caminho) => {
    const res = await request(app)[metodo](caminho).set('Authorization', `Bearer ${adminToken}`).send({ percentual: 0 });

    expect(res.status).toBe(404);
  });
});

jest.mock('../../src/services/dashboardService');

const request = require('supertest');
const dashboardService = require('../../src/services/dashboardService');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const sessaoBase = { ativo: true, token_version: 0, empresa_status: 'ativa', funcionalidades: [] };

// Cargos sem linha em cargos_empresa usam o padrão do catálogo (agora todos ligados).
const sessaoDoCargo = (papel) => ({ ...sessaoBase, papel, cargo_configurado: false });

const tokens = {
  diretor: makeToken({ id: 10, role: 'diretor', empresa_id: 7 }),
  gerente: makeToken({ id: 11, role: 'gerente', empresa_id: 7 }),
  coordenador: makeToken({ id: 12, role: 'coordenador', empresa_id: 7 }),
  supervisor: makeToken({ id: 13, role: 'supervisor', empresa_id: 7 }),
  analista: makeToken({ id: 14, role: 'analista', empresa_id: 7 }),
  financeiro: makeToken({ id: 15, role: 'financeiro', empresa_id: 7 }),
  vendedor: makeToken({ id: 16, role: 'vendedor', empresa_id: 7 })
};
const papelPorId = { 10: 'diretor', 11: 'gerente', 12: 'coordenador', 13: 'supervisor', 14: 'analista', 15: 'financeiro', 16: 'vendedor' };

beforeEach(() => {
  jest.resetAllMocks();
  sessaoRepository.buscarEstado.mockImplementation(async (id) => sessaoDoCargo(papelPorId[id]));
});

describe('Dashboard por capacidade (ver_dashboard ou ver_custos)', () => {
  test.each(['diretor', 'gerente', 'coordenador', 'analista', 'financeiro'])('200 para %s', async (cargo) => {
    dashboardService.resumo.mockResolvedValue({ ok: true });

    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokens[cargo]}`);

    expect(res.status).toBe(200);
  });

  test.each(['supervisor', 'vendedor'])('403 para %s (sem ver_dashboard nem ver_custos)', async (cargo) => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokens[cargo]}`);

    expect(res.status).toBe(403);
    expect(dashboardService.resumo).not.toHaveBeenCalled();
  });

  test('quem tem ver_custos recebe a margem; quem só tem ver_dashboard, não', async () => {
    dashboardService.resumo.mockResolvedValue({});

    await request(app).get('/dashboard').set('Authorization', `Bearer ${tokens.gerente}`);
    await request(app).get('/dashboard').set('Authorization', `Bearer ${tokens.analista}`);

    expect(dashboardService.resumo).toHaveBeenNthCalledWith(1, 90, 7, { incluirMargem: true });
    expect(dashboardService.resumo).toHaveBeenNthCalledWith(2, 90, 7, { incluirMargem: false });
  });

  test('/dashboard/margem exige ver_custos: analista leva 403, gerente 200', async () => {
    dashboardService.margem.mockResolvedValue([]);

    const negado = await request(app).get('/dashboard/margem').set('Authorization', `Bearer ${tokens.analista}`);
    const ok = await request(app).get('/dashboard/margem').set('Authorization', `Bearer ${tokens.gerente}`);

    expect(negado.status).toBe(403);
    expect(ok.status).toBe(200);
    expect(dashboardService.margem).toHaveBeenCalledTimes(1);
  });
});

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
  analista: makeToken({ id: 14, role: 'analista', empresa_id: 7 })
};
const papelPorId = { 10: 'diretor', 11: 'gerente', 12: 'coordenador', 13: 'supervisor', 14: 'analista' };

beforeEach(() => {
  jest.resetAllMocks();
  sessaoRepository.buscarEstado.mockImplementation(async (id) => sessaoDoCargo(papelPorId[id]));
});

describe('Dashboard por capacidade ver_custos', () => {
  test.each(['diretor', 'gerente', 'coordenador'])('200 para %s (tem ver_custos)', async (cargo) => {
    dashboardService.resumo.mockResolvedValue({ ok: true });

    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokens[cargo]}`);

    expect(res.status).toBe(200);
    expect(dashboardService.resumo).toHaveBeenCalledWith(90, 7);
  });

  test.each(['supervisor', 'analista'])('403 para %s (sem ver_custos: o resumo traz margem)', async (cargo) => {
    const res = await request(app).get('/dashboard').set('Authorization', `Bearer ${tokens[cargo]}`);

    expect(res.status).toBe(403);
    expect(dashboardService.resumo).not.toHaveBeenCalled();
  });
});

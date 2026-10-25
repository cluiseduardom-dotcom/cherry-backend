jest.mock('../../src/services/comissoesService');

const request = require('supertest');
const comissoesService = require('../../src/services/comissoesService');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 7 });
const vendedorToken = makeToken({ id: 2, role: 'vendedor', empresa_id: 7 });
const estoquistaToken = makeToken({ id: 3, role: 'estoquista', empresa_id: 7 });
const gerenteToken = makeToken({ id: 4, role: 'gerente', empresa_id: 7 });
const supervisorToken = makeToken({ id: 5, role: 'supervisor', empresa_id: 7 });
const financeiroToken = makeToken({ id: 6, role: 'financeiro', empresa_id: 7 });

const sessaoBase = { ativo: true, token_version: 0, empresa_status: 'ativa' };

beforeEach(() => {
  jest.resetAllMocks();
  // Gerente é um cargo ligado pelo admin do comércio (ativo_padrao = false no catálogo).
  const cargoLigado = (papel, nivel, capacidades) => ({
    ...sessaoBase,
    papel,
    cargo_configurado: true,
    cargo_nivel: nivel,
    cargo_ativo: true,
    cargo_capacidades: capacidades
  });
  const sessoes = {
    4: cargoLigado('gerente', 70, ['ver_vendas_de_todos', 'gerir_financeiro']),
    // Supervisor vê a equipe, mas NÃO mexe no dinheiro (sem gerir_financeiro).
    5: cargoLigado('supervisor', 50, ['ver_vendas_de_todos']),
    6: cargoLigado('financeiro', null, ['ver_vendas_de_todos', 'gerir_financeiro'])
  };
  sessaoRepository.buscarEstado.mockImplementation(async (usuarioId) => sessoes[usuarioId] || sessaoBase);
});

describe('GET /comissoes/minhas', () => {
  test('401 sem token', async () => {
    const res = await request(app).get('/comissoes/minhas');
    expect(res.status).toBe(401);
  });

  test('403 para estoquista', async () => {
    const res = await request(app).get('/comissoes/minhas').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
    expect(comissoesService.minhas).not.toHaveBeenCalled();
  });

  test('o vendedor consulta sempre o PRÓPRIO usuário do token, ignorando usuario_id da query', async () => {
    comissoesService.minhas.mockResolvedValue({ items: [], totais: {}, page: 1, pageSize: 20, total: 0, totalPages: 1 });

    const res = await request(app)
      .get('/comissoes/minhas?usuario_id=99&empresa_id=1')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    const [, usuario] = comissoesService.minhas.mock.calls[0];
    expect(usuario.id).toBe(2);
    expect(usuario.empresa_id).toBe(7);
  });

  test('400 para período inválido', async () => {
    const res = await request(app)
      .get('/comissoes/minhas?data_inicio=2026-10-31&data_fim=2026-10-01')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(400);
    expect(comissoesService.minhas).not.toHaveBeenCalled();
  });
});

describe('GET /comissoes/equipe', () => {
  test('403 para vendedor comum (sem ver_vendas_de_todos)', async () => {
    const res = await request(app).get('/comissoes/equipe').set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
    expect(comissoesService.equipe).not.toHaveBeenCalled();
  });

  test('403 para estoquista', async () => {
    const res = await request(app).get('/comissoes/equipe').set('Authorization', `Bearer ${estoquistaToken}`);
    expect(res.status).toBe(403);
  });

  test('200 para admin, usando a empresa do token', async () => {
    comissoesService.equipe.mockResolvedValue({ items: [], totais: {} });

    const res = await request(app).get('/comissoes/equipe').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(comissoesService.equipe).toHaveBeenCalledWith({}, 7);
  });

  test('200 para gerente (cargo com ver_vendas_de_todos)', async () => {
    comissoesService.equipe.mockResolvedValue({ items: [], totais: {} });

    const res = await request(app).get('/comissoes/equipe').set('Authorization', `Bearer ${gerenteToken}`);

    expect(res.status).toBe(200);
  });
});

describe('percentuais (somente admin)', () => {
  test.each([
    ['vendedor', vendedorToken],
    ['gerente', gerenteToken],
    ['estoquista', estoquistaToken]
  ])('GET e PUT dão 403 para %s', async (_papel, token) => {
    const get = await request(app).get('/comissoes/percentuais').set('Authorization', `Bearer ${token}`);
    const put = await request(app).put('/comissoes/percentuais').set('Authorization', `Bearer ${token}`).send({ usuario_id: 2, percentual: 5 });

    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
    expect(comissoesService.listarPercentuais).not.toHaveBeenCalled();
    expect(comissoesService.definirPercentual).not.toHaveBeenCalled();
  });

  test('GET 200 para admin, usando a empresa do token', async () => {
    comissoesService.listarPercentuais.mockResolvedValue({ padrao: null, usuarios: [] });

    const res = await request(app).get('/comissoes/percentuais').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(comissoesService.listarPercentuais).toHaveBeenCalledWith(7);
  });

  test('PUT 200 grava o percentual do vendedor', async () => {
    comissoesService.definirPercentual.mockResolvedValue({ usuario_id: 2, percentual: '5.0000' });

    const res = await request(app)
      .put('/comissoes/percentuais')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ usuario_id: 2, percentual: 5 });

    expect(res.status).toBe(200);
    const [dados, usuario] = comissoesService.definirPercentual.mock.calls[0];
    expect(dados).toEqual({ usuario_id: 2, percentual: 5 });
    expect(usuario.empresa_id).toBe(7);
  });

  test.each([
    [{ usuario_id: 2, percentual: 101 }],
    [{ usuario_id: 2, percentual: -1 }],
    [{ usuario_id: 2, percentual: '5' }],
    [{ usuario_id: 2 }],
    [{ usuario_id: 2, percentual: 5.00001 }],
    [{ usuario_id: 0, percentual: 5 }],
    [{ usuario_id: 2, percentual: 5, empresa_id: 1 }]
  ])('PUT 400 para corpo inválido %j', async (corpo) => {
    const res = await request(app)
      .put('/comissoes/percentuais')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(corpo);

    expect(res.status).toBe(400);
    expect(comissoesService.definirPercentual).not.toHaveBeenCalled();
  });
});

describe('GET /comissoes/repasses', () => {
  test('401 sem token; 403 para estoquista', async () => {
    expect((await request(app).get('/comissoes/repasses')).status).toBe(401);
    expect((await request(app).get('/comissoes/repasses').set('Authorization', `Bearer ${estoquistaToken}`)).status).toBe(403);
  });

  test('vendedor consulta com o usuário do token (o service decide o escopo), status validado', async () => {
    comissoesService.repasses.mockResolvedValue({ items: [], totais: {}, page: 1, pageSize: 20, total: 0, totalPages: 1 });

    const ok = await request(app).get('/comissoes/repasses?status=a_repassar&vendedor_id=99').set('Authorization', `Bearer ${vendedorToken}`);
    expect(ok.status).toBe(200);
    const [filtros, usuario] = comissoesService.repasses.mock.calls[0];
    expect(filtros).toMatchObject({ status: 'a_repassar', page: 1, pageSize: 20 });
    expect(filtros).not.toHaveProperty('vendedor_id');
    expect(usuario.id).toBe(2);

    const ruim = await request(app).get('/comissoes/repasses?status=qualquer').set('Authorization', `Bearer ${vendedorToken}`);
    expect(ruim.status).toBe(400);
  });
});

describe('POST /comissoes/repasses/:id/confirmar', () => {
  test('401 sem token; 403 sem `gerir_financeiro` (vendedor, estoquista, supervisor que só vê a equipe)', async () => {
    expect((await request(app).post('/comissoes/repasses/5/confirmar').send({})).status).toBe(401);

    for (const token of [vendedorToken, estoquistaToken, supervisorToken]) {
      const res = await request(app).post('/comissoes/repasses/5/confirmar').set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(403);
    }

    expect(comissoesService.confirmarRepasse).not.toHaveBeenCalled();
  });

  test('gerente, analista financeiro e admin confirmam, com o usuário do token como autor', async () => {
    comissoesService.confirmarRepasse.mockResolvedValue({ id: 5, status: 'confirmado' });

    for (const token of [gerenteToken, financeiroToken, adminToken]) {
      const res = await request(app).post('/comissoes/repasses/5/confirmar').set('Authorization', `Bearer ${token}`).send({ observacao: 'Recebi' });
      expect(res.status).toBe(200);
    }

    expect(comissoesService.confirmarRepasse).toHaveBeenCalledWith(5, { observacao: 'Recebi' }, expect.objectContaining({ id: 4, empresa_id: 7 }));
    expect(comissoesService.confirmarRepasse).toHaveBeenCalledWith(5, { observacao: 'Recebi' }, expect.objectContaining({ id: 6, empresa_id: 7 }));
  });

  test('400 para id inválido e para campo desconhecido (strict)', async () => {
    expect((await request(app).post('/comissoes/repasses/abc/confirmar').set('Authorization', `Bearer ${adminToken}`).send({})).status).toBe(400);
    expect((await request(app).post('/comissoes/repasses/5/confirmar').set('Authorization', `Bearer ${adminToken}`).send({ confirmado_por: 1 })).status).toBe(400);
  });
});

describe('GET /comissoes/:id/historico', () => {
  test('401 sem token; 403 para estoquista; 400 para id inválido', async () => {
    expect((await request(app).get('/comissoes/5/historico')).status).toBe(401);
    expect((await request(app).get('/comissoes/5/historico').set('Authorization', `Bearer ${estoquistaToken}`)).status).toBe(403);
    expect((await request(app).get('/comissoes/abc/historico').set('Authorization', `Bearer ${vendedorToken}`)).status).toBe(400);
  });

  test('vendedor consulta passando o próprio usuário (o escopo é decidido no service/repository)', async () => {
    comissoesService.historico.mockResolvedValue({ comissao: { id: 5 }, eventos: [] });

    const res = await request(app).get('/comissoes/5/historico').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(comissoesService.historico).toHaveBeenCalledWith(5, expect.objectContaining({ id: 2, empresa_id: 7 }));
  });

  test('"percentuais" e "equipe" não são capturados pela rota :id', async () => {
    comissoesService.listarPercentuais.mockResolvedValue({ padrao: null, usuarios: [] });

    expect((await request(app).get('/comissoes/percentuais').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect(comissoesService.historico).not.toHaveBeenCalled();
  });
});

describe('pagamento de comissão: GET /comissoes/a-pagar e POST /comissoes/pagamentos', () => {
  const corpo = { vendedor_id: 2, valor_esperado: 10, forma: 'pix', pago_em: '2026-10-01' };

  test('403 sem `gerir_financeiro` (vendedor, estoquista, supervisor); 401 sem token', async () => {
    expect((await request(app).get('/comissoes/a-pagar')).status).toBe(401);

    for (const token of [vendedorToken, estoquistaToken, supervisorToken]) {
      expect((await request(app).get('/comissoes/a-pagar').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect((await request(app).post('/comissoes/pagamentos').set('Authorization', `Bearer ${token}`).send(corpo)).status).toBe(403);
    }

    expect(comissoesService.aPagar).not.toHaveBeenCalled();
    expect(comissoesService.registrarPagamento).not.toHaveBeenCalled();
  });

  test('analista financeiro, gerente e admin acessam; quem paga é o usuário do token', async () => {
    comissoesService.aPagar.mockResolvedValue({ items: [], totais: { a_pagar: '0.00' } });
    comissoesService.registrarPagamento.mockResolvedValue({ id: 1 });

    for (const token of [financeiroToken, gerenteToken, adminToken]) {
      expect((await request(app).get('/comissoes/a-pagar').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      expect((await request(app).post('/comissoes/pagamentos').set('Authorization', `Bearer ${token}`).send(corpo)).status).toBe(201);
    }

    expect(comissoesService.registrarPagamento).toHaveBeenCalledWith(expect.objectContaining(corpo), expect.objectContaining({ id: 6, empresa_id: 7 }));
  });
});

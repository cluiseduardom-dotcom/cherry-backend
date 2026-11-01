jest.mock('../../src/services/estoqueService');

const request = require('supertest');
const estoqueService = require('../../src/services/estoqueService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /produtos/:id/movimentacoes', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).post('/produtos/1/movimentacoes').send({ tipo: 'entrada', quantidade: 5 });
    expect(res.status).toBe(401);
  });

  test('returns 403 for a vendedor', async () => {
    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ tipo: 'saida', quantidade: 5, motivo_codigo: 'perda' });

    expect(res.status).toBe(403);
    expect(estoqueService.registrarMovimentacao).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'invalido', quantidade: 5 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for a non-numeric produto id', async () => {
    const res = await request(app)
      .post('/produtos/abc/movimentacoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tipo: 'saida', quantidade: 5, motivo_codigo: 'perda' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID inválido');
  });

  test('returns 201 for an estoquista with a valid body', async () => {
    estoqueService.registrarMovimentacao.mockResolvedValue({
      id: 1,
      produto_id: 1,
      tipo: 'saida',
      quantidade: 10,
      estoque_resultante: 10
    });

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'saida', quantidade: 10, motivo_codigo: 'perda' });

    expect(res.status).toBe(201);
    expect(res.body.data.estoque_resultante).toBe(10);
    expect(estoqueService.registrarMovimentacao).toHaveBeenCalledWith(
      1,
      { tipo: 'saida', quantidade: 10, motivo_codigo: 'perda' },
      2,
      1,
      expect.objectContaining({ id: 2, role: 'estoquista', empresa_id: 1 })
    );
  });

  test('returns 201 for an admin too', async () => {
    estoqueService.registrarMovimentacao.mockResolvedValue({ id: 1 });

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tipo: 'ajuste', quantidade: 0, motivo_codigo: 'contagem' });

    expect(res.status).toBe(201);
  });

  test('maps a 409 (insufficient stock) from the service', async () => {
    estoqueService.registrarMovimentacao.mockRejectedValue(
      new AppError('Estoque insuficiente para essa saída', 409)
    );

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'saida', quantidade: 999, motivo_codigo: 'perda' });

    expect(res.status).toBe(409);
  });
});

describe('POST /produtos/:id/movimentacoes: entrada livre deixou de existir', () => {
  test.each([
    [{ tipo: 'entrada', quantidade: 5 }],
    [{ tipo: 'entrada', quantidade: 5, motivo: 'Reposição' }],
    [{ tipo: 'entrada', quantidade: 5, motivo_codigo: 'reposicao' }],
    [{ tipo: 'entrada', quantidade: 5, motivo_codigo: 'compra' }]
  ])('responde 400 e não chega ao serviço: %j', async (corpo) => {
    for (const token of [estoquistaToken, adminToken]) {
      const res = await request(app).post('/produtos/1/movimentacoes').set('Authorization', `Bearer ${token}`).send(corpo);
      expect(res.status).toBe(400);
    }
    expect(estoqueService.registrarMovimentacao).not.toHaveBeenCalled();
  });

  test('recebimento sem compra exige observação', async () => {
    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tipo: 'entrada', quantidade: 5, motivo_codigo: 'recebimento_sem_compra' });

    expect(res.status).toBe(400);
    expect(estoqueService.registrarMovimentacao).not.toHaveBeenCalled();
  });

  test('repassa a falta de permissão do serviço como 403', async () => {
    estoqueService.registrarMovimentacao.mockRejectedValue(new AppError('Sem permissão para receber mercadoria sem compra', 403));

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'entrada', quantidade: 5, motivo_codigo: 'recebimento_sem_compra', observacao: 'Bonificação' });

    expect(res.status).toBe(403);
  });
});

describe('GET /produtos/:id/movimentacoes', () => {
  test('is available to any authenticated role (vendedor)', async () => {
    estoqueService.historicoPorProduto.mockResolvedValue({
      items: [], page: 1, pageSize: 20, total: 0, totalPages: 1
    });

    const res = await request(app)
      .get('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(estoqueService.historicoPorProduto).toHaveBeenCalledWith(1, { page: 1, pageSize: 20 }, 1);
  });

  test('returns 404 when the service throws', async () => {
    estoqueService.historicoPorProduto.mockRejectedValue(new AppError('Produto não encontrado', 404));

    const res = await request(app)
      .get('/produtos/999/movimentacoes')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /produtos/estoque-baixo', () => {
  test('is available to any authenticated role (vendedor) and never includes pricing', async () => {
    estoqueService.alertasEstoqueBaixo.mockResolvedValue([
      { id: 1, sku: 'X-1', nome: 'X', categoria: null, estoque_atual: 1, estoque_minimo: 5 }
    ]);

    const res = await request(app).get('/produtos/estoque-baixo').set('Authorization', `Bearer ${vendedorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('custo');
    expect(res.body.data[0]).not.toHaveProperty('preco_venda');
    expect(res.body.data[0]).not.toHaveProperty('margem_percentual');
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/produtos/estoque-baixo');
    expect(res.status).toBe(401);
  });
});


describe('GET /produtos/movimentacoes (relatório agregado)', () => {
  test('é restrito a admin', async () => {
    const res = await request(app)
      .get('/produtos/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(403);
    expect(estoqueService.listarMovimentacoesRelatorio).not.toHaveBeenCalled();
  });

  test('aceita filtros de período e produto para admin', async () => {
    estoqueService.listarMovimentacoesRelatorio.mockResolvedValue({
      items: [{ id: 1, produto_id: 10, produto_nome: 'Produto', tipo: 'entrada' }],
      page: 1, pageSize: 20, total: 1, totalPages: 1
    });

    const res = await request(app)
      .get('/produtos/movimentacoes?produto_id=10&data_de=2026-09-01&data_ate=2026-09-30')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(estoqueService.listarMovimentacoesRelatorio).toHaveBeenCalledWith(
      { page: 1, pageSize: 20, produto_id: 10, data_de: '2026-09-01', data_ate: '2026-09-30' },
      1
    );
  });

  test('rejeita período invertido', async () => {
    const res = await request(app)
      .get('/produtos/movimentacoes?data_de=2026-09-30&data_ate=2026-09-01')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(estoqueService.listarMovimentacoesRelatorio).not.toHaveBeenCalled();
  });
});

describe('estoque por local', () => {
  test('POST /produtos/:id/movimentacoes repassa local_id e local inexistente devolve 404', async () => {
    estoqueService.registrarMovimentacao.mockRejectedValue(new AppError('Local de estoque não encontrado', 404));

    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'saida', quantidade: 5, motivo_codigo: 'perda', local_id: 9 });

    expect(res.status).toBe(404);
    expect(estoqueService.registrarMovimentacao).toHaveBeenCalledWith(
      1, expect.objectContaining({ local_id: 9 }), 2, 1, expect.objectContaining({ id: 2 })
    );
  });

  test('POST rejeita local_id inválido com 400', async () => {
    const res = await request(app)
      .post('/produtos/1/movimentacoes')
      .set('Authorization', `Bearer ${estoquistaToken}`)
      .send({ tipo: 'saida', quantidade: 5, motivo_codigo: 'perda', local_id: -3 });

    expect(res.status).toBe(400);
    expect(estoqueService.registrarMovimentacao).not.toHaveBeenCalled();
  });

  test.each(['/produtos/1/estoque-locais', '/produtos/locais-estoque'])('GET %s: 401 sem token e 403 para vendedor', async (url) => {
    expect((await request(app).get(url)).status).toBe(401);
    const res = await request(app).get(url).set('Authorization', `Bearer ${vendedorToken}`);
    expect(res.status).toBe(403);
  });

  test('GET /produtos/:id/estoque-locais devolve os saldos para estoquista, usando a empresa do JWT', async () => {
    estoqueService.saldosPorLocal.mockResolvedValue({ produto_id: 1, estoque_total: 10, consistente: true, locais: [] });

    const res = await request(app).get('/produtos/1/estoque-locais').set('Authorization', `Bearer ${estoquistaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.estoque_total).toBe(10);
    expect(estoqueService.saldosPorLocal).toHaveBeenCalledWith(1, 1);
  });

  test('GET /produtos/locais-estoque lista os locais da empresa do JWT', async () => {
    estoqueService.listarLocais.mockResolvedValue([{ id: 1, tipo: 'central', nome: 'Central' }]);

    const res = await request(app).get('/produtos/locais-estoque').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(estoqueService.listarLocais).toHaveBeenCalledWith(1);
  });
});

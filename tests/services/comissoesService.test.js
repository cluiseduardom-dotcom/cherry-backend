jest.mock('../../src/repositories/comissoesRepository');
jest.mock('../../src/repositories/comissaoPagamentosRepository');

const comissoesRepository = require('../../src/repositories/comissoesRepository');
const pagamentosRepository = require('../../src/repositories/comissaoPagamentosRepository');
const service = require('../../src/services/comissoesService');

const vendedor = { id: 2, empresa_id: 7, role: 'vendedor', capacidades: [] };
const gerente = { id: 4, empresa_id: 7, role: 'vendedor', capacidades: ['ver_vendas_de_todos'] };
const admin = { id: 1, empresa_id: 7, role: 'admin', capacidades: [] };

beforeEach(() => {
  jest.resetAllMocks();
  comissoesRepository.listarRepasses.mockResolvedValue({ items: [], total: 0, totais: {} });
  comissoesRepository.historicoDaComissao.mockResolvedValue({ comissao: {}, eventos: [] });
});

describe('repasses: escopo por capacidade', () => {
  test('vendedor comum vê só os PRÓPRIOS (vendedor_id do JWT)', async () => {
    await service.repasses({ page: 1, pageSize: 20 }, vendedor);

    expect(comissoesRepository.listarRepasses).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: 7, vendedor_id: 2 }));
  });

  test('quem tem `ver_vendas_de_todos`, e o admin, vê os da empresa inteira', async () => {
    await service.repasses({ page: 1, pageSize: 20, status: 'a_repassar' }, gerente);
    await service.repasses({ page: 2, pageSize: 10 }, admin);

    expect(comissoesRepository.listarRepasses.mock.calls[0][0]).toMatchObject({ empresa_id: 7, vendedor_id: undefined, status: 'a_repassar', offset: 0 });
    expect(comissoesRepository.listarRepasses.mock.calls[1][0]).toMatchObject({ vendedor_id: undefined, offset: 10, limit: 10 });
  });
});

describe('confirmarRepasse', () => {
  test('o autor é sempre o usuário do JWT e o tenant também', async () => {
    comissoesRepository.confirmarRepasse.mockResolvedValue({ id: 5 });

    await service.confirmarRepasse(5, { observacao: 'ok' }, gerente);

    expect(comissoesRepository.confirmarRepasse).toHaveBeenCalledWith({ id: 5, empresa_id: 7, confirmado_por: 4, observacao: 'ok' });
  });
});

describe('historico: escopo por capacidade', () => {
  test('vendedor comum só do próprio dono; gerente/admin sem filtro de dono', async () => {
    await service.historico(9, vendedor);
    await service.historico(9, gerente);
    await service.historico(9, admin);

    expect(comissoesRepository.historicoDaComissao.mock.calls[0][0]).toEqual({ empresa_id: 7, comissao_id: 9, usuario_id: 2 });
    expect(comissoesRepository.historicoDaComissao.mock.calls[1][0]).toEqual({ empresa_id: 7, comissao_id: 9, usuario_id: undefined });
    expect(comissoesRepository.historicoDaComissao.mock.calls[2][0].usuario_id).toBeUndefined();
  });
});

describe('financeiro (gerir_financeiro) vê o dinheiro da equipe mesmo sem ver_vendas_de_todos', () => {
  const financeiro = { id: 6, empresa_id: 7, role: 'vendedor', capacidades: ['gerir_financeiro'] };

  test('repasses e pagamentos sem filtro de dono; vendedor comum só os próprios', async () => {
    pagamentosRepository.listarPagamentos.mockResolvedValue({ items: [], total: 0, totais: {} });

    await service.repasses({ page: 1, pageSize: 10 }, financeiro);
    await service.pagamentos({ page: 1, pageSize: 10, vendedor_id: 9 }, financeiro);
    await service.pagamentos({ page: 1, pageSize: 10, vendedor_id: 9 }, vendedor);

    expect(comissoesRepository.listarRepasses.mock.calls[0][0].vendedor_id).toBeUndefined();
    expect(pagamentosRepository.listarPagamentos.mock.calls[0][0].vendedor_id).toBe(9);
    expect(pagamentosRepository.listarPagamentos.mock.calls[1][0].vendedor_id).toBe(2);
  });
});

describe('aPagar e configuração', () => {
  test('soma em centavos o a pagar e o aguardando fechamento e devolve o modo', async () => {
    pagamentosRepository.resumoAPagar.mockResolvedValue({
      modo_pagamento: 'fim_do_mes',
      items: [
        { a_pagar: '0.10', aguardando_fechamento: '0.20' },
        { a_pagar: '0.20', aguardando_fechamento: '10.00' },
        { a_pagar: '-5.00', aguardando_fechamento: '0.00' }
      ]
    });

    const res = await service.aPagar(7);

    expect(res.modo_pagamento).toBe('fim_do_mes');
    expect(res.totais).toEqual({ a_pagar: '-4.70', aguardando_fechamento: '10.20' });
  });

  test('o modo é gravado com a empresa e o autor do JWT', async () => {
    pagamentosRepository.definirModoPagamento.mockResolvedValue({ modo_pagamento: 'fim_do_mes' });

    await service.definirConfiguracao({ modo_pagamento: 'fim_do_mes' }, admin);

    expect(pagamentosRepository.definirModoPagamento).toHaveBeenCalledWith({ empresa_id: 7, modo_pagamento: 'fim_do_mes', atualizado_por: 1 });
  });
});

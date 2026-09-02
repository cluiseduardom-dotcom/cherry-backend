jest.mock('../../src/repositories/configuracoesFinanceirasRepository');

const configuracoesFinanceirasRepository = require('../../src/repositories/configuracoesFinanceirasRepository');
const configuracoesFinanceirasService = require('../../src/services/configuracoesFinanceirasService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('obter', () => {
  test('delegates to obterOuCriar with the empresaId', async () => {
    configuracoesFinanceirasRepository.obterOuCriar.mockResolvedValue({ empresa_id: 9, aliquota_imposto: '0.0000' });

    const resultado = await configuracoesFinanceirasService.obter(9);

    expect(configuracoesFinanceirasRepository.obterOuCriar).toHaveBeenCalledWith(9);
    expect(resultado.aliquota_imposto).toBe('0.0000');
  });
});

describe('atualizar', () => {
  test('delegates to the repository with empresaId and aliquotaImposto', async () => {
    configuracoesFinanceirasRepository.atualizar.mockResolvedValue({ empresa_id: 9, aliquota_imposto: '0.0600' });

    const resultado = await configuracoesFinanceirasService.atualizar(9, 0.06);

    expect(configuracoesFinanceirasRepository.atualizar).toHaveBeenCalledWith(9, 0.06);
    expect(resultado.aliquota_imposto).toBe('0.0600');
  });
});

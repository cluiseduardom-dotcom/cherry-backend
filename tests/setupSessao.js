// authMiddleware confere o estado da sessão no banco (usuário/empresa ativos,
// token_version). Fora do teste de isolamento real, a suíte roda sem banco:
// por padrão toda sessão é válida. Os testes de revogação sobrescrevem este
// mock; multiTenantIsolation usa o repositório real (jest.unmock).
jest.mock('../src/repositories/sessaoRepository', () => ({
    buscarEstado: jest.fn(async () => ({ ativo: true, token_version: 0, empresa_status: 'ativa' }))
}));

beforeEach(() => {
    const sessaoRepository = require('../src/repositories/sessaoRepository');

    if (jest.isMockFunction(sessaoRepository.buscarEstado)) {
        sessaoRepository.buscarEstado.mockReset();
        sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 0, empresa_status: 'ativa' });
    }
});

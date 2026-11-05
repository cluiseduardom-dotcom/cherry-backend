// authMiddleware confere o estado da sessão no banco (usuário/empresa ativos,
// token_version). Fora do teste de isolamento real, a suíte roda sem banco:
// por padrão toda sessão é válida. Os testes de revogação sobrescrevem este
// mock; multiTenantIsolation usa o repositório real (jest.unmock).
// Sessão padrão dos testes unitários = plano com todos os recursos (como os planos legados): as suítes de
// rota existentes seguem valendo; os testes de bloqueio sobrescrevem a lista.
// (nome com prefixo `mock` para o jest permitir o uso dentro do jest.mock)
const mockFuncionalidadesPadrao = ['analise_financeira', 'bancos', 'comissoes', 'maletas'];
const FUNCIONALIDADES_PADRAO = mockFuncionalidadesPadrao;

jest.mock('../src/repositories/sessaoRepository', () => ({
    buscarEstado: jest.fn(async () => ({ ativo: true, token_version: 0, empresa_status: 'ativa', funcionalidades: mockFuncionalidadesPadrao }))
}));

beforeEach(() => {
    const sessaoRepository = require('../src/repositories/sessaoRepository');

    if (jest.isMockFunction(sessaoRepository.buscarEstado)) {
        sessaoRepository.buscarEstado.mockReset();
        sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 0, empresa_status: 'ativa', funcionalidades: FUNCIONALIDADES_PADRAO });
    }
});

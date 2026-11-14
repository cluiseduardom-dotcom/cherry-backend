// Regressão: "atrasado" e "hoje" são o dia de BRASÍLIA, não o do servidor (UTC). Entre 21h e 23h59 de Brasília o servidor já
// está no dia seguinte: uma conta que vence hoje aparecia atrasada. Usa relógio falso; o fuso do processo não importa.
jest.mock('../../src/repositories/contasReceberRepository');
jest.mock('../../src/repositories/contasPagarRepository');
jest.mock('../../src/repositories/comissoesRepository');
jest.mock('../../src/services/integracaoPagamentoContaPagarService', () => ({}));

const contasReceberRepository = require('../../src/repositories/contasReceberRepository');
const contasPagarRepository = require('../../src/repositories/contasPagarRepository');
const contasReceberService = require('../../src/services/contasReceberService');
const contasPagarService = require('../../src/services/contasPagarService');

// O driver pg devolve uma coluna DATE como Date à meia-noite LOCAL do processo: é assim que o teste a monta.
const vencimento = (ano, mes, dia) => new Date(ano, mes - 1, dia);

function relogio(isoUtc) {
    jest.useFakeTimers({ now: new Date(isoUtc), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'] });
}

afterEach(() => jest.useRealTimers());

describe.each([
    ['contas a receber', (conta) => { contasReceberRepository.buscarPorId.mockResolvedValue(conta); return contasReceberService.buscarPorId(1, 9); }],
    ['contas a pagar', (conta) => { contasPagarRepository.buscarPorId.mockResolvedValue(conta); return contasPagarService.buscarPorId(1, 9); }]
])('%s: atrasado só depois do dia do vencimento, no dia de Brasília', (_, buscar) => {
    const conta = () => ({ id: 1, status: 'pendente', data_vencimento: vencimento(2026, 11, 13) });

    test.each([
        ['2026-11-13T15:00:00Z', false, '12h de 13/11'],
        ['2026-11-14T00:30:00Z', false, '21h30 de 13/11 (servidor já em 14/11): vence hoje, não está atrasada'],
        ['2026-11-14T02:59:59Z', false, '23h59 de 13/11'],
        ['2026-11-14T03:00:00Z', true, 'meia-noite de 14/11 em Brasília: agora sim'],
        ['2026-11-15T12:00:00Z', true, '15/11']
    ])('agora = %s -> atrasado = %s (%s)', async (agora, esperado) => {
        relogio(agora);

        expect((await buscar(conta())).atrasado).toBe(esperado);
    });

    test('conta paga nunca é atrasada, e vencimento em texto (YYYY-MM-DD) funciona igual a Date', async () => {
        relogio('2026-11-20T12:00:00Z');

        expect((await buscar({ id: 1, status: 'recebido', data_vencimento: vencimento(2026, 11, 1) })).atrasado).toBe(false);
        expect((await buscar({ id: 1, status: 'pago', data_vencimento: vencimento(2026, 11, 1) })).atrasado).toBe(false);
        expect((await buscar({ id: 1, status: 'pendente', data_vencimento: '2026-11-01' })).atrasado).toBe(true);
    });
});

jest.mock('../../src/repositories/cobrancaTaxaRepository');

const cobrancaTaxaRepository = require('../../src/repositories/cobrancaTaxaRepository');
const { situacao, exigirPixLiberado, MENSAGEM_PDV } = require('../../src/services/suspensaoPixService');

const LIGADA = { COBRANCA_SUSPENSAO_PIX: 'ligada' };
// Outubro/2026 (R$ 25,00) vence 05/11; carência até 20/11; Pix suspenso a partir de 21/11.
const OUTUBRO = (saldo = '25.00') => ({ empresa_id: 7, competencia: '2026-10', vencimento: '2026-11-05', saldo });

beforeEach(() => jest.resetAllMocks());

describe('suspensão do Pix por taxa em atraso', () => {
    test('desligada (padrão): não suspende e NEM CONSULTA o banco', async () => {
        expect(await situacao(7, { env: {}, hoje: '2026-12-30' })).toEqual({ ativa: false, suspenso: false });
        await expect(exigirPixLiberado(7, { env: {}, hoje: '2026-12-30' })).resolves.toBeUndefined();
        expect(cobrancaTaxaRepository.periodosComSaldo).not.toHaveBeenCalled();
    });

    test('ligada e passou da carência: recusa com 403 e mensagem que não cita taxa, valor nem motivo', async () => {
        cobrancaTaxaRepository.periodosComSaldo.mockResolvedValue([OUTUBRO()]);
        const erro = await exigirPixLiberado(7, { env: LIGADA, hoje: '2026-11-21' }).catch((e) => e);

        expect(erro).toMatchObject({ statusCode: 403, codigo: 'PIX_SUSPENSO', message: MENSAGEM_PDV });
        expect(erro.message).not.toMatch(/taxa|atraso|pagamento|R\$|devendo|vencid/i);
    });

    test('consulta só a empresa pedida e participa da transação de quem chama', async () => {
        const client = { query: jest.fn() };
        cobrancaTaxaRepository.periodosComSaldo.mockResolvedValue([]);
        await exigirPixLiberado(7, { env: LIGADA, client, hoje: '2026-11-21' });
        expect(cobrancaTaxaRepository.periodosComSaldo).toHaveBeenCalledWith({ empresa_id: 7, client });
    });

    test.each([
        ['em carência (dia 20)', '2026-11-20', '25.00'],
        ['abaixo do piso, mesmo muito depois', '2026-12-30', '9.99'],
        ['sem saldo a receber', '2026-12-30', null]
    ])('ligada mas NÃO suspende: %s', async (_nome, hoje, saldo) => {
        cobrancaTaxaRepository.periodosComSaldo.mockResolvedValue(saldo ? [OUTUBRO(saldo)] : []);
        expect((await situacao(7, { env: LIGADA, hoje })).suspenso).toBe(false);
    });

    test('pagar reativa na hora: o mesmo mês com saldo menor deixa de suspender', async () => {
        cobrancaTaxaRepository.periodosComSaldo.mockResolvedValue([OUTUBRO('25.00')]);
        expect((await situacao(7, { env: LIGADA, hoje: '2026-11-25' })).suspenso).toBe(true);

        // pagou R$ 20,00: sobram R$ 5,00, abaixo do piso
        cobrancaTaxaRepository.periodosComSaldo.mockResolvedValue([OUTUBRO('5.00')]);
        expect((await situacao(7, { env: LIGADA, hoje: '2026-11-25' })).suspenso).toBe(false);
    });

    test('informa desde quando está suspenso', async () => {
        cobrancaTaxaRepository.periodosComSaldo.mockResolvedValue([OUTUBRO()]);
        expect(await situacao(7, { env: LIGADA, hoje: '2026-12-02' })).toEqual({ ativa: true, suspenso: true, desde: '2026-11-21' });
    });
});

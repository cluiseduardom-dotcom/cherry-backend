const client = require('../../src/integrations/mercadoPagoClient');

const CONFIG = { apiUrl: 'https://api.mercadopago.test', webhookUrl: 'https://api.exemplo.com/webhooks/mercadopago', sandbox: false, frontendUrl: 'https://app.erp.exemplo.com' };
const CODIGO = '11111111-1111-4111-8111-111111111111';
const params = { accessToken: 'tok', codigo: CODIGO, valor: 120, descricao: 'Pedido', taxaPlataforma: 0, parcelasMaximas: 12, expiraDe: '2026-10-31T10:00:00.000-03:00', expiraAte: '2026-10-31T12:00:00.000-03:00' };

let fetchSpy;
beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'p', init_point: 'https://mp.exemplo/x' }) });
});
afterEach(() => jest.restoreAllMocks());

const corpoEnviado = () => JSON.parse(fetchSpy.mock.calls[0][1].body);

// O link de cartão do PDV volta para o frontend do ERP; o da loja online volta para a LOJA. Nunca se misturam.
describe('criarPreferenciaCartao: para onde a cliente volta', () => {
    test('sem urlsRetorno (PDV): comportamento de sempre, volta ao frontend do ERP', async () => {
        await client.criarPreferenciaCartao(CONFIG, params);

        expect(corpoEnviado().back_urls.success).toBe('https://app.erp.exemplo.com/pagamento-recebido?resultado=sucesso');
        expect(corpoEnviado().auto_return).toBe('approved');
    });

    test('com urlsRetorno (loja): volta para a loja, nunca para o ERP', async () => {
        const urlsRetorno = { sucesso: 'https://loja.exemplo/pedido/x?pagamento=sucesso', pendente: 'https://loja.exemplo/pedido/x?pagamento=pendente', falha: 'https://loja.exemplo/pedido/x?pagamento=falha' };

        await client.criarPreferenciaCartao(CONFIG, { ...params, urlsRetorno });

        expect(corpoEnviado().back_urls).toEqual({ success: urlsRetorno.sucesso, pending: urlsRetorno.pendente, failure: urlsRetorno.falha });
        expect(corpoEnviado().auto_return).toBe('approved');
        expect(JSON.stringify(corpoEnviado())).not.toContain('app.erp.exemplo.com');
    });

    test('urlsRetorno null (loja sem endereço público configurado): sem retorno automático e nunca cai no ERP', async () => {
        await client.criarPreferenciaCartao(CONFIG, { ...params, urlsRetorno: null });

        expect(corpoEnviado()).not.toHaveProperty('back_urls');
        expect(corpoEnviado()).not.toHaveProperty('auto_return');
    });
});

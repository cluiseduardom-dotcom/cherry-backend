const client = require('../../src/integrations/mercadoPagoClient');

const CONFIG = { apiUrl: 'https://api.mercadopago.test', webhookUrl: 'https://api.exemplo.com/webhooks/mercadopago', sandbox: false };
const CODIGO = '11111111-1111-4111-8111-111111111111';

function respostaFetch(corpo, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

let fetchSpy;

beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
});

afterEach(() => jest.restoreAllMocks());

const params = { accessToken: 'tok', codigo: CODIGO, valor: 120, descricao: 'Venda no PDV', taxaPlataforma: 0, parcelasMaximas: 12, expiraDe: '2026-10-31T10:00:00.000-03:00', expiraAte: '2026-10-31T12:00:00.000-03:00' };

describe('criarPreferenciaCartao', () => {
    test('envia só cartão, teto de parcelas, referência nossa e o token da loja; sem marketplace_fee quando a taxa é 0', async () => {
        fetchSpy.mockResolvedValue(respostaFetch({ id: 'pref-1', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' }, 201));

        const res = await client.criarPreferenciaCartao(CONFIG, params);

        const [url, opcoes] = fetchSpy.mock.calls[0];
        const corpo = JSON.parse(opcoes.body);
        expect(url).toBe('https://api.mercadopago.test/checkout/preferences');
        expect(opcoes.headers.authorization).toBe('Bearer tok');
        expect(opcoes.headers['X-Idempotency-Key']).toBe(CODIGO);
        expect(corpo).toMatchObject({
            external_reference: CODIGO,
            notification_url: CONFIG.webhookUrl,
            items: [{ quantity: 1, currency_id: 'BRL', unit_price: 120 }],
            payment_methods: { installments: 12 },
            expires: true
        });
        expect(corpo.payment_methods.excluded_payment_types.map((t) => t.id)).toEqual(expect.arrayContaining(['ticket', 'bank_transfer']));
        // O Mercado Pago recusa excluir saldo em conta (400): nunca pode ir na lista.
        expect(corpo.payment_methods.excluded_payment_types.map((t) => t.id)).not.toContain('account_money');
        expect(corpo).not.toHaveProperty('marketplace_fee');
        expect(res).toEqual({ preferenciaId: 'pref-1', linkUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' });
    });

    test('experiência do cliente: nome da loja, fatura, volta para a nossa página e 1x como padrão', async () => {
        fetchSpy.mockResolvedValue(respostaFetch({ id: 'p', init_point: 'https://mp.exemplo/x' }, 201));
        await client.criarPreferenciaCartao({ ...CONFIG, frontendUrl: 'https://app.exemplo.com' }, { ...params, descricao: 'Cherry Semijoias', nomeLoja: 'Cherry Semijóias & Cia Ltda Matriz' });

        const corpo = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(corpo.items[0].title).toBe('Cherry Semijoias');
        expect(corpo.statement_descriptor).toBe('CHERRY SEMIJOIAS');
        expect(corpo.statement_descriptor.length).toBeLessThanOrEqual(16);
        expect(corpo.back_urls).toEqual({
            success: 'https://app.exemplo.com/pagamento-recebido?resultado=sucesso',
            pending: 'https://app.exemplo.com/pagamento-recebido?resultado=pendente',
            failure: 'https://app.exemplo.com/pagamento-recebido?resultado=falha'
        });
        expect(corpo.auto_return).toBe('approved');
        // binary_mode derrubaria pagamentos que dependem de autorização do banco: nunca enviar.
        expect(corpo).not.toHaveProperty('binary_mode');
        expect(corpo.payment_methods.default_installments).toBe(1);
    });

    test('sem nome utilizável não envia statement_descriptor; sem frontendUrl não envia back_urls', async () => {
        fetchSpy.mockResolvedValue(respostaFetch({ id: 'p', init_point: 'https://mp.exemplo/x' }, 201));
        await client.criarPreferenciaCartao(CONFIG, { ...params, nomeLoja: '***' });

        const corpo = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(corpo).not.toHaveProperty('statement_descriptor');
        expect(corpo).not.toHaveProperty('back_urls');
        expect(corpo).not.toHaveProperty('auto_return');
    });

    test('descritivoDeFatura remove acentos, símbolos e limita a 16 caracteres', () => {
        expect(client.descritivoDeFatura('Grazielá Doces & Cia')).toBe('GRAZIELA DOCES C');
        expect(client.descritivoDeFatura(null)).toBe('');
    });

    test('envia marketplace_fee só quando há taxa', async () => {
        fetchSpy.mockResolvedValue(respostaFetch({ id: 'p', init_point: 'https://mp.exemplo/x' }, 201));
        await client.criarPreferenciaCartao(CONFIG, { ...params, taxaPlataforma: 0.6 });
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body).marketplace_fee).toBe(0.6);
    });

    test('em sandbox usa sandbox_init_point', async () => {
        fetchSpy.mockResolvedValue(respostaFetch({ id: 'p', init_point: 'https://prod.exemplo/x', sandbox_init_point: 'https://sandbox.exemplo/x' }, 201));
        expect((await client.criarPreferenciaCartao({ ...CONFIG, sandbox: true }, params)).linkUrl).toBe('https://sandbox.exemplo/x');
    });

    test.each([
        [{ id: 'p' }],
        [{ init_point: 'https://mp.exemplo/x' }],
        [{ id: 'p', init_point: 'http://inseguro.exemplo/x' }],
        [null]
    ])('resposta inesperada %j vira 424', async (corpo) => {
        fetchSpy.mockResolvedValue(respostaFetch(corpo, 201));
        await expect(client.criarPreferenciaCartao(CONFIG, params)).rejects.toMatchObject({ statusCode: 424 });
    });

    test('recusa do provedor vira 424 sem vazar o token', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        fetchSpy.mockResolvedValue(respostaFetch({ message: 'invalid' }, 400));
        const erro = await client.criarPreferenciaCartao(CONFIG, params).catch((e) => e);
        expect(erro.statusCode).toBe(424);
        expect(erro.message).not.toContain('tok');
    });
});

describe('buscarPagamentosPorReferencia', () => {
    test('consulta pelo external_reference com o token da loja e devolve results', async () => {
        fetchSpy.mockResolvedValue(respostaFetch({ results: [{ id: 1 }] }));
        const res = await client.buscarPagamentosPorReferencia(CONFIG, { accessToken: 'tok', codigo: CODIGO });
        expect(fetchSpy.mock.calls[0][0]).toContain(`external_reference=${CODIGO}`);
        expect(fetchSpy.mock.calls[0][1].headers.authorization).toBe('Bearer tok');
        expect(res).toEqual([{ id: 1 }]);
    });

    test('resposta sem lista vira lista vazia', async () => {
        fetchSpy.mockResolvedValue(respostaFetch({}));
        expect(await client.buscarPagamentosPorReferencia(CONFIG, { accessToken: 'tok', codigo: CODIGO })).toEqual([]);
    });
});

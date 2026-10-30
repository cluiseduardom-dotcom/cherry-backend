const client = require('../../src/integrations/mercadoPagoClient');

const config = {
    appId: '999', clientSecret: 'SEGREDO-APP', redirectUri: 'https://api.test/cb', webhookUrl: 'https://api.test/wh',
    apiUrl: 'https://api.mp.test', authUrl: 'https://auth.mp.test', sandbox: false
};

const resposta = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });

let fetchOriginal;
let logOriginal;

beforeEach(() => {
    fetchOriginal = global.fetch;
    global.fetch = jest.fn();
    logOriginal = console.error;
    console.error = jest.fn();
});

afterEach(() => {
    global.fetch = fetchOriginal;
    console.error = logOriginal;
});

describe('montarUrlAutorizacao', () => {
    test('usa os parâmetros documentados', () => {
        const url = new URL(client.montarUrlAutorizacao(config, 'abc'));
        expect(url.origin + url.pathname).toBe('https://auth.mp.test/authorization');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: '999', response_type: 'code', platform_id: 'mp', state: 'abc', redirect_uri: 'https://api.test/cb'
        });
    });
});

describe('trocarCodigo / renovarToken', () => {
    test('troca o código e normaliza a resposta', async () => {
        global.fetch.mockResolvedValue(resposta({ access_token: 'AT', refresh_token: 'RT', expires_in: 100, user_id: 42 }));
        const token = await client.trocarCodigo(config, 'CODE');
        expect(token).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiraEmSegundos: 100, userId: '42' });

        const [url, opcoes] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.mp.test/oauth/token');
        expect(opcoes.method).toBe('POST');
        expect(JSON.parse(opcoes.body)).toEqual({
            client_id: '999', client_secret: 'SEGREDO-APP', grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'https://api.test/cb'
        });
    });

    test('sandbox envia test_token e expires_in ausente vale 180 dias', async () => {
        global.fetch.mockResolvedValue(resposta({ access_token: 'AT', user_id: 1 }));
        const token = await client.trocarCodigo({ ...config, sandbox: true }, 'C');
        expect(JSON.parse(global.fetch.mock.calls[0][1].body).test_token).toBe(true);
        expect(token.expiraEmSegundos).toBe(180 * 24 * 3600);
        expect(token.refreshToken).toBeNull();
    });

    test('renovação usa grant_type refresh_token', async () => {
        global.fetch.mockResolvedValue(resposta({ access_token: 'AT2', refresh_token: 'RT2', user_id: 1 }));
        await client.renovarToken(config, 'RT');
        const corpo = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(corpo).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT' });
    });

    test('resposta sem access_token ou user_id é recusada', async () => {
        global.fetch.mockResolvedValue(resposta({ foo: 'bar' }));
        await expect(client.trocarCodigo(config, 'C')).rejects.toMatchObject({ statusCode: 424 });
    });
});

describe('criarPagamentoPix', () => {
    const entrada = {
        accessToken: 'TOKEN-DA-LOJA', codigo: 'uuid-1', valor: 25, descricao: 'Venda no PDV',
        emailPagador: 'loja@x.com', taxaPlataforma: 0.04, expiraEm: '2026-10-27T15:30:00.000-03:00'
    };
    const ok = { id: 777, status: 'pending', point_of_interaction: { transaction_data: { qr_code: 'QR', qr_code_base64: 'B64', ticket_url: 'https://t' } } };

    test('envia o pedido documentado: token do vendedor, idempotência, application_fee e external_reference', async () => {
        global.fetch.mockResolvedValue(resposta(ok, 201));
        const r = await client.criarPagamentoPix(config, entrada);
        expect(r).toEqual({ idExterno: '777', status: 'pending', qrCode: 'QR', qrCodeBase64: 'B64', ticketUrl: 'https://t' });

        const [url, opcoes] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.mp.test/v1/payments');
        expect(opcoes.headers.authorization).toBe('Bearer TOKEN-DA-LOJA');
        expect(opcoes.headers['X-Idempotency-Key']).toBe('uuid-1');
        expect(JSON.parse(opcoes.body)).toEqual({
            transaction_amount: 25, description: 'Venda no PDV', payment_method_id: 'pix', payer: { email: 'loja@x.com' },
            external_reference: 'uuid-1', notification_url: 'https://api.test/wh', date_of_expiration: '2026-10-27T15:30:00.000-03:00',
            application_fee: 0.04
        });
    });

    test('em sandbox o pagador de teste é APRO; fora do sandbox nunca', async () => {
        global.fetch.mockResolvedValue(resposta(ok, 201));
        await client.criarPagamentoPix({ ...config, sandbox: true }, entrada);
        expect(JSON.parse(global.fetch.mock.calls[0][1].body).payer).toEqual({ email: 'loja@x.com', first_name: 'APRO' });

        global.fetch.mockClear();
        await client.criarPagamentoPix({ ...config, sandbox: false }, entrada);
        expect(JSON.parse(global.fetch.mock.calls[0][1].body).payer).toEqual({ email: 'loja@x.com' });
    });

    test('comissão zero não envia application_fee', async () => {
        global.fetch.mockResolvedValue(resposta(ok, 201));
        await client.criarPagamentoPix(config, { ...entrada, taxaPlataforma: 0 });
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty('application_fee');
    });

    test('resposta sem QR é recusada', async () => {
        global.fetch.mockResolvedValue(resposta({ id: 1, status: 'pending' }, 201));
        await expect(client.criarPagamentoPix(config, entrada)).rejects.toMatchObject({ statusCode: 424 });
    });
});

describe('erros', () => {
    test('erro do provedor vira 424 genérico e NUNCA vaza token ou segredo em mensagem ou log', async () => {
        global.fetch.mockResolvedValue(resposta({ message: 'invalid_token', error: 'bad_request' }, 401));
        const erro = await client.buscarPagamento(config, { accessToken: 'TOKEN-SECRETO', idExterno: '1' }).catch((e) => e);
        expect(erro.statusCode).toBe(424);
        expect(erro.message).not.toContain('TOKEN-SECRETO');
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('TOKEN-SECRETO');
    });

    test('o log registra o motivo do provedor (error, message e causas) sem vazar token', async () => {
        global.fetch.mockResolvedValue(resposta({
            error: 'bad_request',
            message: 'Invalid users involved',
            cause: [{ code: 2034, description: 'Invalid users involved', data: 'TOKEN-SECRETO' }]
        }, 400));
        const erro = await client.buscarPagamento(config, { accessToken: 'TOKEN-SECRETO', idExterno: '1' }).catch((e) => e);
        expect(erro.statusCode).toBe(424);
        expect(erro.message).toBe('O Mercado Pago recusou a operação.');
        const log = JSON.stringify(console.error.mock.calls);
        expect(log).toContain('bad_request | Invalid users involved | causas: 2034: Invalid users involved');
        expect(log).not.toContain('TOKEN-SECRETO');
    });

    test('falha de rede vira 424 sem detalhe interno', async () => {
        global.fetch.mockRejectedValue(Object.assign(new Error('ECONNRESET a 10.0.0.1'), { name: 'FetchError' }));
        const erro = await client.buscarPagamento(config, { accessToken: 'T', idExterno: '1' }).catch((e) => e);
        expect(erro.statusCode).toBe(424);
        expect(erro.message).not.toContain('10.0.0.1');
    });

    test('buscarPagamento escapa o id na URL', async () => {
        global.fetch.mockResolvedValue(resposta({ id: 1 }));
        await client.buscarPagamento(config, { accessToken: 'T', idExterno: '1/../x' });
        expect(global.fetch.mock.calls[0][0]).toBe('https://api.mp.test/v1/payments/1%2F..%2Fx');
    });
});

describe('devolverPagamento', () => {
    test('POST /v1/payments/{id}/refunds com token do vendedor, corpo vazio (devolução total) e idempotência', async () => {
        global.fetch.mockResolvedValue(resposta({ id: 555, payment_id: 123, amount: 90, status: 'approved' }, 201));

        const devolucao = await client.devolverPagamento(config, { accessToken: 'AT-LOJA', idExterno: '123', idempotencia: 'devolucao-7' });

        expect(devolucao).toEqual({ idExterno: '555', status: 'approved' });

        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.mp.test/v1/payments/123/refunds');
        expect(init.method).toBe('POST');
        expect(init.headers.authorization).toBe('Bearer AT-LOJA');
        expect(init.headers['X-Idempotency-Key']).toBe('devolucao-7');
        expect(JSON.parse(init.body)).toEqual({});
    });

    test('escapa o id na URL', async () => {
        global.fetch.mockResolvedValue(resposta({ id: 1, status: 'approved' }, 201));
        await client.devolverPagamento(config, { accessToken: 'AT', idExterno: '1/../x', idempotencia: 'k' });

        expect(global.fetch.mock.calls[0][0]).toBe('https://api.mp.test/v1/payments/1%2F..%2Fx/refunds');
    });

    test('resposta sem id é recusada; recusa do provedor vira 424 genérico sem vazar token', async () => {
        global.fetch.mockResolvedValueOnce(resposta({ status: 'approved' }, 201));
        await expect(client.devolverPagamento(config, { accessToken: 'AT-SECRETO', idExterno: '1', idempotencia: 'k' }))
            .rejects.toMatchObject({ statusCode: 424 });

        global.fetch.mockResolvedValueOnce(resposta({ message: 'refund not allowed', status: 400 }, 400));
        const erro = await client.devolverPagamento(config, { accessToken: 'AT-SECRETO', idExterno: '1', idempotencia: 'k' }).catch((e) => e);

        expect(erro.statusCode).toBe(424);
        expect(erro.message).toBe('O Mercado Pago recusou a operação.');
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('AT-SECRETO');
    });

    test('120065 (sem saldo disponível na conta da loja) vira mensagem clara, com 424 e até 200 caracteres', async () => {
        global.fetch.mockResolvedValueOnce(resposta({
            error: 'bad_request',
            message: "Collector hasn't enough available money",
            status: 400,
            cause: [{ code: 120065, description: "Collector hasn't enough available money" }]
        }, 400));

        const erro = await client.devolverPagamento(config, { accessToken: 'AT-SECRETO', idExterno: '1', idempotencia: 'k' }).catch((e) => e);

        expect(erro.statusCode).toBe(424);
        expect(erro.message).toContain('não tem saldo disponível');
        expect(erro.message.length).toBeLessThanOrEqual(200);
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('AT-SECRETO');
    });

    test('outro código de causa mantém a mensagem genérica', async () => {
        global.fetch.mockResolvedValueOnce(resposta({ message: 'x', cause: [{ code: 999, description: 'outra' }] }, 400));

        const erro = await client.devolverPagamento(config, { accessToken: 'AT', idExterno: '1', idempotencia: 'k' }).catch((e) => e);

        expect(erro.message).toBe('O Mercado Pago recusou a operação.');
    });
});

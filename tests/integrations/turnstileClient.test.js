const { exigirVerificacao, modoDaVerificacao, URL_VERIFICACAO } = require('../../src/integrations/turnstileClient');

const ENV_ATIVA = { NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'segredo-super-secreto' };

function simularFetch(impl) {
    global.fetch = jest.fn(impl);
    return global.fetch;
}

const resposta = (corpo, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => corpo });

let fetchOriginal;
beforeEach(() => { fetchOriginal = global.fetch; jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { global.fetch = fetchOriginal; jest.restoreAllMocks(); });

describe('modoDaVerificacao', () => {
    test.each([
        [{ NODE_ENV: 'development' }, 'desligada'],
        [{ NODE_ENV: 'test' }, 'desligada'],
        [{}, 'desligada'],
        [{ NODE_ENV: 'production' }, 'mal_configurada'],
        [{ NODE_ENV: 'staging' }, 'mal_configurada'],
        [{ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: '   ' }, 'mal_configurada'],
        [{ NODE_ENV: 'development', TURNSTILE_SECRET_KEY: 'x' }, 'ativa'],
        [{ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'x' }, 'ativa']
    ])('%j → %s', (env, esperado) => {
        expect(modoDaVerificacao(env)).toBe(esperado);
    });
});

describe('exigirVerificacao', () => {
    test('desligada (desenvolvimento sem segredo): passa sem chamar a Cloudflare', async () => {
        const f = simularFetch(() => { throw new Error('não deveria chamar'); });

        await expect(exigirVerificacao({ token: undefined, env: { NODE_ENV: 'development' } })).resolves.toBeUndefined();
        expect(f).not.toHaveBeenCalled();
    });

    test('produção sem segredo: falha fechada com 503, sem chamar a Cloudflare e registrando o erro', async () => {
        const f = simularFetch(() => { throw new Error('não deveria chamar'); });

        await expect(exigirVerificacao({ token: 't', env: { NODE_ENV: 'production' } })).rejects.toMatchObject({ statusCode: 503, codigo: 'CAPTCHA_INDISPONIVEL' });
        expect(f).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
    });

    test('ativa sem token: 400 CAPTCHA_OBRIGATORIO e não chama a Cloudflare', async () => {
        const f = simularFetch(() => { throw new Error('não deveria chamar'); });

        await expect(exigirVerificacao({ token: undefined, env: ENV_ATIVA })).rejects.toMatchObject({ statusCode: 400, codigo: 'CAPTCHA_OBRIGATORIO' });
        expect(f).not.toHaveBeenCalled();
    });

    test('token válido: passa, enviando segredo, token e IP em formulário, com limite de tempo', async () => {
        const f = simularFetch(() => resposta({ success: true }));

        await expect(exigirVerificacao({ token: 'tok-123', ip: '203.0.113.9', env: ENV_ATIVA })).resolves.toBeUndefined();

        const [url, opcoes] = f.mock.calls[0];
        expect(url).toBe(URL_VERIFICACAO);
        expect(opcoes.method).toBe('POST');
        expect(Object.fromEntries(opcoes.body)).toEqual({ secret: 'segredo-super-secreto', response: 'tok-123', remoteip: '203.0.113.9' });
        expect(opcoes.signal).toBeInstanceOf(AbortSignal);
    });

    test('token recusado pela Cloudflare: 403 CAPTCHA_INVALIDO', async () => {
        simularFetch(() => resposta({ success: false, 'error-codes': ['timeout-or-duplicate'] }));

        await expect(exigirVerificacao({ token: 'velho', env: ENV_ATIVA })).rejects.toMatchObject({ statusCode: 403, codigo: 'CAPTCHA_INVALIDO' });
    });

    test.each([
        ['success ausente', { ok: 1 }],
        ['success em texto', { success: 'true' }],
        ['resposta nula', null]
    ])('resposta sem success===true (%s) não passa', async (_r, corpo) => {
        simularFetch(() => resposta(corpo));

        await expect(exigirVerificacao({ token: 't', env: ENV_ATIVA })).rejects.toMatchObject({ statusCode: 403 });
    });

    test.each([
        ['rede caiu', () => Promise.reject(Object.assign(new Error('ECONNRESET'), { name: 'FetchError' }))],
        ['tempo esgotado', () => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))],
        ['Cloudflare responde 500', () => resposta({}, false, 500)],
        ['corpo que não é JSON', () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })]
    ])('%s: falha fechada com 503 (nunca deixa passar)', async (_r, impl) => {
        simularFetch(impl);

        await expect(exigirVerificacao({ token: 't', env: ENV_ATIVA })).rejects.toMatchObject({ statusCode: 503, codigo: 'CAPTCHA_INDISPONIVEL' });
    });

    test('o segredo nunca aparece em log nem em mensagem de erro', async () => {
        simularFetch(() => Promise.reject(new Error('falhou com segredo-super-secreto na URL')));

        const erro = await exigirVerificacao({ token: 't', env: ENV_ATIVA }).catch((e) => e);

        expect(erro.message).not.toContain('segredo-super-secreto');
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('segredo-super-secreto');
    });
});

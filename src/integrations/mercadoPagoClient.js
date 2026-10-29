const AppError = require('../errors/AppError');

// Único ponto que fala com a API do Mercado Pago. Falha do provedor vira 424 (dependência externa):
// o errorHandler do projeto esconde a mensagem de qualquer 5xx, e o caixa precisa lê-la. Tudo que NÃO está confirmado na documentação
// consultada está marcado como [CONFIRMAR NO SANDBOX]. Nenhum token entra em log ou mensagem de erro.

const TIMEOUT_MS = 15000;

// Resumo do erro do provedor para o log: error, message e causas (código + descrição). Só textos
// curtos do próprio Mercado Pago; nunca o corpo da requisição (tem token/segredo).
function descreverErroProvedor(dados) {
    const texto = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 200) : null);
    const causas = Array.isArray(dados?.cause)
        ? dados.cause.slice(0, 5).map((c) => [texto(c?.code), texto(c?.description)].filter(Boolean).join(': ')).filter(Boolean)
        : [];
    const partes = [texto(dados?.error), texto(dados?.message), causas.length ? `causas: ${causas.join('; ')}` : null].filter(Boolean);

    return partes.length ? partes.join(' | ') : 'sem detalhe';
}

async function chamar(config, { metodo, caminho, base, corpo, token, idempotencia }) {
    const headers = { accept: 'application/json' };

    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (idempotencia) headers['X-Idempotency-Key'] = idempotencia;

    let resposta;

    try {
        resposta = await fetch(`${base}${caminho}`, {
            method: metodo,
            headers,
            body: corpo === undefined ? undefined : JSON.stringify(corpo),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (error) {
        console.error(`Mercado Pago: falha de rede em ${metodo} ${caminho} (${error.name})`);
        throw new AppError('Não foi possível falar com o Mercado Pago agora. Tente novamente.', 424);
    }

    let dados = null;

    try {
        dados = await resposta.json();
    } catch {
        dados = null;
    }

    if (!resposta.ok) {
        // Só status e código/mensagem do provedor; nunca o corpo da requisição (tem token/segredo).
        console.error(`Mercado Pago: ${metodo} ${caminho} respondeu ${resposta.status} (${descreverErroProvedor(dados)})`);
        throw new AppError('O Mercado Pago recusou a operação.', 424);
    }

    return dados;
}

// Documentado: https://auth.mercadopago.com/authorization com client_id, response_type=code,
// platform_id=mp, state e redirect_uri (igual ao cadastrado na aplicação).
function montarUrlAutorizacao(config, state) {
    const params = new URLSearchParams({
        client_id: config.appId,
        response_type: 'code',
        platform_id: 'mp',
        state,
        redirect_uri: config.redirectUri
    });

    return `${config.authUrl}/authorization?${params.toString()}`;
}

function lerToken(dados) {
    // [CONFIRMAR NO SANDBOX] nomes dos campos da resposta: a documentação consultada não os lista.
    if (!dados || typeof dados.access_token !== 'string' || !dados.access_token || dados.user_id === undefined || dados.user_id === null) {
        throw new AppError('Resposta inesperada do Mercado Pago ao conectar a conta.', 424);
    }

    return {
        accessToken: dados.access_token,
        refreshToken: typeof dados.refresh_token === 'string' && dados.refresh_token ? dados.refresh_token : null,
        // Documentado: access token do fluxo authorization_code vale 180 dias.
        expiraEmSegundos: Number.isFinite(Number(dados.expires_in)) && Number(dados.expires_in) > 0 ? Number(dados.expires_in) : 180 * 24 * 3600,
        userId: String(dados.user_id)
    };
}

// [CONFIRMAR NO SANDBOX] o valor de grant_type para o código de autorização não aparece na página;
// usamos o valor padrão do protocolo OAuth 2.0. test_token=true é o documentado para sandbox.
async function trocarCodigo(config, code) {
    const corpo = {
        client_id: config.appId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri
    };

    if (config.sandbox) corpo.test_token = true;

    return lerToken(await chamar(config, { metodo: 'POST', base: config.apiUrl, caminho: '/oauth/token', corpo }));
}

// Documentado: POST https://api.mercadopago.com/oauth/token (JSON) com refresh_token.
// [CONFIRMAR NO SANDBOX] a página mostra "refresh-token" no exemplo e "refresh_token" no texto.
async function renovarToken(config, refreshToken) {
    const corpo = {
        client_id: config.appId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    };

    if (config.sandbox) corpo.test_token = true;

    return lerToken(await chamar(config, { metodo: 'POST', base: config.apiUrl, caminho: '/oauth/token', corpo }));
}

// Documentado: POST /v1/payments com Authorization: Bearer <token do VENDEDOR>, corpo com
// transaction_amount, payment_method_id, payer.email e application_fee (valor em reais).
// X-Idempotency-Key evita cobrança duplicada em repetição. date_of_expiration: entre 30 min e 30 dias.
async function criarPagamentoPix(config, { accessToken, codigo, valor, descricao, emailPagador, taxaPlataforma, expiraEm }) {
    const corpo = {
        transaction_amount: valor,
        description: descricao,
        payment_method_id: 'pix',
        payer: { email: emailPagador },
        external_reference: codigo,
        notification_url: config.webhookUrl,
        date_of_expiration: expiraEm
    };

    if (taxaPlataforma > 0) corpo.application_fee = taxaPlataforma;

    // Só em teste: a documentação do Mercado Pago define o resultado do pagamento de teste pelo nome
    // do pagador ("APRO" = aprovado). Nunca em produção.
    if (config.sandbox) corpo.payer.first_name = 'APRO';

    const dados = await chamar(config, {
        metodo: 'POST', base: config.apiUrl, caminho: '/v1/payments', corpo, token: accessToken, idempotencia: codigo
    });

    const transacao = dados?.point_of_interaction?.transaction_data;

    if (!dados || dados.id === undefined || !transacao?.qr_code) {
        throw new AppError('Resposta inesperada do Mercado Pago ao gerar o Pix.', 424);
    }

    return {
        idExterno: String(dados.id),
        status: dados.status,
        qrCode: transacao.qr_code,
        qrCodeBase64: transacao.qr_code_base64 ?? null,
        ticketUrl: transacao.ticket_url ?? null
    };
}

async function buscarPagamento(config, { accessToken, idExterno }) {
    return chamar(config, {
        metodo: 'GET', base: config.apiUrl, caminho: `/v1/payments/${encodeURIComponent(idExterno)}`, token: accessToken
    });
}

module.exports = { montarUrlAutorizacao, trocarCodigo, renovarToken, criarPagamentoPix, buscarPagamento };

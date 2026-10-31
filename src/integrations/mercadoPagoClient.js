const AppError = require('../errors/AppError');

// Único ponto que fala com a API do Mercado Pago. Falha do provedor vira 424 (dependência externa):
// o errorHandler do projeto esconde a mensagem de qualquer 5xx, e o caixa precisa lê-la. Tudo que NÃO está confirmado na documentação
// consultada está marcado como [CONFIRMAR NO SANDBOX]. Nenhum token entra em log ou mensagem de erro.

const TIMEOUT_MS = 15000;
const CODIGO_SALDO_INSUFICIENTE = '120065';
const MENSAGEM_SALDO_INSUFICIENTE = 'A conta Mercado Pago da loja não tem saldo disponível para devolver este Pix. Confira o saldo no Mercado Pago e tente de novo mais tarde.';

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

// Códigos de causa do provedor (ex.: 120065), só para o chamador traduzir erros conhecidos em mensagem útil.
function codigosDeCausa(dados) {
    return Array.isArray(dados?.cause)
        ? dados.cause.slice(0, 5).map((c) => String(c?.code ?? '')).filter(Boolean)
        : [];
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
        const erro = new AppError('O Mercado Pago recusou a operação.', 424);
        erro.codigosProvedor = codigosDeCausa(dados);
        throw erro;
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

// Tipos de pagamento do Checkout Pro EXCLUÍDOS: o link é para cartão. O Mercado Pago NÃO deixa excluir
// `account_money` (saldo em conta: 400 "account_money cannot be excluded", visto no teste real de 31/10/2026);
// ele é tratado como débito (à vista) na confirmação. [CONFIRMAR NO TESTE REAL] os demais ids e se o débito aparece.
const TIPOS_EXCLUIDOS_LINK_CARTAO = ['ticket', 'bank_transfer', 'atm', 'digital_currency', 'digital_wallet'];

// Texto que aparece na fatura do cartão do cliente: o Mercado Pago aceita até 16 caracteres.
// Só letras sem acento, números e espaço; vazio = não enviar (o Mercado Pago usa o padrão dele).
const LIMITE_DESCRITIVO_FATURA = 16;

function descritivoDeFatura(nome) {
    return String(nome ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase()
        .slice(0, LIMITE_DESCRITIVO_FATURA)
        .trim();
}

// Documentado (Checkout Pro marketplace): POST /checkout/preferences com o access token do VENDEDOR;
// a comissão da plataforma vai em marketplace_fee (valor em reais). external_reference = nosso código.
// Experiência do cliente: título = nome da loja, descritivo na fatura, volta para a nossa página ao final
// (back_urls + auto_return só no pagamento aprovado).
// [CONFIRMAR NO TESTE REAL] criação com o token OAuth da loja, installments como teto de parcelas e init_point.
async function criarPreferenciaCartao(config, { accessToken, codigo, valor, descricao, nomeLoja, taxaPlataforma, parcelasMaximas, expiraDe, expiraAte }) {
    const corpo = {
        items: [{ id: codigo, title: descricao, quantity: 1, currency_id: 'BRL', unit_price: valor }],
        external_reference: codigo,
        notification_url: config.webhookUrl,
        payment_methods: {
            excluded_payment_types: TIPOS_EXCLUIDOS_LINK_CARTAO.map((id) => ({ id })),
            installments: parcelasMaximas,
            default_installments: 1
        },
        expires: true,
        expiration_date_from: expiraDe,
        expiration_date_to: expiraAte
    };

    if (config.frontendUrl) {
        const retorno = (resultado) => `${config.frontendUrl}/pagamento-recebido?resultado=${resultado}`;

        corpo.back_urls = { success: retorno('sucesso'), pending: retorno('pendente'), failure: retorno('falha') };
        corpo.auto_return = 'approved';
    }

    const fatura = descritivoDeFatura(nomeLoja);

    if (fatura) corpo.statement_descriptor = fatura;

    if (taxaPlataforma > 0) corpo.marketplace_fee = taxaPlataforma;

    const dados = await chamar(config, {
        metodo: 'POST', base: config.apiUrl, caminho: '/checkout/preferences', corpo, token: accessToken, idempotencia: codigo
    });

    const link = config.sandbox ? dados?.sandbox_init_point : dados?.init_point;

    if (!dados || typeof dados.id !== 'string' || !dados.id || typeof link !== 'string' || !link.startsWith('https://')) {
        throw new AppError('Resposta inesperada do Mercado Pago ao gerar o link de pagamento.', 424);
    }

    return { preferenciaId: dados.id, linkUrl: link };
}

// Pagamentos de uma preferência/cobrança, pelo external_reference (o nosso código), com o token da loja.
async function buscarPagamentosPorReferencia(config, { accessToken, codigo }) {
    const dados = await chamar(config, {
        metodo: 'GET',
        base: config.apiUrl,
        caminho: `/v1/payments/search?external_reference=${encodeURIComponent(codigo)}&sort=date_created&criteria=desc`,
        token: accessToken
    });

    return Array.isArray(dados?.results) ? dados.results : [];
}

async function buscarPagamento(config, { accessToken, idExterno }) {
    return chamar(config, {
        metodo: 'GET', base: config.apiUrl, caminho: `/v1/payments/${encodeURIComponent(idExterno)}`, token: accessToken
    });
}

// Devolução TOTAL do Pix: POST /v1/payments/{id}/refunds com o token do VENDEDOR (corpo vazio = valor
// integral). A chave de idempotência torna a repetição segura se a resposta se perder. NÃO validado contra
// o Mercado Pago real (o sandbox não aprova Pix): prazo, comissão devolvida e saldo exigido na conta do
// vendedor ficam por confirmar no primeiro uso com dinheiro real (ver docs/MERCADOPAGO_PIX.md).
async function devolverPagamento(config, { accessToken, idExterno, idempotencia }) {
    let dados;

    try {
        dados = await chamar(config, {
            metodo: 'POST',
            base: config.apiUrl,
            caminho: `/v1/payments/${encodeURIComponent(idExterno)}/refunds`,
            corpo: {},
            token: accessToken,
            idempotencia
        });
    } catch (error) {
        // 120065 = a conta do vendedor não tem saldo disponível para a devolução (visto em produção; o
        // app do Mercado Pago recusa igual). Mensagem curta: vai também para cobranca_devolucoes.erro (200).
        if (error.codigosProvedor?.includes(CODIGO_SALDO_INSUFICIENTE)) {
            throw new AppError(MENSAGEM_SALDO_INSUFICIENTE, 424);
        }

        throw error;
    }

    if (!dados || dados.id === undefined) {
        throw new AppError('Resposta inesperada do Mercado Pago ao devolver o Pix.', 424);
    }

    return { idExterno: String(dados.id), status: dados.status ?? null };
}

module.exports = {
    montarUrlAutorizacao, trocarCodigo, renovarToken, criarPagamentoPix, criarPreferenciaCartao,
    buscarPagamentosPorReferencia, buscarPagamento, devolverPagamento, descritivoDeFatura
};

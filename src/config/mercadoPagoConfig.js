// Configuração da integração Mercado Pago, lida do ambiente a cada chamada.
// Sem as variáveis obrigatórias a integração fica DESLIGADA (nada quebra, rotas respondem 503).
//
//   MP_APP_ID           número da aplicação (identificador, não é segredo)
//   MP_CLIENT_SECRET    segredo da aplicação (SEGREDO)
//   MP_REDIRECT_URI     URL de retorno do OAuth cadastrada na aplicação (…/integracoes/mercadopago/callback)
//   MP_WEBHOOK_SECRET   assinatura secreta dos webhooks (SEGREDO)
//   MP_WEBHOOK_URL      URL pública do webhook (…/webhooks/mercadopago)
//   MP_TOKEN_ENC_KEY    chave de 32 bytes em base64 para cifrar os tokens das lojas (SEGREDO)
//   MP_FRONTEND_URL     origem do frontend para onde o retorno do OAuth redireciona
//   MP_SANDBOX          'true' envia test_token no OAuth (credenciais de teste)
//   MP_EMAIL_PAGADOR_PADRAO  opcional: e-mail neutro (da plataforma) enviado como payer.email do Pix quando o PDV não
//                       informa o e-mail do cliente. Inválido ou ausente = ignorado (cai no e-mail de contato da empresa).
//   MP_API_URL / MP_AUTH_URL  opcionais (padrão: api.mercadopago.com / auth.mercadopago.com)

const OBRIGATORIAS = ['MP_APP_ID', 'MP_CLIENT_SECRET', 'MP_REDIRECT_URI', 'MP_WEBHOOK_SECRET', 'MP_WEBHOOK_URL', 'MP_TOKEN_ENC_KEY', 'MP_FRONTEND_URL'];

function semBarraFinal(url) {
    return String(url).replace(/\/+$/, '');
}

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Opcional e nunca derruba a integração: valor fora do formato vira null.
function lerEmailPadrao(valor) {
    const email = String(valor ?? '').trim();

    return email.length <= 254 && FORMATO_EMAIL.test(email) ? email : null;
}

function obterConfigMercadoPago(env = process.env) {
    const faltando = OBRIGATORIAS.filter((nome) => !env[nome] || !String(env[nome]).trim());

    if (faltando.length) {
        return null;
    }

    const chave = Buffer.from(env.MP_TOKEN_ENC_KEY.trim(), 'base64');

    // Chave inválida desliga a integração (fail-closed) em vez de cifrar com algo fraco.
    if (chave.length !== 32) {
        return null;
    }

    return {
        appId: env.MP_APP_ID.trim(),
        clientSecret: env.MP_CLIENT_SECRET.trim(),
        redirectUri: env.MP_REDIRECT_URI.trim(),
        webhookSecret: env.MP_WEBHOOK_SECRET.trim(),
        webhookUrl: env.MP_WEBHOOK_URL.trim(),
        chaveCifra: chave,
        frontendUrl: semBarraFinal(env.MP_FRONTEND_URL.trim()),
        emailPagadorPadrao: lerEmailPadrao(env.MP_EMAIL_PAGADOR_PADRAO),
        sandbox: String(env.MP_SANDBOX).toLowerCase() === 'true',
        apiUrl: semBarraFinal(env.MP_API_URL || 'https://api.mercadopago.com'),
        authUrl: semBarraFinal(env.MP_AUTH_URL || 'https://auth.mercadopago.com')
    };
}

module.exports = { obterConfigMercadoPago, OBRIGATORIAS };

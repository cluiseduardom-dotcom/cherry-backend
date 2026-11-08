const AppError = require('../errors/AppError');

// Verificação anti-robô da loja (Cloudflare Turnstile). Único ponto que fala com a Cloudflare.
// O token vem do navegador; quem decide se vale é o servidor, aqui. O segredo (TURNSTILE_SECRET_KEY) nunca
// vai ao frontend, a log nem a mensagem de erro. Falha fechada: sem resposta da Cloudflare, o pedido não passa.
//
// Politica: em production e staging a verificação é OBRIGATÓRIA (sem o segredo configurado, o pedido responde 503
// e o erro vai ao log); em development e test, só roda se o segredo estiver configurado.

const URL_VERIFICACAO = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;
const AMBIENTES_OBRIGATORIOS = new Set(['production', 'staging']);

function modoDaVerificacao(env = process.env) {
    const segredo = (env.TURNSTILE_SECRET_KEY || '').trim();

    if (segredo) return 'ativa';

    return AMBIENTES_OBRIGATORIOS.has(env.NODE_ENV) ? 'mal_configurada' : 'desligada';
}

// Devolve normalmente se o token for válido; lança AppError (com `codigo`) caso contrário.
async function exigirVerificacao({ token, ip, env = process.env }) {
    const modo = modoDaVerificacao(env);

    if (modo === 'desligada') return;

    if (modo === 'mal_configurada') {
        console.error('TURNSTILE_SECRET_KEY não configurada: a loja recusa pedidos até configurar a verificação anti-robô.');
        const erro = new AppError('Não foi possível validar a verificação de segurança agora. Tente novamente em instantes.', 503);
        erro.codigo = 'CAPTCHA_INDISPONIVEL';
        throw erro;
    }

    if (!token) {
        const erro = new AppError('Confirme a verificação de segurança para continuar.', 400);
        erro.codigo = 'CAPTCHA_OBRIGATORIO';
        throw erro;
    }

    const corpo = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY.trim(), response: token });
    if (ip) corpo.set('remoteip', ip);

    let resultado;

    try {
        const resposta = await fetch(URL_VERIFICACAO, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: corpo,
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        resultado = await resposta.json();
    } catch (error) {
        // Só o tipo do erro vai ao log: a requisição leva o segredo e nunca entra em texto de erro.
        console.error(`Falha ao consultar a verificação anti-robô: ${error.name}`);
        const erro = new AppError('Não foi possível validar a verificação de segurança agora. Tente novamente em instantes.', 503);
        erro.codigo = 'CAPTCHA_INDISPONIVEL';
        throw erro;
    }

    if (resultado?.success !== true) {
        const erro = new AppError('A verificação de segurança falhou ou expirou. Tente novamente.', 403);
        erro.codigo = 'CAPTCHA_INVALIDO';
        throw erro;
    }
}

module.exports = { exigirVerificacao, modoDaVerificacao, URL_VERIFICACAO };

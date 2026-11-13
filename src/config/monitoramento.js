// Coleta de erros (Sentry), OPCIONAL: só liga com SENTRY_DSN. Sem a variável, nada é enviado e nada muda.
// Regra de privacidade: o evento enviado não leva dado pessoal. Sem corpo/headers/cookies/query da requisição, sem
// usuário, sem breadcrumbs (que poderiam trazer logs com dados), e as mensagens passam por máscara de e-mail, CPF,
// telefone, token e URL de banco. Só erros inesperados (5xx) são reportados, nunca 4xx de entrada do usuário.
const MAX_MENSAGEM = 300;

const MASCARAS = [
    [/postgres(?:ql)?:\/\/\S+/gi, '[url-banco]'],
    [/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [token]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
    [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
    [/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]']
];

function mascarar(texto) {
    if (typeof texto !== 'string') return texto;

    let saida = texto;
    for (const [regra, troca] of MASCARAS) saida = saida.replace(regra, troca);

    return saida.length > MAX_MENSAGEM ? `${saida.slice(0, MAX_MENSAGEM)}…` : saida;
}

// Caminho sem query string (a query pode ter e-mail, código de pedido etc.).
function semQuery(url) {
    return typeof url === 'string' ? url.split('?')[0].split('#')[0] : url;
}

function limparEvento(evento) {
    if (!evento || typeof evento !== 'object') return evento;

    const limpo = { ...evento };

    if (limpo.request) {
        limpo.request = { method: limpo.request.method, url: semQuery(limpo.request.url) };
    }

    delete limpo.user;
    delete limpo.extra;
    limpo.breadcrumbs = [];
    if (limpo.message) limpo.message = mascarar(limpo.message);

    if (limpo.exception?.values) {
        limpo.exception = {
            ...limpo.exception,
            values: limpo.exception.values.map((v) => ({ ...v, value: mascarar(v.value) }))
        };
    }

    return limpo;
}

let Sentry = null;

function iniciarMonitoramento(env = process.env) {
    const dsn = env.SENTRY_DSN && env.SENTRY_DSN.trim();

    if (!dsn) return false;

    Sentry = require('@sentry/node');
    Sentry.init({
        dsn,
        environment: env.NODE_ENV || 'development',
        release: env.RENDER_GIT_COMMIT || undefined,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        maxBreadcrumbs: 0,
        beforeSend: limparEvento
    });

    return true;
}

// Reporta um erro inesperado. `contexto.rota` é o TEMPLATE da rota (ex.: /vendas/:id), nunca a URL com ids/dados.
function registrarErro(erro, contexto = {}) {
    if (!Sentry) return false;

    Sentry.captureException(erro, { tags: { rota: contexto.rota || 'desconhecida', metodo: contexto.metodo || 'desconhecido' } });

    return true;
}

// Dá tempo de enviar antes de encerrar o processo (scripts de cron).
async function encerrarMonitoramento(ms = 2000) {
    if (Sentry) await Sentry.close(ms);
}

module.exports = { iniciarMonitoramento, registrarErro, encerrarMonitoramento, limparEvento, mascarar };

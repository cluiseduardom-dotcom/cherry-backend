'use strict';

// Proteção dos testes de integração: eles só podem rodar contra um banco de
// testes ISOLADO, informado de forma explícita em TEST_DATABASE_URL.
//
// Este módulo é PURO (nenhuma rede, nenhuma conexão): decide se uma URL pode ou
// não ser usada. Nunca devolve a URL completa em mensagens (só host e banco),
// para não vazar credenciais em logs.
//
// Regras (todas precisam passar):
//  1. TEST_DATABASE_URL existe e é uma URL postgres válida.
//  2. O NOME DO BANCO parece de teste (test/teste/ci como palavra: cherry_test,
//     cherry_ci...). Bancos de Neon/dev/produção se chamam "neondb" e caem aqui.
//  3. Não é o mesmo servidor/banco do DATABASE_URL habitual (arquivo .env ou
//     variável de ambiente), nem de nenhum host em BANCOS_COMPARTILHADOS_BLOQUEADOS.
//  4. Host remoto (que não seja loopback) só passa com uma segunda confirmação
//     explícita: TEST_DATABASE_HOST_PERMITIDO igual ao host da URL.
//  5. NODE_ENV=production nunca roda integração.

const fs = require('node:fs');
const path = require('node:path');

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
const NOME_DE_BANCO_DE_TESTE = /(^|[_-])(test|teste|ci)([_-]|$)/i;

function interpretarUrl(valor) {
    if (typeof valor !== 'string' || valor.trim() === '') return null;

    let url;
    try {
        url = new URL(valor.trim());
    } catch {
        return null;
    }

    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return null;

    return {
        host,
        porta: url.port || '5432',
        banco: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
}

const ehLocal = (host) => HOSTS_LOCAIS.has(host);

// Dois destinos são "o mesmo banco" se host, porta e nome do banco coincidem.
const mesmoBanco = (a, b) => a.host === b.host && a.porta === b.porta && a.banco === b.banco;

// Host remoto igual (ex.: outro banco no mesmo servidor Neon compartilhado).
const mesmoServidorRemoto = (a, b) => !ehLocal(a.host) && a.host === b.host;

// "ep-abc-pooler.região.neon.tech" e "ep-abc.região.neon.tech" são o mesmo compute.
const semPooler = (host) => host.replace(/-pooler(?=\.)/, '');

function listaDeHosts(valor) {
    return String(valor || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
        .map(semPooler);
}

/**
 * @param {object} p
 * @param {string} p.testUrl            valor de TEST_DATABASE_URL
 * @param {object} [p.env]              variáveis de ambiente (para NODE_ENV e allowlist)
 * @param {string[]} [p.urlsCompartilhadas]  DATABASE_URL(s) habituais a bloquear
 * @returns {{ ok: boolean, motivo?: string, destino?: { host: string, porta: string, banco: string } }}
 */
function validarBancoDeTeste({ testUrl, env = {}, urlsCompartilhadas = [] } = {}) {
    if (env.NODE_ENV === 'production') {
        return { ok: false, motivo: 'NODE_ENV=production: testes de integração nunca rodam em produção.' };
    }

    if (typeof testUrl !== 'string' || testUrl.trim() === '') {
        return {
            ok: false,
            motivo:
                'TEST_DATABASE_URL não está definida. Os testes de integração exigem um banco de testes ISOLADO, ' +
                'informado explicitamente no ambiente do shell (o .env e o DATABASE_URL habituais nunca são usados).',
        };
    }

    const destino = interpretarUrl(testUrl);
    if (!destino) {
        return { ok: false, motivo: 'TEST_DATABASE_URL não é uma URL postgres válida (postgres:// ou postgresql://).' };
    }

    const resumo = { host: destino.host, porta: destino.porta, banco: destino.banco };

    if (!NOME_DE_BANCO_DE_TESTE.test(destino.banco)) {
        return {
            ok: false,
            destino: resumo,
            motivo:
                `O banco "${destino.banco}" não tem nome de banco de testes (esperado algo como cherry_test ou cherry_ci). ` +
                'Bancos compartilhados de desenvolvimento e produção são rejeitados por este motivo.',
        };
    }

    for (const bruta of urlsCompartilhadas) {
        const compartilhado = interpretarUrl(bruta);
        if (!compartilhado) continue;

        // Banco local (CI/docker) pode ser, ao mesmo tempo, o DATABASE_URL e o de testes.
        if (ehLocal(compartilhado.host) && ehLocal(destino.host)) continue;

        const normalizado = { ...compartilhado, host: semPooler(compartilhado.host) };
        const alvo = { ...destino, host: semPooler(destino.host) };

        if (mesmoBanco(alvo, normalizado) || mesmoServidorRemoto(alvo, normalizado)) {
            return {
                ok: false,
                destino: resumo,
                motivo:
                    `TEST_DATABASE_URL aponta para o mesmo servidor/banco do DATABASE_URL habitual (${compartilhado.host}). ` +
                    'Use um banco de testes isolado, nunca o compartilhado.',
            };
        }
    }

    const bloqueados = listaDeHosts(env.BANCOS_COMPARTILHADOS_BLOQUEADOS);
    if (bloqueados.includes(semPooler(destino.host))) {
        return {
            ok: false,
            destino: resumo,
            motivo: `O host ${destino.host} está em BANCOS_COMPARTILHADOS_BLOQUEADOS.`,
        };
    }

    if (!ehLocal(destino.host)) {
        const permitido = listaDeHosts(env.TEST_DATABASE_HOST_PERMITIDO);
        if (!permitido.includes(semPooler(destino.host))) {
            return {
                ok: false,
                destino: resumo,
                motivo:
                    `O host ${destino.host} é remoto. Para usá-lo como banco de testes, confirme explicitamente com ` +
                    'TEST_DATABASE_HOST_PERMITIDO=<mesmo host>. Prefira um Postgres local ou descartável.',
            };
        }
    }

    return { ok: true, destino: resumo };
}

// Lê só DATABASE_URL/DATABASE_MIGRATION_URL de um arquivo .env, SEM carregá-lo no
// ambiente (o .env nunca vira configuração de teste: aqui ele só alimenta a lista
// de bancos a BLOQUEAR). Parser mínimo, sem depender do dotenv.
function lerUrlsDoArquivoEnv(arquivo) {
    let conteudo;
    try {
        conteudo = fs.readFileSync(arquivo, 'utf8');
    } catch {
        return [];
    }

    const urls = [];
    for (const linha of conteudo.split(/\r?\n/)) {
        const m = linha.match(/^\s*(?:export\s+)?(DATABASE_URL|DATABASE_MIGRATION_URL)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        urls.push(m[2].replace(/^['"]|['"]$/g, '').trim());
    }
    return urls;
}

function lerUrlsCompartilhadas({ env = process.env, raiz = path.resolve(__dirname, '..', '..') } = {}) {
    return [
        ...lerUrlsDoArquivoEnv(path.join(raiz, '.env')),
        env.DATABASE_URL,
        env.DATABASE_MIGRATION_URL,
    ].filter((v) => typeof v === 'string' && v.trim() !== '');
}

function formatarFalha(resultado) {
    const alvo = resultado.destino ? ` [destino: ${resultado.destino.host}/${resultado.destino.banco}]` : '';
    return [
        'TESTES DE INTEGRAÇÃO BLOQUEADOS antes de abrir qualquer conexão.',
        `Motivo: ${resultado.motivo}${alvo}`,
        'Como configurar um banco de testes isolado: docs/TESTES.md',
        'Os testes unitários (npm test) não precisam de banco.',
    ].join('\n');
}

module.exports = {
    NOME_DE_BANCO_DE_TESTE,
    interpretarUrl,
    validarBancoDeTeste,
    lerUrlsDoArquivoEnv,
    lerUrlsCompartilhadas,
    formatarFalha,
};

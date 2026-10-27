'use strict';

// Medição de latência (opt-in): responde "o tempo que o usuário espera vem do app, do banco ou
// da distância entre os dois?". Só liga com LATENCIA_LOG=1; desligado, nada é instalado.
//
// O que sai no log (uma linha JSON por evento): método, ROTA (padrão, ex. /produtos/:id — nunca o
// caminho real), status, duração total, tempo e nº de consultas ao banco. Nunca registra IP,
// usuário, empresa, cabeçalhos, query string, corpo nem SQL.

const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const armazenamento = new AsyncLocalStorage();
const INTERVALO_MINIMO_PING_SEG = 30;

function habilitada(env = process.env) {
    return env.LATENCIA_LOG === '1';
}

function registrar(linha) {
    console.log(JSON.stringify(linha));
}

function arredondar(ms) {
    return Math.round(ms * 10) / 10;
}

function rotaDe(req) {
    const caminho = req.route && typeof req.route.path === 'string' ? req.route.path : null;
    if (!caminho) return 'nao_roteado';

    const base = req.baseUrl || '';
    return `${base}${caminho === '/' ? '' : caminho}` || '/';
}

function medirRequisicoes({ env = process.env, log = registrar } = {}) {
    return function medirRequisicao(req, res, next) {
        if (!habilitada(env)) return next();

        const inicio = performance.now();
        const contexto = { dbMs: 0, dbConsultas: 0 };

        res.on('finish', () => {
            log({
                evento: 'http_latencia',
                metodo: req.method,
                rota: rotaDe(req),
                status: res.statusCode,
                ms: arredondar(performance.now() - inicio),
                db_ms: arredondar(contexto.dbMs),
                db_consultas: contexto.dbConsultas
            });
        });

        return armazenamento.run(contexto, next);
    };
}

// Embrulha query() de um pool ou cliente: soma o tempo ao contexto da requisição em andamento.
// Fora de uma requisição (migrations, ping) ou com callback, passa direto.
function embrulharQuery(alvo) {
    const original = alvo.query.bind(alvo);

    alvo.query = function queryMedida(...args) {
        const contexto = armazenamento.getStore();
        if (!contexto || typeof args[args.length - 1] === 'function') return original(...args);

        const inicio = performance.now();
        const resultado = original(...args);
        if (!resultado || typeof resultado.finally !== 'function') return resultado;

        return resultado.finally(() => {
            contexto.dbMs += performance.now() - inicio;
            contexto.dbConsultas += 1;
        });
    };
}

function instrumentarPool(pool) {
    embrulharQuery(pool);

    const conectarOriginal = pool.connect.bind(pool);
    pool.connect = function conectarMedido(...args) {
        if (typeof args[args.length - 1] === 'function') return conectarOriginal(...args);

        return conectarOriginal(...args).then((cliente) => {
            if (!cliente.__latenciaInstrumentado) {
                embrulharQuery(cliente);
                cliente.__latenciaInstrumentado = true;
            }
            return cliente;
        });
    };

    return pool;
}

// Sonda periódica do banco, independente do tráfego (que é baixo): separa o tempo de ABRIR a
// conexão (inclui TLS) do tempo de UMA consulta `SELECT 1` numa conexão já aberta, que é a
// distância real app↔banco. Desligada sem LATENCIA_DB_PING_SEGUNDOS (mínimo 30).
function iniciarPingBanco(pool, { env = process.env, log = registrar, agendar = setInterval } = {}) {
    const segundos = Number(env.LATENCIA_DB_PING_SEGUNDOS);
    if (!habilitada(env) || !Number.isFinite(segundos) || segundos < INTERVALO_MINIMO_PING_SEG) return null;

    async function pingar() {
        let cliente;
        try {
            const inicioConexao = performance.now();
            cliente = await pool.connect();
            const conexaoMs = performance.now() - inicioConexao;

            const inicioConsulta = performance.now();
            await cliente.query('SELECT 1');
            const consultaMs = performance.now() - inicioConsulta;

            log({ evento: 'db_ping', conexao_ms: arredondar(conexaoMs), consulta_ms: arredondar(consultaMs) });
        } catch {
            // Sem detalhes do erro: podem conter host/usuário do banco.
            log({ evento: 'db_ping_erro' });
        } finally {
            if (cliente) cliente.release();
        }
    }

    pingar();
    const temporizador = agendar(pingar, segundos * 1000);
    if (temporizador && typeof temporizador.unref === 'function') temporizador.unref();
    return temporizador;
}

module.exports = { habilitada, medirRequisicoes, instrumentarPool, iniciarPingBanco, rotaDe };

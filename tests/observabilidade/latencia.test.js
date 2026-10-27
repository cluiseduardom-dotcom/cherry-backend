const express = require('express');
const request = require('supertest');
const {
    habilitada, medirRequisicoes, instrumentarPool, iniciarPingBanco, rotaDe
} = require('../../src/observabilidade/latencia');

const LIGADA = { LATENCIA_LOG: '1' };

function atraso(ms, valor) {
    return new Promise((resolve) => setTimeout(() => resolve(valor), ms));
}

function aguardarLog(logs, quantidade = 1) {
    return new Promise((resolve) => {
        const verificar = () => (logs.length >= quantidade ? resolve() : setTimeout(verificar, 5));
        verificar();
    });
}

describe('habilitada', () => {
    test('só liga com LATENCIA_LOG=1', () => {
        expect(habilitada({ LATENCIA_LOG: '1' })).toBe(true);
        expect(habilitada({ LATENCIA_LOG: 'true' })).toBe(false);
        expect(habilitada({})).toBe(false);
    });
});

describe('rotaDe', () => {
    test('junta o prefixo montado e o padrão da rota, nunca o caminho real', () => {
        expect(rotaDe({ baseUrl: '/produtos', route: { path: '/:id' } })).toBe('/produtos/:id');
    });

    test('rota "/" de um router montado vira só o prefixo', () => {
        expect(rotaDe({ baseUrl: '/vendas', route: { path: '/' } })).toBe('/vendas');
    });

    test('sem rota casada (404) vira nao_roteado', () => {
        expect(rotaDe({ baseUrl: '', url: '/segredo/123' })).toBe('nao_roteado');
    });
});

describe('medirRequisicoes', () => {
    test('desligada: segue adiante e não registra nada', async () => {
        const log = jest.fn();
        const app = express();
        app.use(medirRequisicoes({ env: {}, log }));
        app.get('/ping', (req, res) => res.json({ ok: true }));

        await request(app).get('/ping').expect(200);
        await atraso(20);

        expect(log).not.toHaveBeenCalled();
    });

    test('ligada: registra método, rota-padrão, status, tempo e consultas ao banco', async () => {
        const logs = [];
        const pool = {
            query: jest.fn(() => atraso(15, { rows: [] })),
            connect: jest.fn()
        };
        instrumentarPool(pool);

        const app = express();
        app.use(medirRequisicoes({ env: LIGADA, log: (linha) => logs.push(linha) }));
        const router = express.Router();
        router.get('/:id', async (req, res) => {
            await pool.query('SELECT 1');
            await pool.query('SELECT 2');
            res.json({ id: req.params.id });
        });
        app.use('/produtos', router);

        await request(app).get('/produtos/987?token=segredo').expect(200);
        await aguardarLog(logs);

        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            evento: 'http_latencia', metodo: 'GET', rota: '/produtos/:id', status: 200, db_consultas: 2
        });
        expect(logs[0].db_ms).toBeGreaterThanOrEqual(25);
        expect(logs[0].ms).toBeGreaterThanOrEqual(logs[0].db_ms);
        expect(JSON.stringify(logs[0])).not.toMatch(/987|segredo/);
    });

    test('rota inexistente registra nao_roteado e o status 404', async () => {
        const logs = [];
        const app = express();
        app.use(medirRequisicoes({ env: LIGADA, log: (linha) => logs.push(linha) }));

        await request(app).get('/qualquer/coisa/42').expect(404);
        await aguardarLog(logs);

        expect(logs[0]).toMatchObject({ rota: 'nao_roteado', status: 404, db_consultas: 0 });
    });

    test('requisições simultâneas não misturam o tempo de banco', async () => {
        const logs = [];
        const pool = { query: jest.fn((sql) => atraso(sql === 'LENTA' ? 60 : 1, {})), connect: jest.fn() };
        instrumentarPool(pool);

        const app = express();
        app.use(medirRequisicoes({ env: LIGADA, log: (linha) => logs.push(linha) }));
        app.get('/lenta', async (req, res) => { await pool.query('LENTA'); res.end(); });
        app.get('/rapida', async (req, res) => { await pool.query('RAPIDA'); res.end(); });

        await Promise.all([request(app).get('/lenta'), request(app).get('/rapida')]);
        await aguardarLog(logs, 2);

        const lenta = logs.find((l) => l.rota === '/lenta');
        const rapida = logs.find((l) => l.rota === '/rapida');
        expect(lenta.db_ms).toBeGreaterThanOrEqual(55);
        expect(rapida.db_ms).toBeLessThan(40);
        expect(lenta.db_consultas).toBe(1);
        expect(rapida.db_consultas).toBe(1);
    });
});

describe('instrumentarPool', () => {
    test('fora de uma requisição passa direto, sem contar', async () => {
        const original = jest.fn().mockResolvedValue({ rows: [1] });
        const pool = { query: original, connect: jest.fn() };
        instrumentarPool(pool);

        await expect(pool.query('SELECT 1')).resolves.toEqual({ rows: [1] });
        expect(original).toHaveBeenCalledWith('SELECT 1');
    });

    test('erro da consulta continua sendo propagado e a consulta conta', async () => {
        const logs = [];
        const pool = { query: jest.fn().mockRejectedValue(new Error('falhou')), connect: jest.fn() };
        instrumentarPool(pool);

        const app = express();
        app.use(medirRequisicoes({ env: LIGADA, log: (linha) => logs.push(linha) }));
        app.get('/erro', async (req, res) => {
            try { await pool.query('X'); } catch (e) { res.status(500).json({ erro: e.message }); }
        });

        const resposta = await request(app).get('/erro');
        await aguardarLog(logs);

        expect(resposta.body.erro).toBe('falhou');
        expect(logs[0]).toMatchObject({ status: 500, db_consultas: 1 });
    });

    test('forma com callback não é embrulhada', () => {
        const original = jest.fn();
        const pool = { query: original, connect: jest.fn() };
        instrumentarPool(pool);
        const callback = () => {};

        pool.query('SELECT 1', callback);

        expect(original).toHaveBeenCalledWith('SELECT 1', callback);
    });

    test('clientes de transação também são medidos, e só uma vez', async () => {
        const logs = [];
        const cliente = { query: jest.fn(() => atraso(10, {})), release: jest.fn() };
        const pool = { query: jest.fn(), connect: jest.fn().mockResolvedValue(cliente) };
        instrumentarPool(pool);

        const app = express();
        app.use(medirRequisicoes({ env: LIGADA, log: (linha) => logs.push(linha) }));
        app.get('/tx', async (req, res) => {
            const c1 = await pool.connect();
            await c1.query('BEGIN');
            await c1.query('COMMIT');
            const c2 = await pool.connect();
            await c2.query('SELECT 1');
            c1.release();
            res.end();
        });

        await request(app).get('/tx').expect(200);
        await aguardarLog(logs);

        expect(logs[0].db_consultas).toBe(3);
    });
});

describe('iniciarPingBanco', () => {
    function poolFalso({ falhaConexao = false, falhaConsulta = false } = {}) {
        const cliente = {
            query: jest.fn(() => (falhaConsulta ? Promise.reject(new Error('host=secreto.neon.tech')) : atraso(3, {}))),
            release: jest.fn()
        };
        const pool = { connect: jest.fn(() => (falhaConexao ? Promise.reject(new Error('senha=abc')) : atraso(5, cliente))) };
        return { pool, cliente };
    }

    test.each([
        ['sem LATENCIA_LOG', { LATENCIA_DB_PING_SEGUNDOS: '60' }],
        ['sem intervalo', { LATENCIA_LOG: '1' }],
        ['intervalo abaixo do mínimo', { LATENCIA_LOG: '1', LATENCIA_DB_PING_SEGUNDOS: '10' }],
        ['intervalo inválido', { LATENCIA_LOG: '1', LATENCIA_DB_PING_SEGUNDOS: 'abc' }]
    ])('desligada (%s)', (_nome, env) => {
        const { pool } = poolFalso();
        const agendar = jest.fn();

        expect(iniciarPingBanco(pool, { env, agendar, log: jest.fn() })).toBeNull();
        expect(agendar).not.toHaveBeenCalled();
        expect(pool.connect).not.toHaveBeenCalled();
    });

    test('mede conexão e consulta separadas, libera o cliente e agenda no intervalo', async () => {
        const logs = [];
        const { pool, cliente } = poolFalso();
        const unref = jest.fn();
        const agendar = jest.fn(() => ({ unref }));

        iniciarPingBanco(pool, { env: { LATENCIA_LOG: '1', LATENCIA_DB_PING_SEGUNDOS: '300' }, agendar, log: (l) => logs.push(l) });
        await aguardarLog(logs);

        expect(logs[0].evento).toBe('db_ping');
        expect(logs[0].conexao_ms).toBeGreaterThanOrEqual(4);
        expect(logs[0].consulta_ms).toBeGreaterThanOrEqual(2);
        expect(cliente.query).toHaveBeenCalledWith('SELECT 1');
        expect(cliente.release).toHaveBeenCalledTimes(1);
        expect(agendar).toHaveBeenCalledWith(expect.any(Function), 300000);
        expect(unref).toHaveBeenCalled();
    });

    test('falha de conexão ou de consulta registra db_ping_erro sem vazar a mensagem', async () => {
        for (const opcoes of [{ falhaConexao: true }, { falhaConsulta: true }]) {
            const logs = [];
            const { pool, cliente } = poolFalso(opcoes);

            iniciarPingBanco(pool, {
                env: { LATENCIA_LOG: '1', LATENCIA_DB_PING_SEGUNDOS: '60' }, agendar: jest.fn(), log: (l) => logs.push(l)
            });
            await aguardarLog(logs);

            expect(logs[0]).toEqual({ evento: 'db_ping_erro' });
            expect(JSON.stringify(logs[0])).not.toMatch(/secreto|senha/);
            if (opcoes.falhaConsulta) expect(cliente.release).toHaveBeenCalledTimes(1);
        }
    });
});

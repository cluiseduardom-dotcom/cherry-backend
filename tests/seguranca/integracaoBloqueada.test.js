const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Executa o Jest de verdade (projeto "integration") num processo filho, sem nenhum banco
// real, e mede se alguma conexão chega a ser aberta. O "banco" é um servidor TCP local de
// mentira que só CONTA conexões (e as derruba): ele nunca fala o protocolo do Postgres.

const RAIZ = path.resolve(__dirname, '..', '..');
const JEST = path.join(RAIZ, 'node_modules', 'jest', 'bin', 'jest.js');

jest.setTimeout(120000);

let servidor;
let porta;
let conexoes = 0;

beforeAll(async () => {
    servidor = net.createServer((socket) => {
        conexoes += 1;
        socket.destroy();
    });

    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    porta = servidor.address().port;
});

afterAll(async () => {
    await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
    conexoes = 0;
});

// ASSÍNCRONO de propósito: com spawnSync o loop de eventos deste teste ficaria bloqueado e o
// servidor falso não conseguiria aceitar (nem contar) as conexões feitas pelo filho.
function rodarIntegracao(envExtra = {}) {
    const env = { ...process.env };

    // ambiente limpo: nada de banco herdado do processo que roda este teste
    for (const chave of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'TEST_DATABASE_URL', 'TEST_DATABASE_HOST_PERMITIDO',
        'BANCOS_COMPARTILHADOS_BLOQUEADOS', 'TESTE_DE_INTEGRACAO', 'JEST_WORKER_ID', 'NODE_ENV']) {
        delete env[chave];
    }

    return new Promise((resolve, reject) => {
        const filho = spawn(process.execPath, [JEST, '--selectProjects', 'integration', '--runInBand', '--ci', '--silent'], {
            cwd: RAIZ,
            env: { ...env, FORCE_COLOR: '0', ...envExtra },
        });

        let saida = '';
        filho.stdout.on('data', (d) => { saida += d; });
        filho.stderr.on('data', (d) => { saida += d; });

        const limite = setTimeout(() => { filho.kill(); reject(new Error('o jest filho excedeu o tempo limite')); }, 100000);

        filho.on('error', reject);
        filho.on('close', (codigo) => {
            clearTimeout(limite);
            // dá um instante para o servidor falso processar conexões já aceitas pelo SO
            setTimeout(() => resolve({ codigo, saida }), 200);
        });
    });
}

const MENSAGEM_DO_BLOQUEIO = /TESTES DE INTEGRAÇÃO BLOQUEADOS antes de abrir qualquer conexão/;

describe('integração bloqueada ANTES de abrir conexão', () => {
    test('sem TEST_DATABASE_URL: falha com mensagem clara e zero conexões, mesmo com DATABASE_URL apontando para um banco', async () => {
        const { codigo, saida } = await rodarIntegracao({
            // o "banco compartilhado" habitual: se fosse usado como alternativa, apareceria como conexão
            DATABASE_URL: `postgresql://app:senha@127.0.0.1:${porta}/cherry_test`,
        });

        expect(codigo).not.toBe(0);
        expect(saida).toMatch(MENSAGEM_DO_BLOQUEIO);
        expect(saida).toMatch(/TEST_DATABASE_URL não está definida/);
        expect(conexoes).toBe(0);
    });

    test('banco "compartilhado de desenvolvimento" (host remoto, neondb): rejeitado sem conexão', async () => {
        const dev = 'postgresql://app:segredo-dev@ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech/neondb';

        const { codigo, saida } = await rodarIntegracao({ DATABASE_URL: dev, TEST_DATABASE_URL: dev });

        expect(codigo).not.toBe(0);
        expect(saida).toMatch(MENSAGEM_DO_BLOQUEIO);
        expect(saida).toMatch(/não tem nome de banco de testes/);
        expect(saida).not.toMatch(/segredo-dev/);
        expect(saida).not.toMatch(/ENOTFOUND|ECONNREFUSED|Connection terminated/);
    });

    test('produção: mesmo com nome de banco de teste e host "permitido", o servidor listado como compartilhado é bloqueado', async () => {
        const prod = 'postgresql://app:segredo-prod@ep-exemplo-prod.sa-east-1.aws.neon.tech/cherry_test';

        const { codigo, saida } = await rodarIntegracao({
            TEST_DATABASE_URL: prod,
            TEST_DATABASE_HOST_PERMITIDO: 'ep-exemplo-prod.sa-east-1.aws.neon.tech',
            BANCOS_COMPARTILHADOS_BLOQUEADOS: 'ep-exemplo-prod.sa-east-1.aws.neon.tech',
        });

        expect(codigo).not.toBe(0);
        expect(saida).toMatch(MENSAGEM_DO_BLOQUEIO);
        expect(saida).toMatch(/BANCOS_COMPARTILHADOS_BLOQUEADOS/);
        expect(saida).not.toMatch(/segredo-prod/);
    });

    test('banco local com nome de banco real (não de teste): rejeitado sem conexão', async () => {
        const { codigo, saida } = await rodarIntegracao({
            DATABASE_URL: `postgresql://app:senha@127.0.0.1:${porta}/neondb`,
            TEST_DATABASE_URL: `postgresql://app:senha@127.0.0.1:${porta}/neondb`,
        });

        expect(codigo).not.toBe(0);
        expect(saida).toMatch(MENSAGEM_DO_BLOQUEIO);
        expect(conexoes).toBe(0);
    });

    test('NODE_ENV=production: bloqueado sem conexão, mesmo com URL de teste válida', async () => {
        const { codigo, saida } = await rodarIntegracao({
            NODE_ENV: 'production',
            TEST_DATABASE_URL: `postgresql://app:senha@127.0.0.1:${porta}/cherry_test`,
        });

        expect(codigo).not.toBe(0);
        expect(saida).toMatch(MENSAGEM_DO_BLOQUEIO);
        expect(saida).toMatch(/production/);
        expect(conexoes).toBe(0);
    });
});

describe('banco de testes isolado: a execução é permitida', () => {
    test('URL local com nome de banco de teste passa na validação e só então tenta UMA conexão de identidade', async () => {
        const { codigo, saida } = await rodarIntegracao({
            // diferente do banco "compartilhado" informado em DATABASE_URL (que nunca deve ser tocado)
            DATABASE_URL: 'postgresql://app:senha@ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech/neondb',
            TEST_DATABASE_URL: `postgresql://cherry:cherry@127.0.0.1:${porta}/cherry_test`,
        });

        // o "servidor" não é um Postgres: a conexão de identidade falha, mas FOI tentada -> a validação liberou
        expect(saida).not.toMatch(MENSAGEM_DO_BLOQUEIO);
        expect(codigo).not.toBe(0);
        expect(conexoes).toBeGreaterThanOrEqual(1);
        // e nenhuma suíte chegou a rodar (o globalSetup falhou antes de qualquer escrita)
        expect(saida).not.toMatch(/Tests:\s+\d+ passed/);
    });
});

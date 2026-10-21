const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Executa tests/integration/setupIntegracao.js num processo Node de verdade (com o dotenv
// REAL, sem o stub do Jest) para provar que, mesmo se um .env ou o ambiente trouxerem
// DATABASE_URL/DATABASE_MIGRATION_URL de bancos compartilhados, o pool da aplicação termina
// apontado SÓ para a TEST_DATABASE_URL validada.

const RAIZ = path.resolve(__dirname, '..', '..');
const SETUP = path.join(RAIZ, 'tests', 'integration', 'setupIntegracao.js');
const DB = path.join(RAIZ, 'src', 'config', 'db.js');

const COMPARTILHADO_RUNTIME = 'postgresql://app:senha-compartilhada@ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech/neondb';
const COMPARTILHADO_MIGRACAO = 'postgresql://dono:senha-dono@ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech/neondb';
const BANCO_DE_TESTE = 'postgresql://cherry:cherry@localhost:5432/cherry_test';

let pastaSemEnv;
let pastaComEnv;

beforeAll(() => {
    // pasta vazia: nenhum .env
    pastaSemEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-integ-vazia-'));

    // pasta com um .env "malicioso" que tenta trazer os bancos compartilhados
    pastaComEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-integ-env-'));
    fs.writeFileSync(
        path.join(pastaComEnv, '.env'),
        [`DATABASE_URL=${COMPARTILHADO_RUNTIME}`, `DATABASE_MIGRATION_URL=${COMPARTILHADO_MIGRACAO}`, `TEST_DATABASE_URL=${COMPARTILHADO_RUNTIME}`].join('\n')
    );
});

afterAll(() => {
    fs.rmSync(pastaSemEnv, { recursive: true, force: true });
    fs.rmSync(pastaComEnv, { recursive: true, force: true });
});

function rodarSetup({ cwd, env }) {
    const base = { ...process.env };
    for (const chave of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'TEST_DATABASE_URL', 'TEST_DATABASE_HOST_PERMITIDO',
        'BANCOS_COMPARTILHADOS_BLOQUEADOS', 'TESTE_DE_INTEGRACAO', 'NODE_ENV', 'JEST_WORKER_ID']) {
        delete base[chave];
    }

    const script = `
        require(${JSON.stringify(SETUP)});
        const pool = require(${JSON.stringify(DB)});            // dotenv REAL: lê o .env do cwd, se existir
        const u = new URL(pool.options.connectionString);
        console.log(JSON.stringify({
            host: u.hostname,
            banco: u.pathname.slice(1),
            migracao: process.env.DATABASE_MIGRATION_URL,
            flag: process.env.TESTE_DE_INTEGRACAO,
        }));
    `;

    const r = spawnSync(process.execPath, ['-e', script], { cwd, env: { ...base, ...env }, encoding: 'utf8', timeout: 30000 });

    return { codigo: r.status, stdout: (r.stdout || '').trim(), stderr: r.stderr || '' };
}

describe('setupIntegracao: o pool da aplicação só aponta para a TEST_DATABASE_URL', () => {
    test('com DATABASE_URL e DATABASE_MIGRATION_URL compartilhadas no ambiente, ganha a TEST_DATABASE_URL', () => {
        const r = rodarSetup({
            cwd: pastaSemEnv,
            env: { DATABASE_URL: COMPARTILHADO_RUNTIME, DATABASE_MIGRATION_URL: COMPARTILHADO_MIGRACAO, TEST_DATABASE_URL: BANCO_DE_TESTE },
        });

        expect(r.codigo).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ host: 'localhost', banco: 'cherry_test', migracao: '', flag: '1' });
        expect(r.stdout).not.toMatch(/neon\.tech|neondb/);
    });

    test('um .env que tenta trazer os bancos compartilhados NÃO sobrepõe (nem com o dotenv real)', () => {
        const r = rodarSetup({ cwd: pastaComEnv, env: { TEST_DATABASE_URL: BANCO_DE_TESTE } });

        expect(r.codigo).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ host: 'localhost', banco: 'cherry_test', migracao: '', flag: '1' });
        expect(r.stdout).not.toMatch(/neon\.tech|neondb/);
    });

    test('sem TEST_DATABASE_URL, o setup falha e o DATABASE_URL do ambiente NÃO é usado como alternativa', () => {
        const r = rodarSetup({ cwd: pastaSemEnv, env: { DATABASE_URL: BANCO_DE_TESTE } });

        expect(r.codigo).not.toBe(0);
        expect(r.stderr).toMatch(/TESTES DE INTEGRAÇÃO BLOQUEADOS/);
        expect(r.stdout).toBe('');
    });

    test('TEST_DATABASE_URL só existir dentro do .env não conta (o .env não é lido para configurar testes)', () => {
        const r = rodarSetup({ cwd: pastaComEnv, env: {} });

        expect(r.codigo).not.toBe(0);
        expect(r.stderr).toMatch(/TEST_DATABASE_URL não está definida/);
    });

    test('TEST_DATABASE_URL igual ao DATABASE_URL compartilhado do ambiente é rejeitada', () => {
        const r = rodarSetup({
            cwd: pastaSemEnv,
            env: {
                DATABASE_URL: COMPARTILHADO_RUNTIME,
                TEST_DATABASE_URL: COMPARTILHADO_RUNTIME.replace('/neondb', '/cherry_test'),
                TEST_DATABASE_HOST_PERMITIDO: 'ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech',
            },
        });

        expect(r.codigo).not.toBe(0);
        expect(r.stderr).toMatch(/mesmo servidor\/banco do DATABASE_URL habitual/);
        expect(r.stderr).not.toMatch(/senha-compartilhada/);
    });
});

// Executa as suítes de integração SOMENTE contra um PostgreSQL descartável em
// loopback, informado em TEST_DATABASE_URL. Não lê .env. O Jest (tests/globalSetup.js)
// ainda exige o marcador gravado no banco; sem ele nada é executado:
//   COMMENT ON DATABASE <banco> IS 'giroone:banco-descartavel-de-teste';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { validarUrlDeBancoDescartavel } = require('../src/config/databaseUrl');
const { limparVariaveisDeConexao, variaveisPgPresentes } = require('../src/config/testDatabaseSafety');

const RAIZ = path.join(__dirname, '..');
const SUITES = [
    ...fs.readdirSync(path.join(RAIZ, 'tests', 'routes'))
        .filter((nome) => nome.endsWith('.integration.test.js') || nome === 'multiTenantIsolation.test.js')
        .map((nome) => path.join('tests', 'routes', nome)),
    path.join('tests', 'database', 'migration045.test.js')
];

function main() {
    if (variaveisPgPresentes(process.env).length) {
        throw new Error('Integração bloqueada: remova as variáveis PG* do ambiente');
    }

    const { connectionString } = validarUrlDeBancoDescartavel(process.env.TEST_DATABASE_URL);
    const env = { ...process.env };
    limparVariaveisDeConexao(env);
    env.TEST_DATABASE_URL = connectionString;
    env.RUN_DB_INTEGRATION_TESTS = '1';

    const jest = path.join(RAIZ, 'node_modules', 'jest', 'bin', 'jest.js');
    const resultado = spawnSync(process.execPath, [jest, '--runInBand', '--runTestsByPath', ...SUITES], {
        cwd: RAIZ, env, stdio: 'inherit'
    });

    process.exit(resultado.status ?? 1);
}

try {
    main();
} catch (erro) {
    console.error(erro.message);
    process.exit(1);
}

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const { limparVariaveisDeConexao } = require('../src/config/testDatabaseSafety');
const { validarUrlDeBancoDescartavel } = require('../src/config/databaseUrl');

// Só a integração (iniciada por scripts/runIntegrationTests.js e confirmada no
// globalSetup) recebe o destino; qualquer outra execução fica sem conexão alguma.
const destinoIntegracao = process.env.RUN_DB_INTEGRATION_TESTS === '1' ? process.env.TEST_DATABASE_URL : undefined;

limparVariaveisDeConexao(process.env);
delete process.env.TEST_DATABASE_ISOLATED; // nunca aceita a flag vinda de fora

if (process.env.RUN_DB_INTEGRATION_TESTS === '1') {
    validarUrlDeBancoDescartavel(destinoIntegracao);
    process.env.DATABASE_URL = destinoIntegracao;
    process.env.TEST_DATABASE_ISOLATED = 'true';
}

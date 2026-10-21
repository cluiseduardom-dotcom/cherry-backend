const { Pool } = require('pg');
const { validarUrlDeBanco } = require('./databaseUrl');

const { carregarEnv, executandoSobJest } = require('./carregarEnv');

carregarEnv();

// Em teste, só a integração validada por tests/setup.js + globalSetup abre conexão real.
const integracaoIsolada = process.env.RUN_DB_INTEGRATION_TESTS === '1' && process.env.TEST_DATABASE_ISOLATED === 'true';
const testeUnitario = executandoSobJest() && !integracaoIsolada;
const pool = new Pool({ connectionString: testeUnitario ? process.env.DATABASE_URL : validarUrlDeBanco(process.env.DATABASE_URL) });

if (testeUnitario) {
    const falhar = () => {
        throw new Error('Acesso real ao banco é proibido em testes unitários');
    };
    module.exports = { query: falhar, connect: falhar, end: async () => {} };
} else {
    module.exports = pool;
}

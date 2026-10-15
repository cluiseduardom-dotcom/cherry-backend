'use strict';

// Dois projetos Jest, com regras de banco OPOSTAS:
//
//  unit         `npm test`. Nenhum banco: a conexão é trocada por um destino que recusa
//               (tests/setupBloqueioBanco.js) e o .env nunca é lido (stub do dotenv).
//
//  integration  `npm run test:integration`. Só roda com TEST_DATABASE_URL apontando
//               para um banco de testes ISOLADO. tests/integration/globalSetup.js valida
//               a URL e aborta a execução ANTES de qualquer conexão se ela for ausente,
//               compartilhada (dev/produção) ou suspeita. O DATABASE_URL habitual nunca
//               é usado como alternativa.
//
// Convenção: toda suíte que escreve no banco se chama `*.integration.test.js`
// (tests/seguranca/estrutura.test.js garante isso).

const base = {
    rootDir: __dirname,
    testEnvironment: 'node',
    // O .env nunca é lido pelos testes (db.js e migrate.js chamam dotenv.config()).
    moduleNameMapper: { '^dotenv$': '<rootDir>/tests/stubs/dotenv.js' },
};

module.exports = {
    projects: [
        {
            ...base,
            displayName: 'unit',
            testMatch: ['<rootDir>/tests/**/*.test.js'],
            testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.js$'],
            setupFiles: ['<rootDir>/tests/setup.js', '<rootDir>/tests/setupBloqueioBanco.js'],
            setupFilesAfterEnv: ['<rootDir>/tests/setupSessao.js'],
        },
        {
            ...base,
            displayName: 'integration',
            // migration045.test.js tem uma parte pura (roda no unit) e uma parte com banco
            // (só roda aqui, quando TESTE_DE_INTEGRACAO=1).
            testMatch: ['<rootDir>/tests/**/*.integration.test.js', '<rootDir>/tests/database/migration045.test.js'],
            globalSetup: '<rootDir>/tests/integration/globalSetup.js',
            setupFiles: ['<rootDir>/tests/setup.js', '<rootDir>/tests/integration/setupIntegracao.js'],
        },
    ],
};

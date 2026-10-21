// Roda uma vez no processo principal do Jest, antes de qualquer teste. Em execução
// unitária não faz nada; em integração exige a prova ativa de banco descartável.
const { verificarBancoDescartavel, variaveisPgPresentes } = require('../src/config/testDatabaseSafety');

module.exports = async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== '1') return;

    if (variaveisPgPresentes(process.env).length) {
        throw new Error('Integração bloqueada: variáveis PG* podem redirecionar a conexão');
    }

    await verificarBancoDescartavel(process.env.TEST_DATABASE_URL);
};

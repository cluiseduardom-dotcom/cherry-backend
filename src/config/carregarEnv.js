// Sob o Jest nunca se lê .env: testes que trocam NODE_ENV (production/staging) para
// exercitar configuração não podem importar a DATABASE_URL real do disco.
function executandoSobJest(env = process.env) {
    return env.NODE_ENV === 'test' || env.JEST_WORKER_ID !== undefined;
}

function carregarEnv() {
    if (executandoSobJest()) return;
    require('dotenv').config({ quiet: true });
}

module.exports = { carregarEnv, executandoSobJest };

const { criarPoolSeguro } = require('./securePgPool');
const { habilitada, instrumentarPool } = require('../observabilidade/latencia');
require('dotenv').config({ quiet: true });

const pool = criarPoolSeguro(process.env.DATABASE_URL);

// Medição de latência é opt-in (LATENCIA_LOG=1); desligada, o pool fica intacto.
if (habilitada()) instrumentarPool(pool);

module.exports = pool;

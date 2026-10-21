const { criarPoolSeguro } = require('./securePgPool');
require('dotenv').config({ quiet: true });

const pool = criarPoolSeguro(process.env.DATABASE_URL);

module.exports = pool;

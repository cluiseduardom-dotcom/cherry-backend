const { Pool } = require('pg');
const { validarUrlDeBanco } = require('./databaseUrl');
require('dotenv').config({ quiet: true });

const pool = new Pool({
    connectionString: validarUrlDeBanco(process.env.DATABASE_URL)
});

module.exports = pool;

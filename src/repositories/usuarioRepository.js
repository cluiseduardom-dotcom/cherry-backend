const db = require('../config/db');

async function buscarPorEmail(email) {
    const { rows } = await db.query(
        'SELECT * FROM usuarios WHERE email = $1 LIMIT 1',
        [email]
    );

    return rows.length ? rows[0] : null;
}

module.exports = {
    buscarPorEmail
};
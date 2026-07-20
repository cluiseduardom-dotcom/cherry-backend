const db = require('../config/db');

async function buscarPorEmail(email) {
    const { rows } = await db.query(
        'SELECT * FROM usuarios WHERE email = $1 LIMIT 1',
        [email]
    );

    return rows.length ? rows[0] : null;
}

async function criar({ nome, email, senha, papel }) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (nome, email, senha, papel)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nome, email, papel`,
        [nome, email, senha, papel]
    );

    return rows[0];
}

module.exports = {
    buscarPorEmail,
    criar
};
const db = require('../config/db');

async function buscarPorEmail(email) {
    const { rows } = await db.query(
        `SELECT u.*, e.status AS empresa_status
         FROM usuarios u
         JOIN empresas e ON e.id = u.empresa_id
         WHERE u.email = $1
         LIMIT 1`,
        [email]
    );

    return rows.length ? rows[0] : null;
}

async function criar({ nome, email, senha, papel, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (nome, email, senha, papel, empresa_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nome, email, papel, empresa_id`,
        [nome, email, senha, papel, empresa_id]
    );

    return rows[0];
}

module.exports = {
    buscarPorEmail,
    criar
};
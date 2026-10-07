const db = require('../config/db');

// Estado que decide se um JWT ainda vale. Filtra por id E empresa_id (do
// próprio token) na mesma query; null = usuário inexistente.
async function buscarEstado(usuario_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT u.ativo, u.token_version, e.status AS empresa_status
         FROM usuarios u
         JOIN empresas e ON e.id = u.empresa_id
         WHERE u.id = $1 AND u.empresa_id = $2`,
        [usuario_id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

module.exports = { buscarEstado };

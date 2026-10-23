const db = require('../config/db');

// Módulos ativos da empresa. empresa_id sempre vem do JWT (req.usuario), nunca do cliente.
async function listarAtivos(empresa_id) {
    const { rows } = await db.query(
        `SELECT modulo FROM empresa_modulos
         WHERE empresa_id = $1 AND ativo = true
         ORDER BY modulo`,
        [empresa_id]
    );

    return rows.map((linha) => linha.modulo);
}

async function estaAtivo(empresa_id, modulo) {
    const { rows } = await db.query(
        `SELECT 1 FROM empresa_modulos
         WHERE empresa_id = $1 AND modulo = $2 AND ativo = true`,
        [empresa_id, modulo]
    );

    return rows.length > 0;
}

module.exports = { listarAtivos, estaAtivo };

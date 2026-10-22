const db = require('../config/db');

// Toda consulta filtra por empresa_id (do token), nunca por um id vindo do cliente.

async function listarPorEmpresa(empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT cargo, nivel, ativo, capacidades
         FROM cargos_empresa
         WHERE empresa_id = $1`,
        [empresa_id]
    );

    return rows;
}

async function buscar(empresa_id, cargo, client = db) {
    const { rows } = await client.query(
        `SELECT cargo, nivel, ativo, capacidades
         FROM cargos_empresa
         WHERE empresa_id = $1 AND cargo = $2`,
        [empresa_id, cargo]
    );

    return rows.length ? rows[0] : null;
}

async function contarUsuariosAtivos(empresa_id, cargo, client = db) {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM usuarios
         WHERE empresa_id = $1 AND papel = $2 AND ativo = true`,
        [empresa_id, cargo]
    );

    return rows[0].total;
}

// A linha gravada é a verdade inteira do cargo no comércio (ver migration 050).
async function salvar({ empresa_id, cargo, nivel, ativo, capacidades, usuario_id }, client = db) {
    const { rows } = await client.query(
        `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades, atualizado_por, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (empresa_id, cargo) DO UPDATE
            SET nivel = EXCLUDED.nivel,
                ativo = EXCLUDED.ativo,
                capacidades = EXCLUDED.capacidades,
                atualizado_por = EXCLUDED.atualizado_por,
                atualizado_em = NOW()
         RETURNING cargo, nivel, ativo, capacidades`,
        [empresa_id, cargo, nivel, ativo, capacidades, usuario_id]
    );

    return rows[0];
}

module.exports = { listarPorEmpresa, buscar, contarUsuariosAtivos, salvar };

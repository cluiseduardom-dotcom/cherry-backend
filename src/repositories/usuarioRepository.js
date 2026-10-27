const db = require('../config/db');

async function buscarPorEmail(email) {
    const { rows } = await db.query(
        `SELECT u.*, e.status AS empresa_status, e.tema_visual AS empresa_tema
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

async function buscarSenhaHash(empresa_id, id) {
    const { rows } = await db.query(
        'SELECT senha FROM usuarios WHERE id = $1 AND empresa_id = $2 AND ativo = true',
        [id, empresa_id]
    );

    return rows.length ? rows[0].senha : null;
}

// Troca a senha do próprio usuário e avança token_version (derruba as demais sessões) na mesma
// transação da trilha em usuarios_eventos. O ator é sempre o alvo; empresa vem do JWT.
async function trocarPropriaSenha({ id, empresa_id, senhaHash }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `UPDATE usuarios SET senha = $1, senha_temporaria = false, token_version = token_version + 1
             WHERE id = $2 AND empresa_id = $3 AND ativo = true
             RETURNING id, papel, empresa_id, token_version`,
            [senhaHash, id, empresa_id]
        );

        if (!rows.length) {
            await client.query('ROLLBACK');
            return null;
        }

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo, campos)
             VALUES ($1, 'editar', $2, $3, $2, NULL, ARRAY['senha'])`,
            [empresa_id, id, rows[0].papel]
        );

        await client.query('COMMIT');

        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    buscarPorEmail,
    buscarSenhaHash,
    trocarPropriaSenha,
    criar
};
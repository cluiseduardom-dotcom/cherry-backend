const db = require('../config/db');
const AppError = require('../errors/AppError');

const COLUNAS_PUBLICAS = 'id, empresa_id, mp_user_id, ativo, conectado_por, conectado_em, token_expira_em, atualizado_em';

async function buscarConexao(empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT ${COLUNAS_PUBLICAS}, access_token_cifrado, refresh_token_cifrado
         FROM empresa_mercadopago WHERE empresa_id = $1`,
        [empresa_id]
    );

    return rows[0] ?? null;
}

async function criarEstado({ state, empresa_id, usuario_id, ttlMinutos }) {
    // Faxina de estados vencidos junto da criação: a tabela não cresce sem controle.
    await db.query(`DELETE FROM mp_oauth_estados WHERE expira_em < NOW() - INTERVAL '1 day'`);

    await db.query(
        `INSERT INTO mp_oauth_estados (state, empresa_id, usuario_id, expira_em)
         VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
        [state, empresa_id, usuario_id, String(ttlMinutos)]
    );
}

// Uso único e atômico: só devolve a linha se o estado existe, não foi usado e não venceu.
async function consumirEstado(state) {
    const { rows } = await db.query(
        `UPDATE mp_oauth_estados
         SET usado_em = NOW()
         WHERE state = $1 AND usado_em IS NULL AND expira_em > NOW()
         RETURNING empresa_id, usuario_id`,
        [state]
    );

    return rows[0] ?? null;
}

async function salvarConexao({ empresa_id, mp_user_id, accessCifrado, refreshCifrado, expiraEm, usuario_id }) {
    try {
        const { rows } = await db.query(
            `INSERT INTO empresa_mercadopago
                (empresa_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, token_expira_em, ativo, conectado_por)
             VALUES ($1, $2, $3, $4, $5, true, $6)
             ON CONFLICT (empresa_id) DO UPDATE SET
                mp_user_id = EXCLUDED.mp_user_id,
                access_token_cifrado = EXCLUDED.access_token_cifrado,
                refresh_token_cifrado = EXCLUDED.refresh_token_cifrado,
                token_expira_em = EXCLUDED.token_expira_em,
                ativo = true,
                conectado_por = EXCLUDED.conectado_por,
                conectado_em = NOW(),
                atualizado_em = NOW()
             RETURNING ${COLUNAS_PUBLICAS}`,
            [empresa_id, mp_user_id, accessCifrado, refreshCifrado, expiraEm, usuario_id]
        );

        return rows[0];
    } catch (error) {
        if (error.code === '23505') {
            throw new AppError('Esta conta do Mercado Pago já está conectada a outra empresa.', 409);
        }

        throw error;
    }
}

async function atualizarTokens({ empresa_id, accessCifrado, refreshCifrado, expiraEm }, client = db) {
    await client.query(
        `UPDATE empresa_mercadopago
         SET access_token_cifrado = $2, refresh_token_cifrado = $3, token_expira_em = $4, atualizado_em = NOW()
         WHERE empresa_id = $1 AND ativo = true`,
        [empresa_id, accessCifrado, refreshCifrado, expiraEm]
    );
}

// Desconectar apaga os tokens do banco (não ficam guardados "por segurança").
async function desativar(empresa_id) {
    const { rowCount } = await db.query(
        `UPDATE empresa_mercadopago
         SET ativo = false, access_token_cifrado = NULL, refresh_token_cifrado = NULL, token_expira_em = NULL, atualizado_em = NOW()
         WHERE empresa_id = $1 AND ativo = true`,
        [empresa_id]
    );

    return rowCount > 0;
}

module.exports = { buscarConexao, criarEstado, consumirEstado, salvarConexao, atualizarTokens, desativar };

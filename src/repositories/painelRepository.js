const db = require('../config/db');

// Operadores da plataforma (sem empresa_id: não são usuários de loja) e a trilha do painel.

const COLUNAS = `id, nome, email, senha, senha_temporaria, totp_segredo, totp_ativo, totp_ultimo_passo, ativo,
                 token_version, ultimo_acesso_em, criado_em`;

async function buscarPorEmail(email) {
    const { rows } = await db.query(`SELECT ${COLUNAS} FROM plataforma_operadores WHERE email = $1`, [String(email).trim().toLowerCase()]);
    return rows[0] ?? null;
}

async function buscarPorId(id) {
    const { rows } = await db.query(`SELECT ${COLUNAS} FROM plataforma_operadores WHERE id = $1`, [id]);
    return rows[0] ?? null;
}

async function guardarSegredoPendente(id, segredoCifrado) {
    await db.query(
        'UPDATE plataforma_operadores SET totp_segredo = $2 WHERE id = $1 AND totp_ativo = false',
        [id, segredoCifrado]
    );
}

async function ativarTotp(id, passo) {
    const { rowCount } = await db.query(
        `UPDATE plataforma_operadores SET totp_ativo = true, totp_ultimo_passo = $2
         WHERE id = $1 AND totp_ativo = false AND totp_segredo IS NOT NULL`,
        [id, passo]
    );
    return rowCount === 1;
}

// Consome o passo TOTP: só aceita um passo MAIOR que o último usado (o mesmo código não entra duas vezes).
async function consumirPasso(id, passo) {
    const { rowCount } = await db.query(
        `UPDATE plataforma_operadores SET totp_ultimo_passo = $2, ultimo_acesso_em = NOW()
         WHERE id = $1 AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < $2)`,
        [id, passo]
    );
    return rowCount === 1;
}

async function trocarSenha(id, senhaHash) {
    const { rows } = await db.query(
        `UPDATE plataforma_operadores SET senha = $2, senha_temporaria = false, token_version = token_version + 1
         WHERE id = $1 RETURNING ${COLUNAS}`,
        [id, senhaHash]
    );
    return rows[0] ?? null;
}

// Trilha só-inserção. `detalhe` nunca leva senha, código ou token.
async function registrarEvento({ operador_id = null, acao, alvo_empresa_id = null, detalhe = null, ip = null }, client = db) {
    await client.query(
        `INSERT INTO plataforma_eventos (operador_id, acao, alvo_empresa_id, detalhe, ip) VALUES ($1, $2, $3, $4, $5)`,
        [operador_id, acao, alvo_empresa_id, detalhe ? JSON.stringify(detalhe) : null, ip ? String(ip).slice(0, 64) : null]
    );
}

async function listarEventos({ limit = 50, offset = 0 } = {}) {
    const { rows } = await db.query(
        `SELECT ev.id, ev.acao, ev.alvo_empresa_id, e.nome AS alvo_empresa_nome, ev.detalhe, ev.ip, ev.criado_em,
                o.nome AS operador_nome, o.email AS operador_email
         FROM plataforma_eventos ev
         LEFT JOIN plataforma_operadores o ON o.id = ev.operador_id
         LEFT JOIN empresas e ON e.id = ev.alvo_empresa_id
         ORDER BY ev.criado_em DESC, ev.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    const { rows: [t] } = await db.query('SELECT COUNT(*)::int AS total FROM plataforma_eventos');
    return { items: rows, total: t.total };
}

module.exports = { buscarPorEmail, buscarPorId, guardarSegredoPendente, ativarTotp, consumirPasso, trocarSenha, registrarEvento, listarEventos };

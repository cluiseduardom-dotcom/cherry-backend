const db = require('../config/db');
const { obterLocal } = require('./conferenciasEstoqueRepository');

// `usuario_id` informado = visão restrita à maleta ativa desse usuário.
async function listarVisiveis({ empresa_id, usuario_id }) {
    const { rows } = await db.query(
        `SELECT l.id, l.tipo, l.nome, l.usuario_id, u.nome AS usuario_nome, l.cliente_id, c.nome AS cliente_nome, l.ativo
         FROM locais_estoque l
         LEFT JOIN usuarios u ON u.id = l.usuario_id AND u.empresa_id = l.empresa_id
         LEFT JOIN clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
         WHERE l.empresa_id = $1 AND l.ativo = true AND l.tipo <> 'transito'
           AND ($2::int IS NULL OR (l.tipo = 'maleta' AND l.usuario_id = $2))
         ORDER BY CASE l.tipo WHEN 'central' THEN 0 WHEN 'maleta' THEN 1 ELSE 2 END, l.nome, l.id`,
        [empresa_id, usuario_id ?? null]
    );
    return rows;
}

// Só produtos com saldo > 0 no local. Nunca traz custo.
async function saldosDoLocal({ empresa_id, local_id, busca, limit, offset }) {
    const filtro = busca ? `%${busca.replace(/[\\%_]/g, '\\$&')}%` : null;
    const where = `el.empresa_id = $1 AND el.local_id = $2 AND el.saldo > 0
                   AND ($3::text IS NULL OR p.nome ILIKE $3 OR COALESCE(p.sku, '') ILIKE $3)`;

    const { rows: [{ total }] } = await db.query(
        `SELECT COUNT(*)::int AS total
         FROM estoque_locais el JOIN produtos p ON p.id = el.produto_id AND p.empresa_id = el.empresa_id
         WHERE ${where}`,
        [empresa_id, local_id, filtro]
    );

    const { rows } = await db.query(
        `SELECT p.id AS produto_id, p.nome, p.sku, p.ativo, el.saldo
         FROM estoque_locais el JOIN produtos p ON p.id = el.produto_id AND p.empresa_id = el.empresa_id
         WHERE ${where}
         ORDER BY p.nome, p.id LIMIT $4 OFFSET $5`,
        [empresa_id, local_id, filtro, limit, offset]
    );

    return { items: rows, total: Number(total) };
}

module.exports = { obterLocal, listarVisiveis, saldosDoLocal };

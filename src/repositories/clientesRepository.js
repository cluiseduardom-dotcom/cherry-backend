const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

async function listar(empresa_id) {
    const { rows } = await db.query('SELECT * FROM clientes WHERE empresa_id = $1', [empresa_id]);
    return rows;
}

async function criar({ nome, telefone, email, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO clientes (nome, telefone, email, empresa_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nome, telefone, email, empresa_id`,
        [nome, telefone, email, empresa_id]
    );

    return rows[0];
}

async function getHistorico(id, empresa_id) {
    const { rows } = await db.query(`
        SELECT
          v.id AS venda_id,
          v.data,
          p.nome AS produto,
          iv.quantidade,
          iv.preco_unitario,
          (iv.quantidade * iv.preco_unitario) AS total_item
        FROM vendas v
        JOIN itens_venda iv ON iv.venda_id = v.id
        JOIN produtos p ON p.id = iv.produto_id
        WHERE v.cliente_id = $1 AND v.empresa_id = $2
        ORDER BY v.data DESC
    `, [id, empresa_id]);

    return rows;
}

async function getRanking(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id AND v.empresa_id = c.empresa_id
        WHERE c.empresa_id = $1
        GROUP BY c.id, c.nome
        ORDER BY total_gasto DESC
    `, [empresa_id]);

    return rows;
}

async function getTotalGasto(id, empresa_id) {
    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id AND v.empresa_id = c.empresa_id
        WHERE c.id = $1 AND c.empresa_id = $2
        GROUP BY c.id, c.nome
    `, [id, empresa_id]);

    return rows.length ? rows[0] : null;
}

// Caso irregular (checa `anonimizado`, não `status`): usa executarComLock
// direto em vez de transicionarStatus, mesmo critério documentado em
// shared/transacoes.js.
async function anonimizar(id, empresa_id) {
    return executarComLock('clientes', { coluna: 'id', valor: id }, empresa_id, undefined, async (cliente, client) => {
        if (!cliente) {
            throw new AppError('Cliente não encontrado', 404);
        }

        if (cliente.anonimizado) {
            throw new AppError('Cliente já foi anonimizado', 409);
        }

        const { rows } = await client.query(
            `UPDATE clientes SET
                nome = 'Cliente removido',
                telefone = NULL,
                email = NULL,
                ativo = false,
                anonimizado = true,
                anonimizado_em = NOW()
             WHERE id = $1
             RETURNING *`,
            [id]
        );

        return rows[0];
    });
}

module.exports = {
    listar,
    criar,
    getHistorico,
    getRanking,
    getTotalGasto,
    anonimizar
};

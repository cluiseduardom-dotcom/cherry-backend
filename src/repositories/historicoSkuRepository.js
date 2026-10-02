const db = require('../config/db');

async function registrar({ empresa_id, produto_id, sku, configuracao_id, usuario_id, acao, sku_anterior = null, motivo = null }, client = db) {
    const { rows } = await client.query(
        `INSERT INTO historico_sku
         (empresa_id, produto_id, sku, configuracao_id, usuario_id, acao, sku_anterior, motivo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [empresa_id, produto_id, sku, configuracao_id, usuario_id, acao, sku_anterior, motivo]
    );

    return rows[0];
}

module.exports = { registrar };

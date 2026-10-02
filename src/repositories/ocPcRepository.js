const db = require('../config/db');

async function buscarOcItem(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM ordens_compra_itens WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function buscarPcItem(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM pedidos_compra_itens WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function quantidadeVinculadaOcItem(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT COALESCE(SUM(quantidade_vinculada), 0) AS quantidade
         FROM oc_pc_itens
         WHERE ordem_compra_item_id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
    return Number(rows[0]?.quantidade || 0);
}

async function quantidadeVinculadaPcItem(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT COALESCE(SUM(quantidade_vinculada), 0) AS quantidade
         FROM oc_pc_itens
         WHERE pedido_compra_item_id = $1 AND empresa_id = $2`,
        [id, empresa_id]
    );
    return Number(rows[0]?.quantidade || 0);
}

async function criarVinculo(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO oc_pc_itens
            (empresa_id, ordem_compra_item_id, pedido_compra_item_id, quantidade_vinculada)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [
            dados.empresa_id,
            dados.ordem_compra_item_id,
            dados.pedido_compra_item_id,
            dados.quantidade_vinculada
        ]
    );
    return rows[0];
}

async function listarPorOc(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM oc_pc_itens
         WHERE ordem_compra_item_id = $1 AND empresa_id = $2
         ORDER BY id`,
        [id, empresa_id]
    );
    return rows;
}

async function listarPorPc(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT * FROM oc_pc_itens
         WHERE pedido_compra_item_id = $1 AND empresa_id = $2
         ORDER BY id`,
        [id, empresa_id]
    );
    return rows;
}

module.exports = {
    buscarOcItem,
    buscarPcItem,
    quantidadeVinculadaOcItem,
    quantidadeVinculadaPcItem,
    criarVinculo,
    listarPorOc,
    listarPorPc
};

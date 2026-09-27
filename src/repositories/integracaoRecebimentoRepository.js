const db = require('../config/db');

async function buscarPorIdForUpdate(id, empresaId, client) {
    const { rows } = await client.query(
        'SELECT * FROM recebimentos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
        [id, empresaId]
    );
    return rows[0] || null;
}

async function listarItens(id, empresaId, client) {
    const { rows } = await client.query(
        `SELECT ri.*
         FROM recebimentos_itens ri
         WHERE ri.recebimento_id = $1 AND ri.empresa_id = $2
         ORDER BY ri.id
         FOR UPDATE`,
        [id, empresaId]
    );
    return rows;
}

async function atualizarStatusComCliente(id, empresaId, status, client) {
    const { rows } = await client.query(
        `UPDATE recebimentos
         SET status = $3, updated_at = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING *`,
        [id, empresaId, status]
    );
    return rows[0] || null;
}

async function atualizarQuantidadeRecebidaPedidoItem(pedidoItemId, empresaId, client) {
    const { rows } = await client.query(
        `UPDATE pedidos_compra_itens pci
         SET quantidade_recebida = LEAST(
             pci.quantidade,
             COALESCE((
                 SELECT SUM(ri.quantidade_recebida)
                 FROM recebimentos_itens ri
                 JOIN recebimentos r ON r.id = ri.recebimento_id
                 WHERE ri.pedido_compra_item_id = pci.id
                   AND ri.empresa_id = pci.empresa_id
                   AND r.status = 'APROVADO'
             ), 0)
         ),
         updated_at = NOW()
         WHERE pci.id = $1 AND pci.empresa_id = $2
         RETURNING *`,
        [pedidoItemId, empresaId]
    );
    return rows[0] || null;
}

async function atualizarStatusPedido(pedidoId, empresaId, client) {
    const { rows } = await client.query(
        `UPDATE pedidos_compra pc
         SET status = CASE
             WHEN NOT EXISTS (
                 SELECT 1 FROM pedidos_compra_itens pci
                 WHERE pci.pedido_compra_id = pc.id
                   AND pci.empresa_id = pc.empresa_id
             ) THEN pc.status
             WHEN NOT EXISTS (
                 SELECT 1 FROM pedidos_compra_itens pci
                 WHERE pci.pedido_compra_id = pc.id
                   AND pci.empresa_id = pc.empresa_id
                   AND pci.quantidade_recebida < pci.quantidade
             ) THEN 'RECEBIDO'
             WHEN EXISTS (
                 SELECT 1 FROM pedidos_compra_itens pci
                 WHERE pci.pedido_compra_id = pc.id
                   AND pci.empresa_id = pc.empresa_id
                   AND pci.quantidade_recebida > 0
             ) THEN 'PARCIALMENTE_RECEBIDO'
             ELSE pc.status
         END,
         updated_at = NOW()
         WHERE pc.id = $1 AND pc.empresa_id = $2
           AND pc.status <> 'CANCELADO'
         RETURNING *`,
        [pedidoId, empresaId]
    );
    return rows[0] || null;
}

async function atualizarOrdensRelacionadas(pedidoItemId, empresaId, client) {
    const { rows } = await client.query(
        `WITH dados AS (
            SELECT
                vinculo.ordem_compra_item_id,
                vinculo.quantidade_vinculada,
                pci.quantidade,
                pci.quantidade_recebida,
                COALESCE((
                    SELECT SUM(v2.quantidade_vinculada)
                    FROM oc_pc_itens v2
                    WHERE v2.pedido_compra_item_id = pci.id
                      AND v2.empresa_id = pci.empresa_id
                ), 0) AS total_vinculado
            FROM oc_pc_itens vinculo
            JOIN pedidos_compra_itens pci
              ON pci.id = vinculo.pedido_compra_item_id
             AND pci.empresa_id = vinculo.empresa_id
            WHERE vinculo.pedido_compra_item_id = $1
              AND vinculo.empresa_id = $2
        )
        UPDATE ordens_compra_itens oci
        SET quantidade_atendida = LEAST(
            oci.quantidade_solicitada,
            COALESCE((
                SELECT SUM(
                    LEAST(
                        d.quantidade_vinculada,
                        d.quantidade_recebida
                        * d.quantidade_vinculada
                        / NULLIF(d.total_vinculado, 0)
                    )
                )
                FROM dados d
                WHERE d.ordem_compra_item_id = oci.id
            ), 0)
        ),
        updated_at = NOW()
        WHERE oci.id IN (SELECT ordem_compra_item_id FROM dados)
          AND oci.empresa_id = $2
        RETURNING oci.*`,
        [pedidoItemId, empresaId]
    );
    return rows;
}

async function atualizarStatusOrdensRelacionadas(pedidoItemId, empresaId, client) {
    const { rows } = await client.query(
        `UPDATE ordens_compra oc
         SET status = CASE
             WHEN NOT EXISTS (
                 SELECT 1 FROM ordens_compra_itens oci
                 WHERE oci.ordem_compra_id = oc.id
                   AND oci.empresa_id = oc.empresa_id
             ) THEN oc.status
             WHEN NOT EXISTS (
                 SELECT 1 FROM ordens_compra_itens oci
                 WHERE oci.ordem_compra_id = oc.id
                   AND oci.empresa_id = oc.empresa_id
                   AND oci.quantidade_atendida < oci.quantidade_solicitada
             ) THEN 'ATENDIDA'
             WHEN EXISTS (
                 SELECT 1 FROM ordens_compra_itens oci
                 WHERE oci.ordem_compra_id = oc.id
                   AND oci.empresa_id = oc.empresa_id
                   AND oci.quantidade_atendida > 0
             ) THEN 'PARCIALMENTE_ATENDIDA'
             ELSE oc.status
         END,
         updated_at = NOW()
         WHERE oc.id IN (
             SELECT DISTINCT oci.ordem_compra_id
             FROM oc_pc_itens vinculo
             JOIN ordens_compra_itens oci
               ON oci.id = vinculo.ordem_compra_item_id
              AND oci.empresa_id = vinculo.empresa_id
             WHERE vinculo.pedido_compra_item_id = $1
               AND vinculo.empresa_id = $2
         )
         AND oc.empresa_id = $2
         AND oc.status NOT IN ('CANCELADA','REJEITADA')
         RETURNING oc.*`,
        [pedidoItemId, empresaId]
    );
    return rows;
}

module.exports = {
    buscarPorIdForUpdate,
    listarItens,
    atualizarStatusComCliente,
    atualizarQuantidadeRecebidaPedidoItem,
    atualizarStatusPedido,
    atualizarOrdensRelacionadas,
    atualizarStatusOrdensRelacionadas
};

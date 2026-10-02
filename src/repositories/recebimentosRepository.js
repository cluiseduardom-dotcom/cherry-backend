const db = require('../config/db');

async function criar(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO recebimentos
            (empresa_id, filial_id, numero, pedido_compra_id, fornecedor_id,
             data_recebimento, usuario_id, numero_nf, serie_nf, chave_nf, observacoes)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9,$10,$11)
         RETURNING *`,
        [
            dados.empresa_id, dados.filial_id ?? null, dados.numero,
            dados.pedido_compra_id, dados.fornecedor_id,
            dados.data_recebimento ?? null, dados.usuario_id ?? null,
            dados.numero_nf ?? null, dados.serie_nf ?? null,
            dados.chave_nf ?? null, dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function adicionarItem(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO recebimentos_itens
            (empresa_id, recebimento_id, pedido_compra_item_id, produto_id,
             descricao_snapshot, quantidade_pedida, quantidade_recebida,
             unidade, preco_unitario, lote, validade, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
            dados.empresa_id, dados.recebimento_id, dados.pedido_compra_item_id,
            dados.produto_id ?? null, dados.descricao_snapshot,
            dados.quantidade_pedida, dados.quantidade_recebida,
            dados.unidade ?? 'UN', dados.preco_unitario ?? 0,
            dados.lote ?? null, dados.validade ?? null,
            dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function buscarPorId(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM recebimentos WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function buscarPedidoItem(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM pedidos_compra_itens WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function quantidadeJaRecebida(itemId, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT COALESCE(SUM(ri.quantidade_recebida),0) AS quantidade
         FROM recebimentos_itens ri
         JOIN recebimentos r ON r.id = ri.recebimento_id
         WHERE ri.pedido_compra_item_id = $1
           AND ri.empresa_id = $2
           AND r.status <> 'CANCELADO'`,
        [itemId, empresa_id]
    );
    return Number(rows[0]?.quantidade || 0);
}

async function listarItens(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM recebimentos_itens WHERE recebimento_id = $1 AND empresa_id = $2 ORDER BY id',
        [id, empresa_id]
    );
    return rows;
}

async function atualizarStatus(id, empresa_id, status, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE recebimentos
         SET status = $3, updated_at = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING *`,
        [id, empresa_id, status]
    );
    return rows[0] || null;
}

async function listar({ empresa_id, status, pedido_compra_id, limit = 50, offset = 0 }) {
    const filtros=['empresa_id = $1'];
    const valores=[empresa_id];

    if(status){ valores.push(status); filtros.push(`status = $${valores.length}`); }
    if(pedido_compra_id){ valores.push(pedido_compra_id); filtros.push(`pedido_compra_id = $${valores.length}`); }

    valores.push(limit, offset);
    const {rows}=await db.query(
        `SELECT * FROM recebimentos
         WHERE ${filtros.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT $${valores.length-1} OFFSET $${valores.length}`,
        valores
    );
    return rows;
}

module.exports={criar,adicionarItem,buscarPorId,buscarPedidoItem,quantidadeJaRecebida,listarItens,atualizarStatus,listar};

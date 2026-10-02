const db = require('../config/db');

async function criar(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO pedidos_compra
            (empresa_id, filial_id, numero, fornecedor_id, cotacao_id,
             comprador_id, solicitante_id, data_emissao, data_prevista_entrega,
             condicao_pagamento, prazo_pagamento_dias, forma_pagamento,
             frete_tipo, frete_valor, desconto, outras_despesas, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
            dados.empresa_id, dados.filial_id ?? null, dados.numero,
            dados.fornecedor_id, dados.cotacao_id ?? null,
            dados.comprador_id ?? null, dados.solicitante_id ?? null,
            dados.data_emissao ?? null, dados.data_prevista_entrega ?? null,
            dados.condicao_pagamento ?? null, dados.prazo_pagamento_dias ?? null,
            dados.forma_pagamento ?? null, dados.frete_tipo ?? null,
            dados.frete_valor ?? 0, dados.desconto ?? 0,
            dados.outras_despesas ?? 0, dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function adicionarItem(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO pedidos_compra_itens
            (empresa_id, pedido_compra_id, produto_id, descricao_snapshot,
             quantidade, unidade, preco_unitario, desconto,
             prazo_entrega_dias, data_prevista_entrega, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
            dados.empresa_id, dados.pedido_compra_id, dados.produto_id ?? null,
            dados.descricao_snapshot, dados.quantidade,
            dados.unidade ?? 'UN', dados.preco_unitario ?? 0,
            dados.desconto ?? 0, dados.prazo_entrega_dias ?? null,
            dados.data_prevista_entrega ?? null, dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function recalcularTotal(pedidoId, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE pedidos_compra pc
         SET total = GREATEST(
             0,
             COALESCE((
                 SELECT SUM((pci.quantidade * pci.preco_unitario) - pci.desconto)
                 FROM pedidos_compra_itens pci
                 WHERE pci.pedido_compra_id = pc.id
                   AND pci.empresa_id = pc.empresa_id
             ), 0)
             - pc.desconto
             + pc.frete_valor
             + pc.outras_despesas
         ),
         updated_at = NOW()
         WHERE pc.id = $1 AND pc.empresa_id = $2
         RETURNING *`,
        [pedidoId, empresa_id]
    );
    return rows[0] || null;
}

async function buscarPorId(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM pedidos_compra WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function listarItens(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM pedidos_compra_itens WHERE pedido_compra_id = $1 AND empresa_id = $2 ORDER BY id',
        [id, empresa_id]
    );
    return rows;
}

async function atualizarStatus(id, empresa_id, status, dados = {}, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE pedidos_compra
         SET status = $3,
             enviado_em = COALESCE($4, enviado_em),
             confirmado_em = COALESCE($5, confirmado_em),
             updated_at = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING *`,
        [
            id, empresa_id, status,
            dados.enviado_em ?? null,
            dados.confirmado_em ?? null
        ]
    );
    return rows[0] || null;
}

async function listar({ empresa_id, status, fornecedor_id, limit = 50, offset = 0 }) {
    const filtros = ['empresa_id = $1'];
    const valores = [empresa_id];

    if (status) {
        valores.push(status);
        filtros.push(`status = $${valores.length}`);
    }
    if (fornecedor_id) {
        valores.push(fornecedor_id);
        filtros.push(`fornecedor_id = $${valores.length}`);
    }

    valores.push(limit, offset);
    const { rows } = await db.query(
        `SELECT * FROM pedidos_compra
         WHERE ${filtros.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
    );
    return rows;
}

module.exports = {
    criar,
    adicionarItem,
    recalcularTotal,
    buscarPorId,
    listarItens,
    atualizarStatus,
    listar
};

const db = require('../config/db');

async function criar(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO cotacoes
            (empresa_id, filial_id, numero, solicitante_id, comprador_id,
             data_abertura, data_limite, status, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'RASCUNHO',$8)
         RETURNING *`,
        [
            dados.empresa_id, dados.filial_id ?? null, dados.numero,
            dados.solicitante_id ?? null, dados.comprador_id ?? null,
            dados.data_abertura ?? null, dados.data_limite ?? null,
            dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function adicionarItem(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO cotacoes_itens
            (empresa_id, cotacao_id, ordem_compra_item_id, produto_id,
             descricao_snapshot, quantidade_solicitada, unidade, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
            dados.empresa_id, dados.cotacao_id, dados.ordem_compra_item_id ?? null,
            dados.produto_id ?? null, dados.descricao_snapshot,
            dados.quantidade_solicitada, dados.unidade ?? 'UN',
            dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function adicionarFornecedor(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO cotacoes_fornecedores
            (empresa_id, cotacao_id, fornecedor_id, contato_nome,
             contato_email, contato_telefone, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
            dados.empresa_id, dados.cotacao_id, dados.fornecedor_id,
            dados.contato_nome ?? null, dados.contato_email ?? null,
            dados.contato_telefone ?? null, dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function adicionarOferta(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO cotacoes_fornecedores_itens
            (empresa_id, cotacao_fornecedor_id, cotacao_item_id,
             quantidade_ofertada, preco_unitario, desconto, frete,
             prazo_entrega_dias, condicao_pagamento, validade_proposta, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
            dados.empresa_id, dados.cotacao_fornecedor_id, dados.cotacao_item_id,
            dados.quantidade_ofertada, dados.preco_unitario,
            dados.desconto ?? 0, dados.frete ?? 0,
            dados.prazo_entrega_dias ?? null, dados.condicao_pagamento ?? null,
            dados.validade_proposta ?? null, dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function buscarPorId(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM cotacoes WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function buscarFornecedor(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM cotacoes_fornecedores WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function buscarItem(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM cotacoes_itens WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function listarItens(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM cotacoes_itens WHERE cotacao_id = $1 AND empresa_id = $2 ORDER BY id',
        [id, empresa_id]
    );
    return rows;
}

async function listarFornecedores(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM cotacoes_fornecedores WHERE cotacao_id = $1 AND empresa_id = $2 ORDER BY id',
        [id, empresa_id]
    );
    return rows;
}

async function listarOfertas(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `SELECT cfi.*
         FROM cotacoes_fornecedores_itens cfi
         JOIN cotacoes_fornecedores cf ON cf.id = cfi.cotacao_fornecedor_id
         WHERE cfi.empresa_id = $1 AND cf.cotacao_id = $2
         ORDER BY cfi.cotacao_item_id, cfi.id`,
        [empresa_id, id]
    );
    return rows;
}

async function atualizarStatus(id, empresa_id, status, dados = {}, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `UPDATE cotacoes
         SET status = $3,
             data_abertura = COALESCE($4, data_abertura),
             updated_at = NOW()
         WHERE id = $1 AND empresa_id = $2
         RETURNING *`,
        [id, empresa_id, status, dados.data_abertura ?? null]
    );
    return rows[0] || null;
}

async function listar({ empresa_id, status, limit = 50, offset = 0 }) {
    const filtros = ['empresa_id = $1'];
    const valores = [empresa_id];

    if (status) {
        valores.push(status);
        filtros.push(`status = $${valores.length}`);
    }

    valores.push(limit, offset);
    const { rows } = await db.query(
        `SELECT * FROM cotacoes
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
    adicionarFornecedor,
    adicionarOferta,
    buscarPorId,
    buscarFornecedor,
    buscarItem,
    listarItens,
    listarFornecedores,
    listarOfertas,
    atualizarStatus,
    listar
};

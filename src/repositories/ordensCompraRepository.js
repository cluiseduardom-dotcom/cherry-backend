const db = require('../config/db');

async function criar(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO ordens_compra
            (empresa_id, filial_id, numero, setor_id, solicitante_id, centro_custo_id,
             projeto_id, origem, prioridade, data_solicitacao, data_necessidade,
             status, justificativa, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RASCUNHO',$12,$13)
         RETURNING *`,
        [
            dados.empresa_id, dados.filial_id ?? null, dados.numero,
            dados.setor_id ?? null, dados.solicitante_id ?? null,
            dados.centro_custo_id ?? null, dados.projeto_id ?? null,
            dados.origem ?? 'PLANEJADA', dados.prioridade ?? 'NORMAL',
            dados.data_solicitacao ?? null, dados.data_necessidade ?? null,
            dados.justificativa ?? null, dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function adicionarItem(dados, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        `INSERT INTO ordens_compra_itens
            (empresa_id, ordem_compra_id, produto_id, descricao_snapshot,
             quantidade_solicitada, unidade, data_necessidade, especificacao, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
            dados.empresa_id, dados.ordem_compra_id, dados.produto_id ?? null,
            dados.descricao_snapshot, dados.quantidade_solicitada,
            dados.unidade ?? 'UN', dados.data_necessidade ?? null,
            dados.especificacao ?? null, dados.observacoes ?? null
        ]
    );
    return rows[0];
}

async function buscarPorId(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM ordens_compra WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] || null;
}

async function listarItens(id, empresa_id, clienteExterno) {
    const client = clienteExterno || db;
    const { rows } = await client.query(
        'SELECT * FROM ordens_compra_itens WHERE ordem_compra_id = $1 AND empresa_id = $2 ORDER BY id',
        [id, empresa_id]
    );
    return rows;
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
        `SELECT * FROM ordens_compra
         WHERE ${filtros.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
    );
    return rows;
}

module.exports = { criar, adicionarItem, buscarPorId, listarItens, listar };

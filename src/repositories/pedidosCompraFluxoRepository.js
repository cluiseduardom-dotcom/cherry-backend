const db = require('../config/db');
const AppError = require('../errors/AppError');
const base = require('./pedidosCompraRepository');
const { executarComLock } = require('./shared/transacoes');

// Pedido de compra (compras avançado): criar/editar com itens de forma atômica, numeração sequencial por empresa,
// listagem e detalhe. As transições de status e o recebimento reaproveitam o que já existia.

async function travarNumeracao(client, empresa_id) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`pedido-compra-numero:${empresa_id}`]);
}

// Próximo número PC-AAAA-NNNN do ano, dentro da trava da empresa (duas criações simultâneas não repetem número).
async function proximoNumero(client, empresa_id, ano) {
    const prefixo = `PC-${ano}-`;
    const { rows } = await client.query(
        `SELECT COALESCE(MAX(SUBSTRING(numero FROM '^PC-[0-9]{4}-([0-9]+)$')::int), 0) + 1 AS proximo
         FROM pedidos_compra
         WHERE empresa_id = $1 AND numero LIKE $2`,
        [empresa_id, `${prefixo}%`]
    );

    return `${prefixo}${String(rows[0].proximo).padStart(4, '0')}`;
}

async function inserirItens(client, empresa_id, pedido_id, itens) {
    for (const item of itens) {
        await base.adicionarItem({ ...item, empresa_id, pedido_compra_id: pedido_id }, client);
    }
    return base.recalcularTotal(pedido_id, empresa_id, client);
}

// Cria o pedido e os itens DENTRO da transação de quem chama (número sequencial sob trava da empresa). Usado também pela cotação,
// que gera vários pedidos de uma vez.
async function criarNoClient(client, cabecalho, itens, { empresa_id, usuario_id, ano, hoje }) {
    await travarNumeracao(client, empresa_id);

    const numero = cabecalho.numero || await proximoNumero(client, empresa_id, ano);
    const pedido = await base.criar({
        ...cabecalho, numero, empresa_id, comprador_id: usuario_id, solicitante_id: usuario_id, data_emissao: hoje
    }, client);
    const comTotal = await inserirItens(client, empresa_id, pedido.id, itens);

    return comTotal || pedido;
}

async function criarComItens(cabecalho, itens, { empresa_id, usuario_id, ano, hoje }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const pedido = await criarNoClient(client, cabecalho, itens, { empresa_id, usuario_id, ano, hoje });

        await client.query('COMMIT');

        return pedido.id;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new AppError('Já existe um pedido de compra com esse número', 409);
        throw error;
    } finally {
        client.release();
    }
}

// Troca cabeçalho e itens do rascunho. O número não muda.
async function substituirRascunho(id, empresa_id, cabecalho, itens) {
    return executarComLock('pedidos_compra', { coluna: 'id', valor: id }, empresa_id, null, async (pedido, client) => {
        if (!pedido) throw new AppError('Pedido de compra não encontrado', 404);
        if (pedido.status !== 'RASCUNHO') throw new AppError('Só é possível editar pedido em rascunho', 409);

        await client.query(
            `UPDATE pedidos_compra
             SET fornecedor_id = $3, data_prevista_entrega = $4, condicao_pagamento = $5, prazo_pagamento_dias = $6,
                 forma_pagamento = $7, frete_valor = $8, desconto = $9, outras_despesas = $10, observacoes = $11, updated_at = NOW()
             WHERE id = $1 AND empresa_id = $2`,
            [
                id, empresa_id, cabecalho.fornecedor_id, cabecalho.data_prevista_entrega ?? null, cabecalho.condicao_pagamento ?? null,
                cabecalho.prazo_pagamento_dias ?? null, cabecalho.forma_pagamento ?? null, cabecalho.frete_valor ?? 0,
                cabecalho.desconto ?? 0, cabecalho.outras_despesas ?? 0, cabecalho.observacoes ?? null
            ]
        );
        await client.query('DELETE FROM pedidos_compra_itens WHERE pedido_compra_id = $1 AND empresa_id = $2', [id, empresa_id]);
        await inserirItens(client, empresa_id, id, itens);

        return id;
    });
}

// Muda o status sob lock; `decidir(pedido)` lança se a transição não vale e devolve os campos extras.
async function mudarStatus(id, empresa_id, decidir) {
    return executarComLock('pedidos_compra', { coluna: 'id', valor: id }, empresa_id, null, async (pedido, client) => {
        if (!pedido) throw new AppError('Pedido de compra não encontrado', 404);

        const { status, dados } = decidir(pedido);

        await base.atualizarStatus(id, empresa_id, status, dados, client);

        return id;
    });
}

async function listarPaginado({ empresa_id, status, fornecedor_id, page, pageSize }) {
    const valores = [empresa_id];
    const filtros = ['pc.empresa_id = $1'];

    if (status) {
        valores.push(status);
        filtros.push(`pc.status = $${valores.length}`);
    }
    if (fornecedor_id) {
        valores.push(fornecedor_id);
        filtros.push(`pc.fornecedor_id = $${valores.length}`);
    }

    const where = filtros.join(' AND ');
    const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total FROM pedidos_compra pc WHERE ${where}`, valores);

    valores.push(pageSize, (page - 1) * pageSize);
    const { rows } = await db.query(
        `SELECT pc.id, pc.numero, pc.status, pc.total, pc.fornecedor_id, f.nome AS fornecedor_nome,
                pc.data_emissao, pc.data_prevista_entrega, pc.created_at,
                (SELECT COUNT(*)::int FROM pedidos_compra_itens i WHERE i.pedido_compra_id = pc.id AND i.empresa_id = pc.empresa_id) AS itens
         FROM pedidos_compra pc
         JOIN fornecedores f ON f.id = pc.fornecedor_id AND f.empresa_id = pc.empresa_id
         WHERE ${where}
         ORDER BY pc.created_at DESC, pc.id DESC
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
    );

    return { rows, total };
}

async function detalhar(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT pc.*, f.nome AS fornecedor_nome,
                to_char(pc.data_emissao, 'YYYY-MM-DD') AS data_emissao,
                to_char(pc.data_prevista_entrega, 'YYYY-MM-DD') AS data_prevista_entrega
         FROM pedidos_compra pc
         JOIN fornecedores f ON f.id = pc.fornecedor_id AND f.empresa_id = pc.empresa_id
         WHERE pc.id = $1 AND pc.empresa_id = $2`,
        [id, empresa_id]
    );

    if (!rows.length) return null;

    const { rows: itens } = await db.query(
        `SELECT i.*, p.nome AS produto_nome
         FROM pedidos_compra_itens i
         LEFT JOIN produtos p ON p.id = i.produto_id AND p.empresa_id = i.empresa_id
         WHERE i.pedido_compra_id = $1 AND i.empresa_id = $2
         ORDER BY i.id`,
        [id, empresa_id]
    );

    return { pedido: rows[0], itens };
}

async function buscarFornecedor(id, empresa_id) {
    const { rows } = await db.query('SELECT id, ativo FROM fornecedores WHERE id = $1 AND empresa_id = $2', [id, empresa_id]);
    return rows[0] || null;
}

async function buscarProdutos(ids, empresa_id) {
    const { rows } = await db.query(
        'SELECT id, nome, ativo, unidade FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2',
        [ids, empresa_id]
    );
    return rows;
}

module.exports = { criarNoClient, criarComItens, substituirRascunho, mudarStatus, listarPaginado, detalhar, buscarFornecedor, buscarProdutos };

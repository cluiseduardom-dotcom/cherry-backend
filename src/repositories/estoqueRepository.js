const db = require('../config/db');

// Local Central da empresa. Criado sob demanda para empresas novas (a migration 058 já cobre
// as existentes); ON CONFLICT DO NOTHING + SELECT é seguro com criações concorrentes.
async function garantirLocalCentral(client, empresa_id) {
    await client.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`,
        [empresa_id]
    );
    const { rows } = await client.query(
        `SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`,
        [empresa_id]
    );
    return rows[0].id;
}

// Local "Em trânsito" da empresa (mercadoria enviada e ainda não aceita). Mesmo padrão do Central.
async function garantirLocalTransito(client, empresa_id) {
    await client.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'transito', 'Em trânsito') ON CONFLICT DO NOTHING`,
        [empresa_id]
    );
    const { rows } = await client.query(
        `SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'transito'`,
        [empresa_id]
    );
    return rows[0].id;
}

// clienteExterno permite participar de uma transação já aberta por outro módulo
// (ex: criação de venda, que precisa que a baixa de estoque de todos os itens e o
// registro da venda sejam a mesma transação). Quando informado, esta função não
// abre/fecha transação nem libera a conexão — quem chamou é responsável por isso.
//
// Estoque por local: a movimentação vale para UM local (local_id; padrão = Central da empresa).
// entrada/saida somam/subtraem do saldo daquele local; ajuste define o saldo DO LOCAL. O total
// (produtos.estoque_atual) é atualizado pela diferença na mesma transação, então a soma dos
// locais sempre fecha com o total. Saldo de local nunca fica negativo. A trava do produto
// (FOR UPDATE) vem primeiro e serializa todas as movimentações do mesmo produto, o que também
// protege as linhas de saldo por local.
async function criarMovimentacao({ produto_id, tipo, quantidade, motivo, usuario_id, empresa_id, local_id, transferencia_id }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, estoque_atual, custo FROM produtos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            if (gerenciaTransacao) await client.query('ROLLBACK');
            return { erro: 'PRODUTO_NAO_ENCONTRADO' };
        }

        let localId = local_id;
        if (localId === undefined || localId === null) {
            localId = await garantirLocalCentral(client, empresa_id);
        } else {
            const { rows: localRows } = await client.query(
                'SELECT id FROM locais_estoque WHERE id = $1 AND empresa_id = $2 AND ativo = true',
                [localId, empresa_id]
            );
            if (!localRows.length) {
                if (gerenciaTransacao) await client.query('ROLLBACK');
                return { erro: 'LOCAL_NAO_ENCONTRADO' };
            }
        }

        await client.query(
            `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
             VALUES ($1, $2, $3, 0) ON CONFLICT (produto_id, local_id) DO NOTHING`,
            [produto_id, localId, empresa_id]
        );
        const { rows: saldoRows } = await client.query(
            'SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2 AND empresa_id = $3 FOR UPDATE',
            [produto_id, localId, empresa_id]
        );

        const saldoLocal = saldoRows[0].saldo;
        const estoqueAtual = produtoRows[0].estoque_atual;
        let novoSaldoLocal;

        if (tipo === 'entrada') {
            novoSaldoLocal = saldoLocal + quantidade;
        } else if (tipo === 'saida') {
            novoSaldoLocal = saldoLocal - quantidade;
        } else {
            novoSaldoLocal = quantidade;
        }

        if (novoSaldoLocal < 0) {
            if (gerenciaTransacao) await client.query('ROLLBACK');
            return { erro: 'ESTOQUE_INSUFICIENTE' };
        }

        const novoEstoque = estoqueAtual + (novoSaldoLocal - saldoLocal);

        await client.query(
            'UPDATE estoque_locais SET saldo = $1, atualizado_em = NOW() WHERE produto_id = $2 AND local_id = $3',
            [novoSaldoLocal, produto_id, localId]
        );
        await client.query('UPDATE produtos SET estoque_atual = $1 WHERE id = $2', [novoEstoque, produto_id]);

        const { rows } = await client.query(
            `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id, empresa_id, local_id, saldo_local_resultante, transferencia_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [produto_id, tipo, quantidade, novoEstoque, motivo ?? null, usuario_id, empresa_id, localId, novoSaldoLocal, transferencia_id ?? null]
        );

        if (gerenciaTransacao) await client.query('COMMIT');

        return { movimentacao: rows[0], custo: produtoRows[0].custo };

    } catch (error) {
        if (gerenciaTransacao) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (gerenciaTransacao) client.release();
    }
}

// Locais ativos da empresa com o saldo do produto em cada um (0 quando nunca teve) e o total.
// `consistente` confere a invariante soma dos locais = produtos.estoque_atual.
async function saldosPorLocal(produto_id, empresa_id) {
    const { rows: produtoRows } = await db.query(
        'SELECT id, estoque_atual FROM produtos WHERE id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );
    if (!produtoRows.length) return null;

    const { rows } = await db.query(
        `SELECT l.id AS local_id, l.tipo, l.nome, l.usuario_id, l.cliente_id, l.ativo,
                COALESCE(el.saldo, 0) AS saldo
         FROM locais_estoque l
         LEFT JOIN estoque_locais el
                ON el.local_id = l.id AND el.empresa_id = l.empresa_id AND el.produto_id = $1
         WHERE l.empresa_id = $2 AND (l.ativo = true OR el.saldo > 0)
         ORDER BY CASE l.tipo WHEN 'central' THEN 0 WHEN 'maleta' THEN 1 WHEN 'consignado' THEN 2 ELSE 3 END, l.nome, l.id`,
        [produto_id, empresa_id]
    );

    const soma = rows.reduce((acc, r) => acc + r.saldo, 0);
    return {
        produto_id,
        estoque_total: produtoRows[0].estoque_atual,
        consistente: soma === produtoRows[0].estoque_atual,
        locais: rows
    };
}

async function listarLocais(empresa_id) {
    const { rows } = await db.query(
        `SELECT id, tipo, nome, usuario_id, cliente_id, ativo
         FROM locais_estoque
         WHERE empresa_id = $1
         ORDER BY CASE tipo WHEN 'central' THEN 0 WHEN 'maleta' THEN 1 WHEN 'consignado' THEN 2 ELSE 3 END, nome, id`,
        [empresa_id]
    );
    return rows;
}

async function listarPorProduto(produto_id, empresa_id, { limit, offset }) {
    const { rows } = await db.query(
        `SELECT * FROM movimentacoes_estoque
         WHERE produto_id = $1 AND empresa_id = $2
         ORDER BY criado_em DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [produto_id, empresa_id, limit, offset]
    );

    const { rows: countRows } = await db.query(
        'SELECT COUNT(*) FROM movimentacoes_estoque WHERE produto_id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function getEstoqueBaixo(empresa_id) {
    const { rows } = await db.query(`
        SELECT id, sku, nome, categoria, estoque_atual, estoque_minimo
        FROM produtos
        WHERE ativo = true
          AND estoque_atual <= estoque_minimo
          AND empresa_id = $1
        ORDER BY (estoque_atual - estoque_minimo) ASC
    `, [empresa_id]);

    return rows;
}


async function listarMovimentacoesRelatorio({ limit, offset, produto_id, data_de, data_ate, empresa_id }) {
    const condicoes = ['m.empresa_id = $1'];
    const valores = [empresa_id];

    if (produto_id !== undefined) {
        valores.push(produto_id);
        condicoes.push('m.produto_id = $' + valores.length);
    }

    if (data_de !== undefined) {
        valores.push(data_de);
        condicoes.push('m.criado_em::date >= $' + valores.length);
    }

    if (data_ate !== undefined) {
        valores.push(data_ate);
        condicoes.push('m.criado_em::date <= $' + valores.length);
    }

    const where = 'WHERE ' + condicoes.join(' AND ');
    const valoresListagem = [...valores, limit, offset];

    const { rows } = await db.query(
        `SELECT m.*, p.nome AS produto_nome, p.sku AS produto_sku
         FROM movimentacoes_estoque m
         JOIN produtos p ON p.id = m.produto_id AND p.empresa_id = m.empresa_id
         ${where}
         ORDER BY m.criado_em DESC, m.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM movimentacoes_estoque m ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

module.exports = {
    criarMovimentacao,
    garantirLocalCentral,
    garantirLocalTransito,
    saldosPorLocal,
    listarLocais,
    listarPorProduto,
    listarMovimentacoesRelatorio,
    getEstoqueBaixo
};

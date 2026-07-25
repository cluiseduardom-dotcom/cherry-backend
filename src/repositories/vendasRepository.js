const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const precosRepository = require('./precosRepository');
const AppError = require('../errors/AppError');

async function getResumo() {
    const { rows } = await db.query(`
        SELECT
          COUNT(*) AS total_vendas,
          COALESCE(SUM(total), 0) AS faturamento,
          COALESCE(AVG(total), 0) AS ticket_medio
        FROM vendas
    `);
    return rows[0];
}

async function getPorDia() {
    const { rows } = await db.query(`
        SELECT
          DATE(data) AS dia,
          COALESCE(SUM(total), 0) AS faturamento,
          COUNT(*) AS total_vendas
        FROM vendas
        GROUP BY DATE(data)
        ORDER BY dia DESC
    `);
    return rows;
}

async function getPorMes() {
    const { rows } = await db.query(`
        SELECT
          TO_CHAR(data, 'YYYY-MM') AS mes,
          COALESCE(SUM(total), 0) AS faturamento,
          COUNT(*) AS total_vendas
        FROM vendas
        GROUP BY mes
        ORDER BY mes DESC
    `);
    return rows;
}

async function getMaisVendidosPeriodo() {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
        LIMIT 10
    `);
    return rows;
}

// Uma única transação cobre a venda inteira: preço de cada item (vindo do
// preço vigente em precos_produto) e a baixa de estoque correspondente
// (reaproveitando estoqueRepository.criarMovimentacao nesta mesma transação).
// Qualquer falha em qualquer item reverte a venda inteira — nada fica
// parcialmente criado.
async function criar({ cliente_id, canal_id, usuario_id, itens }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const vendaResult = await client.query(
            `INSERT INTO vendas (cliente_id, canal_id, usuario_id, total, status, data)
             VALUES ($1, $2, $3, 0, 'finalizada', NOW())
             RETURNING *`,
            [cliente_id ?? null, canal_id, usuario_id]
        );

        const venda = vendaResult.rows[0];

        let total = 0;
        const itensProcessados = [];

        for (const item of itens) {
            const { rows: produtoRows } = await client.query(
                'SELECT id, ativo FROM produtos WHERE id = $1',
                [item.produto_id]
            );

            if (!produtoRows.length) {
                throw new AppError('Produto não encontrado', 404);
            }

            if (!produtoRows[0].ativo) {
                throw new AppError('Produto inativo não pode ser vendido', 400);
            }

            const precoVigente = await precosRepository.buscarPrecoVigente(item.produto_id, canal_id);

            if (!precoVigente) {
                throw new AppError('Produto sem preço definido para o canal informado', 409);
            }

            const preco_unitario = Number(precoVigente.preco_venda);

            const resultado = await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.produto_id,
                    tipo: 'saida',
                    quantidade: item.quantidade,
                    motivo: `Venda #${venda.id}`,
                    usuario_id
                },
                client
            );

            if (resultado.erro === 'ESTOQUE_INSUFICIENTE') {
                throw new AppError('Estoque insuficiente para essa venda', 409);
            }

            if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') {
                throw new AppError('Produto não encontrado', 404);
            }

            itensProcessados.push({ produto_id: item.produto_id, quantidade: item.quantidade, preco_unitario });
            total += item.quantidade * preco_unitario;
        }

        total = Number(total.toFixed(2));

        await client.query('UPDATE vendas SET total = $1 WHERE id = $2', [total, venda.id]);

        const valores = itensProcessados.map((item) => [venda.id, item.produto_id, item.quantidade, item.preco_unitario]);
        const placeholders = valores
            .map((_, i) => {
                const base = i * 4;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
            })
            .join(', ');

        const { rows: itensRows } = await client.query(
            `INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario)
             VALUES ${placeholders}
             RETURNING *`,
            valores.flat()
        );

        await client.query('COMMIT');

        return { ...venda, total, itens: itensRows };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listarPaginado({ limit, offset, usuario_id }) {
    const condicoes = [];
    const valores = [];

    if (usuario_id !== undefined) {
        valores.push(usuario_id);
        condicoes.push(`v.usuario_id = $${valores.length}`);
    }

    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT v.*, c.nome AS canal
         FROM vendas v
         JOIN canais_venda c ON c.id = v.canal_id
         ${where}
         ORDER BY v.data DESC, v.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM vendas v ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id) {
    const { rows } = await db.query(
        `SELECT v.*, c.nome AS canal
         FROM vendas v
         JOIN canais_venda c ON c.id = v.canal_id
         WHERE v.id = $1`,
        [id]
    );

    if (!rows.length) return null;

    const venda = rows[0];

    const { rows: itensRows } = await db.query(
        'SELECT id, produto_id, quantidade, preco_unitario FROM itens_venda WHERE venda_id = $1 ORDER BY id',
        [id]
    );

    return { ...venda, itens: itensRows };
}

// Estorna o estoque de cada item (entrada auditada, motivo 'cancelamento_venda')
// e marca a venda como cancelada, na mesma transação. Não reaproveita o
// bloqueio de "produto inativo" do módulo de estoque aqui de propósito: uma
// venda precisa poder ser cancelada mesmo que o produto tenha sido desativado
// depois da venda original.
async function cancelar(id, usuario_id) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: vendaRows } = await client.query(
            'SELECT * FROM vendas WHERE id = $1 FOR UPDATE',
            [id]
        );

        if (!vendaRows.length) {
            throw new AppError('Venda não encontrada', 404);
        }

        const venda = vendaRows[0];

        if (venda.status !== 'finalizada') {
            throw new AppError('Somente vendas finalizadas podem ser canceladas', 409);
        }

        const { rows: itensRows } = await client.query(
            'SELECT produto_id, quantidade FROM itens_venda WHERE venda_id = $1',
            [id]
        );

        for (const item of itensRows) {
            await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.produto_id,
                    tipo: 'entrada',
                    quantidade: item.quantidade,
                    motivo: 'cancelamento_venda',
                    usuario_id
                },
                client
            );
        }

        const { rows: atualizadaRows } = await client.query(
            `UPDATE vendas SET status = 'cancelada' WHERE id = $1 RETURNING *`,
            [id]
        );

        await client.query('COMMIT');

        return atualizadaRows[0];

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    getResumo,
    getPorDia,
    getPorMes,
    getMaisVendidosPeriodo,
    criar,
    listarPaginado,
    buscarPorId,
    cancelar
};

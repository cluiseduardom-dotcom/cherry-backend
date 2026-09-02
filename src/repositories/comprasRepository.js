const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const contasPagarRepository = require('./contasPagarRepository');
const AppError = require('../errors/AppError');

// Usa os getters LOCAIS do Date (não toISOString/UTC) de propósito: a mesma
// armadilha de fuso horário documentada em 006_contas_pagar.sql. data_compra
// chega como string 'YYYY-MM-DD' (nunca um Date), então é quebrada em
// ano/mes/dia manualmente antes de somar dias_prazo — new Date(ano, mes, dia
// + diasPrazo) rola mês/ano corretamente.
function calcularDataVencimento(dataCompra, diasPrazo) {
    const [ano, mes, dia] = dataCompra.split('-').map(Number);
    const vencimento = new Date(ano, mes - 1, dia + diasPrazo);

    const anoV = vencimento.getFullYear();
    const mesV = String(vencimento.getMonth() + 1).padStart(2, '0');
    const diaV = String(vencimento.getDate()).padStart(2, '0');

    return `${anoV}-${mesV}-${diaV}`;
}

// Uma única transação cobre a compra inteira: fornecedor_id e cada
// produto_id são validados contra a empresa do usuário autenticado, a
// entrada de estoque de cada item reaproveita estoqueRepository.
// criarMovimentacao (mesma função usada em vendas/cancelamento) e, se
// forma_pagamento = 'prazo', a conta a pagar nasce na mesma transação via
// contasPagarRepository.criar(clienteExterno) — mesmo padrão de
// vendasRepository.criar gerando contas_receber. Qualquer falha em qualquer
// parte reverte a compra inteira.
async function criar({ fornecedor_id, data_compra, nota_fiscal, forma_pagamento, dias_prazo, usuario_id, empresa_id, itens }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: fornecedorRows } = await client.query(
            'SELECT id, nome FROM fornecedores WHERE id = $1 AND empresa_id = $2',
            [fornecedor_id, empresa_id]
        );

        if (!fornecedorRows.length) {
            throw new AppError('Fornecedor não encontrado', 404);
        }

        const fornecedor = fornecedorRows[0];

        const compraResult = await client.query(
            `INSERT INTO compras (empresa_id, fornecedor_id, data_compra, nota_fiscal, forma_pagamento, dias_prazo, status, valor_total)
             VALUES ($1, $2, $3, $4, $5, $6, 'recebido', 0)
             RETURNING *`,
            [empresa_id, fornecedor_id, data_compra, nota_fiscal ?? null, forma_pagamento ?? 'a_vista', dias_prazo ?? null]
        );

        const compra = compraResult.rows[0];

        let valorTotal = 0;
        const itensProcessados = [];

        for (const item of itens) {
            const { rows: produtoRows } = await client.query(
                'SELECT id, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
                [item.produto_id, empresa_id]
            );

            if (!produtoRows.length) {
                throw new AppError('Produto não encontrado', 404);
            }

            if (!produtoRows[0].ativo) {
                throw new AppError('Produto inativo não pode receber movimentações de estoque', 400);
            }

            const resultado = await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.produto_id,
                    tipo: 'entrada',
                    quantidade: item.quantidade,
                    motivo: `Compra #${compra.id}`,
                    usuario_id,
                    empresa_id
                },
                client
            );

            if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') {
                throw new AppError('Produto não encontrado', 404);
            }

            itensProcessados.push({
                produto_id: item.produto_id,
                quantidade: item.quantidade,
                custo_unitario: item.custo_unitario
            });
            valorTotal += item.quantidade * item.custo_unitario;
        }

        valorTotal = Number(valorTotal.toFixed(2));

        await client.query('UPDATE compras SET valor_total = $1 WHERE id = $2', [valorTotal, compra.id]);

        const valores = itensProcessados.map((item) => [compra.id, item.produto_id, item.quantidade, item.custo_unitario, empresa_id]);
        const placeholders = valores
            .map((_, i) => {
                const base = i * 5;
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
            })
            .join(', ');

        const { rows: itensRows } = await client.query(
            `INSERT INTO itens_compra (compra_id, produto_id, quantidade, custo_unitario, empresa_id)
             VALUES ${placeholders}
             RETURNING *`,
            valores.flat()
        );

        let contaPagar = null;

        if (forma_pagamento === 'prazo') {
            contaPagar = await contasPagarRepository.criar(
                {
                    descricao: `Compra #${compra.id}`,
                    fornecedor: fornecedor.nome,
                    valor: valorTotal,
                    data_vencimento: calcularDataVencimento(data_compra, dias_prazo),
                    usuario_id,
                    empresa_id,
                    compra_id: compra.id
                },
                client
            );
        }

        await client.query('COMMIT');

        return { ...compra, valor_total: valorTotal, itens: itensRows, conta_pagar: contaPagar };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listarPaginado({ limit, offset, fornecedor_id, dataDe, dataAte, empresa_id }) {
    const condicoes = ['c.empresa_id = $1'];
    const valores = [empresa_id];

    if (fornecedor_id !== undefined) {
        valores.push(fornecedor_id);
        condicoes.push(`c.fornecedor_id = $${valores.length}`);
    }

    if (dataDe !== undefined) {
        valores.push(dataDe);
        condicoes.push(`c.data_compra >= $${valores.length}`);
    }

    if (dataAte !== undefined) {
        valores.push(dataAte);
        condicoes.push(`c.data_compra <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT c.*, f.nome AS fornecedor_nome
         FROM compras c
         JOIN fornecedores f ON f.id = c.fornecedor_id
         ${where}
         ORDER BY c.data_compra DESC, c.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM compras c ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT c.*, f.nome AS fornecedor_nome
         FROM compras c
         JOIN fornecedores f ON f.id = c.fornecedor_id
         WHERE c.id = $1 AND c.empresa_id = $2`,
        [id, empresa_id]
    );

    if (!rows.length) return null;

    const compra = rows[0];

    const { rows: itensRows } = await db.query(
        'SELECT id, produto_id, quantidade, custo_unitario FROM itens_compra WHERE compra_id = $1 ORDER BY id',
        [id]
    );

    return { ...compra, itens: itensRows };
}

// Estorna o estoque de cada item (saída compensatória, motivo
// 'cancelamento_compra') e cancela a conta a pagar vinculada, na mesma
// transação — mesmo padrão de vendasRepository.cancelar. A checagem de
// contasPagarRepository.cancelarPorCompraId roda antes de tocar em estoque:
// se a conta já foi paga, bloqueia com 409 e nada é alterado. Diferente do
// cancelamento de venda (que sempre pode dar entrada de volta), o estorno
// aqui é uma SAÍDA de estoque — se o produto já foi revendido e não há
// unidades suficientes pra estornar, estoqueRepository.criarMovimentacao
// bloqueia com o mesmo 409 de qualquer saída que zeraria negativo.
async function cancelar(id, usuario_id, empresa_id) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: compraRows } = await client.query(
            'SELECT * FROM compras WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [id, empresa_id]
        );

        if (!compraRows.length) {
            throw new AppError('Compra não encontrada', 404);
        }

        if (compraRows[0].status !== 'recebido') {
            throw new AppError('Somente compras recebidas podem ser canceladas', 409);
        }

        await contasPagarRepository.cancelarPorCompraId(id, empresa_id, client);

        const { rows: itensRows } = await client.query(
            'SELECT produto_id, quantidade FROM itens_compra WHERE compra_id = $1',
            [id]
        );

        for (const item of itensRows) {
            const resultado = await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.produto_id,
                    tipo: 'saida',
                    quantidade: item.quantidade,
                    motivo: 'cancelamento_compra',
                    usuario_id,
                    empresa_id
                },
                client
            );

            if (resultado.erro === 'ESTOQUE_INSUFICIENTE') {
                throw new AppError('Estoque insuficiente para estornar esta compra', 409);
            }
        }

        const { rows: atualizadaRows } = await client.query(
            `UPDATE compras SET status = 'cancelado', atualizado_em = NOW() WHERE id = $1 RETURNING *`,
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
    criar,
    listarPaginado,
    buscarPorId,
    cancelar
};

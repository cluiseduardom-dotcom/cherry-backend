const db = require('../config/db');

// Só vendas 'finalizada' contam como faturamento — mesmo critério já usado
// na curva ABC do dashboard (vendas 'aberta' não são venda de fato, e
// 'cancelada' não é faturamento).
async function somarReceita(empresa_id, dataInicio, dataFim) {
    const { rows } = await db.query(
        `SELECT COALESCE(SUM(total), 0) AS total
         FROM vendas
         WHERE empresa_id = $1 AND status = 'finalizada'
           AND data::date >= $2 AND data::date <= $3`,
        [empresa_id, dataInicio, dataFim]
    );

    return rows[0].total;
}

// Custo variável dos produtos vendidos usa produtos.custo (custo atual do
// cadastro), a mesma fonte já usada em precosRepository.listarMargemPorProdutoECanal
// pro dashboard de margem — não existe custo histórico gravado por item de
// venda, então não há como recalcular o custo vigente no momento de cada
// venda passada.
async function somarCustoVariavelProdutos(empresa_id, dataInicio, dataFim) {
    const { rows } = await db.query(
        `SELECT COALESCE(SUM(iv.quantidade * p.custo), 0) AS total
         FROM itens_venda iv
         JOIN vendas v ON v.id = iv.venda_id
         JOIN produtos p ON p.id = iv.produto_id
         WHERE v.empresa_id = $1 AND v.status = 'finalizada'
           AND v.data::date >= $2 AND v.data::date <= $3`,
        [empresa_id, dataInicio, dataFim]
    );

    return rows[0].total;
}

module.exports = {
    somarReceita,
    somarCustoVariavelProdutos
};

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

// Custo variável dos produtos vendidos usa iv.custo_unitario (custo
// congelado no momento da venda, migration 015) — não produtos.custo atual.
// Ponto de equilíbrio é margem HISTÓRICA ("o que já foi vendido"): usar o
// custo atual do produto reescreveria o resultado de vendas já fechadas
// toda vez que o custo mudasse. Diferente da margem PROSPECTIVA de
// precosRepository.listarMargemPorProdutoECanal (dashboard /margem), que
// simula "se eu vender hoje" e por isso usa produtos.custo de propósito —
// as duas fontes não são intercambiáveis, ver CLAUDE.md.
async function somarCustoVariavelProdutos(empresa_id, dataInicio, dataFim) {
    const { rows } = await db.query(
        `SELECT COALESCE(SUM(iv.quantidade * iv.custo_unitario), 0) AS total
         FROM itens_venda iv
         JOIN vendas v ON v.id = iv.venda_id
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

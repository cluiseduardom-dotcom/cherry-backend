const db = require('../config/db');
const { sqlDiaSP } = require('../utils/dataSaoPaulo');

// Relatórios de gestão: só leitura. Todo filtro leva empresa_id (vindo do JWT). Subconsultas (e não JOIN)
// para itens e comissão nunca multiplicarem as linhas uns dos outros. Dia de negócio = São Paulo.
// Só valores fixos entram no texto do SQL; dado do usuário vai sempre por parâmetro.

const DIA = sqlDiaSP('v.data');

// Uma linha por venda finalizada do período. Parâmetros: $1 empresa, $2 data_de, $3 data_ate.
const BASE_VENDAS = `
    SELECT v.id, v.canal_id, v.cliente_id, v.usuario_id,
           ${DIA} AS dia,
           COALESCE(v.subtotal - v.desconto, v.total - v.juros) AS receita,
           COALESCE(v.desconto, 0) AS desconto,
           COALESCE(v.juros, 0) AS juros,
           COALESCE((SELECT SUM(iv.quantidade * iv.custo_unitario)
                       FROM itens_venda iv
                      WHERE iv.venda_id = v.id AND iv.empresa_id = v.empresa_id), 0) AS custo,
           COALESCE((SELECT SUM(iv.quantidade)
                       FROM itens_venda iv
                      WHERE iv.venda_id = v.id AND iv.empresa_id = v.empresa_id), 0) AS itens,
           COALESCE((SELECT SUM(c.valor)
                       FROM comissoes_venda c
                      WHERE c.venda_id = v.id AND c.empresa_id = v.empresa_id AND c.status <> 'estornada'), 0) AS comissao
      FROM vendas v
     WHERE v.empresa_id = $1 AND v.status = 'finalizada'
       AND ${DIA} >= $2 AND ${DIA} <= $3`;

async function totaisVendas(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `WITH base AS (${BASE_VENDAS})
         SELECT COUNT(*)::int AS vendas,
                COALESCE(SUM(receita), 0) AS receita,
                COALESCE(SUM(custo), 0) AS custo,
                COALESCE(SUM(itens), 0) AS itens,
                COALESCE(SUM(desconto), 0) AS desconto,
                COALESCE(SUM(juros), 0) AS juros
           FROM base`,
        [empresaId, dataDe, dataAte]
    );

    return rows[0];
}

async function canceladasDoPeriodo(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS vendas, COALESCE(SUM(v.total), 0) AS valor
           FROM vendas v
          WHERE v.empresa_id = $1 AND v.status = 'cancelada'
            AND ${DIA} >= $2 AND ${DIA} <= $3`,
        [empresaId, dataDe, dataAte]
    );

    return rows[0];
}

async function vendasPorCanal(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `WITH base AS (${BASE_VENDAS})
         SELECT b.canal_id, c.nome,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(b.receita), 0) AS receita,
                COALESCE(SUM(b.custo), 0) AS custo
           FROM base b
           LEFT JOIN canais_venda c ON c.id = b.canal_id AND c.empresa_id = $1
          GROUP BY b.canal_id, c.nome
          ORDER BY receita DESC, c.nome`,
        [empresaId, dataDe, dataAte]
    );

    return rows;
}

// Valor lançado por forma de pagamento nas vendas finalizadas do período (estornado não conta).
async function vendasPorFormaPagamento(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `SELECT p.forma_pagamento,
                COUNT(DISTINCT p.venda_id)::int AS vendas,
                COALESCE(SUM(p.valor), 0) AS valor
           FROM pagamentos_venda p
           JOIN vendas v ON v.id = p.venda_id AND v.empresa_id = p.empresa_id
          WHERE p.empresa_id = $1 AND v.status = 'finalizada'
            AND ${DIA} >= $2 AND ${DIA} <= $3
            AND p.status <> 'estornado'
          GROUP BY p.forma_pagamento
          ORDER BY valor DESC, p.forma_pagamento`,
        [empresaId, dataDe, dataAte]
    );

    return rows;
}

async function vendasPorDiaSemana(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `WITH base AS (${BASE_VENDAS})
         SELECT EXTRACT(DOW FROM b.dia)::int AS dia_semana,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(b.receita), 0) AS receita
           FROM base b
          GROUP BY 1
          ORDER BY 1`,
        [empresaId, dataDe, dataAte]
    );

    return rows;
}

async function topClientes(empresaId, dataDe, dataAte, limite = 10) {
    const { rows } = await db.query(
        `WITH base AS (${BASE_VENDAS})
         SELECT b.cliente_id,
                CASE WHEN cl.anonimizado THEN 'Cliente anonimizado' ELSE cl.nome END AS nome,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(b.receita), 0) AS receita
           FROM base b
           JOIN clientes cl ON cl.id = b.cliente_id AND cl.empresa_id = $1
          GROUP BY b.cliente_id, cl.nome, cl.anonimizado
          ORDER BY receita DESC, b.cliente_id
          LIMIT $4`,
        [empresaId, dataDe, dataAte, limite]
    );

    return rows;
}

async function desempenhoPorVendedor(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `WITH base AS (${BASE_VENDAS})
         SELECT b.usuario_id, u.nome,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(b.receita), 0) AS receita,
                COALESCE(SUM(b.itens), 0) AS itens,
                COALESCE(SUM(b.custo), 0) AS custo,
                COALESCE(SUM(b.comissao), 0) AS comissao
           FROM base b
           LEFT JOIN usuarios u ON u.id = b.usuario_id AND u.empresa_id = $1
          GROUP BY b.usuario_id, u.nome
          ORDER BY receita DESC, u.nome`,
        [empresaId, dataDe, dataAte]
    );

    return rows;
}

async function canceladasPorVendedor(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `SELECT v.usuario_id, COUNT(*)::int AS vendas
           FROM vendas v
          WHERE v.empresa_id = $1 AND v.status = 'cancelada'
            AND ${DIA} >= $2 AND ${DIA} <= $3
          GROUP BY v.usuario_id`,
        [empresaId, dataDe, dataAte]
    );

    return rows;
}

// Produtos vendidos no período. Receita = quantidade × preço de tabela do item (antes do desconto da venda,
// que não é rateado por item); custo = custo congelado no item.
async function produtosVendidos(empresaId, dataDe, dataAte) {
    const { rows } = await db.query(
        `SELECT iv.produto_id, p.sku, p.nome, p.estoque_atual,
                SUM(iv.quantidade) AS quantidade,
                SUM(iv.quantidade * iv.preco_unitario) AS receita,
                SUM(iv.quantidade * iv.custo_unitario) AS custo,
                to_char(MAX(${DIA}), 'YYYY-MM-DD') AS ultima_venda
           FROM itens_venda iv
           JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = iv.empresa_id
           JOIN produtos p ON p.id = iv.produto_id AND p.empresa_id = iv.empresa_id
          WHERE iv.empresa_id = $1 AND v.status = 'finalizada'
            AND ${DIA} >= $2 AND ${DIA} <= $3
          GROUP BY iv.produto_id, p.sku, p.nome, p.estoque_atual`,
        [empresaId, dataDe, dataAte]
    );

    return rows;
}

// Produtos ativos, com estoque, que não tiveram nenhuma venda no período (capital parado).
async function produtosSemVenda(empresaId, dataDe, dataAte, limite = 50) {
    const filtro = `p.empresa_id = $1 AND p.ativo = TRUE AND p.tipo = 'acabado' AND p.estoque_atual > 0
            AND NOT EXISTS (
                SELECT 1
                  FROM itens_venda iv
                  JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = iv.empresa_id
                 WHERE iv.produto_id = p.id AND iv.empresa_id = p.empresa_id AND v.status = 'finalizada'
                   AND ${DIA} >= $2 AND ${DIA} <= $3)`;

    const [resumo, lista] = await Promise.all([
        db.query(
            `SELECT COUNT(*)::int AS produtos, COALESCE(SUM(p.estoque_atual), 0) AS unidades,
                    COALESCE(SUM(p.estoque_atual * p.custo), 0) AS valor_custo
               FROM produtos p WHERE ${filtro}`,
            [empresaId, dataDe, dataAte]
        ),
        db.query(
            `SELECT p.id AS produto_id, p.sku, p.nome, p.estoque_atual, p.custo
               FROM produtos p WHERE ${filtro}
              ORDER BY p.estoque_atual * p.custo DESC, p.nome
              LIMIT $4`,
            [empresaId, dataDe, dataAte, limite]
        )
    ]);

    return { resumo: resumo.rows[0], itens: lista.rows };
}

async function localExiste(empresaId, localId) {
    const { rows } = await db.query(
        'SELECT id, nome, tipo FROM locais_estoque WHERE id = $1 AND empresa_id = $2',
        [localId, empresaId]
    );

    return rows[0] ?? null;
}

// Posição de estoque. Sem `localId`: saldo total do produto (produtos.estoque_atual). Com `localId`: saldo
// daquele local (estoque_locais). `tipoProduto` é 'acabado' ou 'insumo' (valor fixo vindo do serviço).
async function posicaoEstoque(empresaId, { localId, tipoProduto, somenteComSaldo, limit, offset }) {
    const valores = [empresaId, tipoProduto];
    let origem = 'FROM produtos p';
    let saldo = 'p.estoque_atual';

    if (localId) {
        valores.push(localId);
        origem = `FROM produtos p
                  JOIN estoque_locais el ON el.produto_id = p.id AND el.empresa_id = p.empresa_id AND el.local_id = $${valores.length}`;
        saldo = 'el.saldo';
    }

    const filtroSaldo = somenteComSaldo ? `AND ${saldo} > 0` : '';
    const filtro = `WHERE p.empresa_id = $1 AND p.tipo = $2 ${filtroSaldo}`;

    const [totais, itens] = await Promise.all([
        db.query(
            `SELECT COUNT(*)::int AS produtos,
                    COALESCE(SUM(${saldo}), 0) AS unidades,
                    COALESCE(SUM(${saldo} * p.custo), 0) AS valor_custo,
                    COUNT(*) FILTER (WHERE ${saldo} <= p.estoque_minimo AND p.estoque_minimo > 0)::int AS abaixo_minimo
               ${origem} ${filtro}`,
            valores
        ),
        db.query(
            `SELECT p.id AS produto_id, p.sku, p.nome, p.unidade, p.ativo, p.estoque_minimo, p.custo,
                    ${saldo} AS saldo
               ${origem} ${filtro}
              ORDER BY p.nome, p.id
              LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
            [...valores, limit, offset]
        )
    ]);

    return { totais: totais.rows[0], itens: itens.rows };
}

async function resumoPorLocal(empresaId, tipoProduto) {
    const { rows } = await db.query(
        `SELECT l.id AS local_id, l.nome, l.tipo,
                COUNT(p.id) FILTER (WHERE el.saldo > 0)::int AS produtos,
                COALESCE(SUM(el.saldo), 0) AS unidades,
                COALESCE(SUM(el.saldo * p.custo), 0) AS valor_custo
           FROM locais_estoque l
           LEFT JOIN estoque_locais el ON el.local_id = l.id AND el.empresa_id = l.empresa_id
           LEFT JOIN produtos p ON p.id = el.produto_id AND p.empresa_id = l.empresa_id AND p.tipo = $2
          WHERE l.empresa_id = $1 AND l.ativo = TRUE
          GROUP BY l.id, l.nome, l.tipo
          ORDER BY l.tipo, l.nome`,
        [empresaId, tipoProduto]
    );

    return rows;
}

// Contas a receber em aberto (pendente), com o restante já descontando recebimentos parciais da parcela.
async function contasEmAberto(empresaId) {
    const { rows } = await db.query(
        `SELECT cr.id, v.cliente_id,
                to_char(cr.data_vencimento, 'YYYY-MM-DD') AS vencimento,
                GREATEST(cr.valor - COALESCE(pp.valor_pago, 0), 0) AS restante
           FROM contas_receber cr
           LEFT JOIN parcelas_pagamento pp ON pp.id = cr.parcela_id AND pp.empresa_id = cr.empresa_id
           LEFT JOIN vendas v ON v.id = cr.venda_id AND v.empresa_id = cr.empresa_id
          WHERE cr.empresa_id = $1 AND cr.status = 'pendente'
          ORDER BY cr.data_vencimento, cr.id`,
        [empresaId]
    );

    return rows;
}

async function saldosFiado(empresaId) {
    const { rows } = await db.query(
        `SELECT s.cliente_id, s.saldo
           FROM fiado_saldos s
          WHERE s.empresa_id = $1 AND s.saldo > 0
          ORDER BY s.saldo DESC, s.cliente_id`,
        [empresaId]
    );

    return rows;
}

async function nomesDeClientes(empresaId, ids) {
    if (!ids.length) return new Map();

    const { rows } = await db.query(
        `SELECT id, CASE WHEN anonimizado THEN 'Cliente anonimizado' ELSE nome END AS nome
           FROM clientes
          WHERE empresa_id = $1 AND id = ANY($2::int[])`,
        [empresaId, ids]
    );

    return new Map(rows.map((r) => [r.id, r.nome]));
}

module.exports = {
    totaisVendas,
    canceladasDoPeriodo,
    vendasPorCanal,
    vendasPorFormaPagamento,
    vendasPorDiaSemana,
    topClientes,
    desempenhoPorVendedor,
    canceladasPorVendedor,
    produtosVendidos,
    produtosSemVenda,
    localExiste,
    posicaoEstoque,
    resumoPorLocal,
    contasEmAberto,
    saldosFiado,
    nomesDeClientes
};

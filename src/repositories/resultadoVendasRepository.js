const db = require('../config/db');
const { sqlDiaSP } = require('../utils/dataSaoPaulo');

// Base por venda: receita, custo congelado e comissão. Subconsultas (e não JOIN) para que itens e
// comissão nunca multipliquem as linhas uns dos outros. Todo filtro leva empresa_id.
const SQL_BASE = `
    SELECT v.id,
           ${sqlDiaSP('v.data')} AS dia,
           COALESCE(v.subtotal - v.desconto, v.total - v.juros) AS receita,
           COALESCE((SELECT SUM(iv.quantidade * iv.custo_unitario)
                       FROM itens_venda iv
                      WHERE iv.venda_id = v.id AND iv.empresa_id = v.empresa_id), 0) AS custo,
           COALESCE((SELECT SUM(c.valor)
                       FROM comissoes_venda c
                      WHERE c.venda_id = v.id AND c.empresa_id = v.empresa_id AND c.status <> 'estornada'), 0) AS comissao`;

// Alíquota única da empresa. Leitura pura: não usa obterOuCriar, que grava uma linha ao ler.
async function obterAliquota(empresaId) {
    const { rows } = await db.query(
        'SELECT aliquota_imposto FROM configuracoes_financeiras WHERE empresa_id = $1',
        [empresaId]
    );

    return rows.length ? Number(rows[0].aliquota_imposto) : 0;
}

async function porVendas(empresaId, vendaIds) {
    if (!vendaIds.length) return new Map();

    const { rows } = await db.query(
        `${SQL_BASE}
           FROM vendas v
          WHERE v.empresa_id = $1 AND v.id = ANY($2::int[])`,
        [empresaId, vendaIds]
    );

    return new Map(rows.map((r) => [r.id, r]));
}

// Só valores fixos (nunca dado do usuário) entram no texto do SQL.
const BUCKET_SQL = {
    total: `'total'`,
    mes: `to_char(b.dia, 'YYYY-MM')`,
    dia: `to_char(b.dia, 'YYYY-MM-DD')`
};

// Vendas finalizadas do período (dia de São Paulo), somadas por balde. `usuarioId` restringe às vendas do usuário.
async function somarPeriodo(empresaId, dataDe, dataAte, agrupar = 'total', usuarioId = null) {
    const bucket = BUCKET_SQL[agrupar];

    if (!bucket) throw new Error(`agrupamento inválido: ${agrupar}`);

    const valores = [empresaId, dataDe, dataAte];
    let filtroUsuario = '';

    if (usuarioId !== null) {
        valores.push(usuarioId);
        filtroUsuario = `AND v.usuario_id = $${valores.length}`;
    }

    const { rows } = await db.query(
        `WITH base AS (
             ${SQL_BASE}
               FROM vendas v
              WHERE v.empresa_id = $1 AND v.status = 'finalizada'
                AND ${sqlDiaSP('v.data')} >= $2 AND ${sqlDiaSP('v.data')} <= $3
                ${filtroUsuario}
         )
         SELECT ${bucket} AS balde,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(b.receita), 0) AS receita,
                COALESCE(SUM(b.custo), 0) AS custo,
                COALESCE(SUM(b.comissao), 0) AS comissao
           FROM base b
          GROUP BY 1
          ORDER BY 1`,
        valores
    );

    return rows;
}

module.exports = { obterAliquota, porVendas, somarPeriodo };

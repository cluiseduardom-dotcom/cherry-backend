const db = require('../config/db');

// Limites do mês civil em Brasília, convertidos para o "relógio" da sessão do banco, que é
// como vendas.data (TIMESTAMP sem fuso, gravado com NOW()) está armazenada. Comparação direta
// com a coluna: aproveita índice e não depende do fuso do processo Node.
const INICIO_SQL = `(($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE current_setting('TimeZone')`;
const FIM_SQL = `((($1::date + INTERVAL '1 month'))::timestamp AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE current_setting('TimeZone')`;

const MES_CORRENTE_SQL = `to_char((NOW() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM')`;

async function mesCorrente() {
    const { rows } = await db.query(`SELECT ${MES_CORRENTE_SQL} AS mes`);
    return rows[0].mes;
}

// Taxa da plataforma por empresa no mês. LEITURA entre empresas (operador da plataforma):
// só agregados — nenhum dado de venda, cliente ou produto. Empresas ativas sem venda
// aparecem com zeros. Estornadas (venda cancelada) ficam fora do "a receber".
async function taxasPorEmpresa(mes) {
    const { rows } = await db.query(
        `SELECT e.id AS empresa_id,
                e.nome AS empresa_nome,
                COUNT(t.id) FILTER (WHERE t.status = 'apurada') AS qtd_vendas,
                COALESCE(SUM(t.base_calculo) FILTER (WHERE t.status = 'apurada'), 0) AS total_base,
                COALESCE(SUM(t.valor) FILTER (WHERE t.status = 'apurada'), 0) AS total_taxa,
                COALESCE(SUM(t.cobrada_gateway) FILTER (WHERE t.status = 'apurada'), 0) AS total_cobrado_gateway,
                COUNT(t.id) FILTER (WHERE t.status = 'estornada') AS qtd_estornadas,
                COALESCE(SUM(t.valor) FILTER (WHERE t.status = 'estornada'), 0) AS total_estornado,
                COALESCE(
                    ARRAY_AGG(DISTINCT t.percentual ORDER BY t.percentual) FILTER (WHERE t.status = 'apurada'),
                    '{}'
                ) AS percentuais
         FROM empresas e
         LEFT JOIN (
             SELECT tv.id, tv.empresa_id, tv.status, tv.base_calculo, tv.valor, tv.percentual,
                    -- Comissão que o Mercado Pago já reteve nos Pix desta venda (application_fee): não se cobra de novo.
                    COALESCE((
                        SELECT SUM(cp.taxa_plataforma)
                        FROM cobrancas_pagamento cp
                        WHERE cp.venda_id = tv.venda_id AND cp.empresa_id = tv.empresa_id AND cp.status = 'pago'
                    ), 0) AS cobrada_gateway
             FROM taxas_venda tv
             JOIN vendas v ON v.id = tv.venda_id AND v.empresa_id = tv.empresa_id
             WHERE v.data >= ${INICIO_SQL}
               AND v.data <  ${FIM_SQL}
         ) t ON t.empresa_id = e.id
         WHERE e.status = 'ativa'
         GROUP BY e.id, e.nome
         ORDER BY total_taxa DESC, e.nome ASC`,
        [`${mes}-01`]
    );

    return rows;
}

module.exports = { mesCorrente, taxasPorEmpresa };

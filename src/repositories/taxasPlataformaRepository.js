const db = require('../config/db');
const AppError = require('../errors/AppError');
const { reaisParaCentavos, calcularTaxaPlataformaCentavos, centavosParaReais } = require('../utils/taxaPlataforma');

// "Hoje" é calculado NO BANCO, no fuso do negócio: nada de Date do Node (a
// serialização do pg usa o fuso local do processo) e uma venda às 22h em
// Brasília não cai no "dia seguinte" do UTC.
const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

async function buscarPoliticaVigente(client) {
    const { rows } = await client.query(
        `SELECT id, tipo, percentual
         FROM politicas_taxa_plataforma
         WHERE ativo = true
           AND vigencia_inicio <= ${HOJE_SQL}
           AND (vigencia_fim IS NULL OR vigencia_fim >= ${HOJE_SQL})
         ORDER BY vigencia_inicio DESC, id DESC
         LIMIT 1`
    );

    return rows[0] ?? null;
}

// Gera a taxa da venda DENTRO da transação da venda (client obrigatório).
// Qualquer falha — inclusive ausência de política vigente — lança erro: o
// ROLLBACK de vendasRepository.criar desfaz venda, itens, estoque e pagamentos.
// O erro é 500 (a resposta ao cliente é genérica; o detalhe vai só para o log).
async function apurar({ venda_id, empresa_id, total }, client) {
    if (!client) {
        throw new Error('taxasPlataformaRepository.apurar exige o client da transação da venda');
    }

    const politica = await buscarPoliticaVigente(client);

    if (!politica) {
        throw new AppError(
            `Nenhuma política de taxa da plataforma vigente (venda ${venda_id}, empresa ${empresa_id})`,
            500
        );
    }

    const baseCentavos = reaisParaCentavos(total);
    const valorCentavos = calcularTaxaPlataformaCentavos(baseCentavos, politica.percentual);

    const { rows } = await client.query(
        `INSERT INTO taxas_venda
            (venda_id, empresa_id, politica_id, tipo, percentual, base_calculo, valor)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
            venda_id,
            empresa_id,
            politica.id,
            politica.tipo,
            politica.percentual,
            centavosParaReais(baseCentavos),
            centavosParaReais(valorCentavos)
        ]
    );

    return rows[0];
}

// Cancelamento da venda: marca a taxa como estornada (nunca apaga). Venda
// histórica sem linha, ou já estornada, é no-op e não bloqueia o cancelamento.
async function estornarPorVendaId(venda_id, empresa_id, client) {
    const { rowCount } = await client.query(
        `UPDATE taxas_venda
         SET status = 'estornada', estornado_em = NOW()
         WHERE venda_id = $1 AND empresa_id = $2 AND status = 'apurada'`,
        [venda_id, empresa_id]
    );

    return rowCount;
}

// Leitura administrativa (admin do tenant): filtra SEMPRE por empresa_id.
async function listarPaginado({ limit, offset, empresa_id, data_inicio, data_fim }) {
    const condicoes = ['t.empresa_id = $1'];
    const valores = [empresa_id];

    if (data_inicio !== undefined) {
        valores.push(data_inicio);
        condicoes.push(`v.data::date >= $${valores.length}`);
    }

    if (data_fim !== undefined) {
        valores.push(data_fim);
        condicoes.push(`v.data::date <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;
    const valoresListagem = [...valores, limit, offset];

    const { rows } = await db.query(
        `SELECT t.id, t.venda_id, v.data AS data_venda, t.percentual, t.base_calculo,
                t.valor, t.status, t.criado_em, t.estornado_em
         FROM taxas_venda t
         JOIN vendas v ON v.id = t.venda_id AND v.empresa_id = t.empresa_id
         ${where}
         ORDER BY t.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    // Totais só das taxas apuradas (estornadas pelo cancelamento não contam).
    const { rows: totaisRows } = await db.query(
        `SELECT COUNT(*) AS quantidade,
                COALESCE(SUM(t.base_calculo) FILTER (WHERE t.status = 'apurada'), 0) AS total_base,
                COALESCE(SUM(t.valor) FILTER (WHERE t.status = 'apurada'), 0) AS total_taxa
         FROM taxas_venda t
         JOIN vendas v ON v.id = t.venda_id AND v.empresa_id = t.empresa_id
         ${where}`,
        valores
    );

    return {
        items: rows,
        total: Number(totaisRows[0].quantidade),
        totais: {
            total_base: totaisRows[0].total_base,
            total_taxa: totaisRows[0].total_taxa
        }
    };
}

module.exports = {
    buscarPoliticaVigente,
    apurar,
    estornarPorVendaId,
    listarPaginado
};

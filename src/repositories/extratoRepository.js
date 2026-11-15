const db = require('../config/db');

const TZ = 'America/Sao_Paulo';

async function dataSaldoInicial(empresaId, contaId) {
    const { rows } = await db.query(
        `SELECT to_char(data_saldo_inicial, 'YYYY-MM-DD') AS d FROM contas_bancarias WHERE id = $1 AND empresa_id = $2`,
        [contaId, empresaId]
    );
    return rows[0]?.d ?? null;
}

// Referências já importadas nesta conta (inclusive de movimento cancelado: o cancelamento não "libera" a linha,
// senão reimportar o mesmo arquivo ressuscitaria o que a pessoa cancelou de propósito).
async function referenciasExistentes(empresaId, contaId, referencias) {
    if (referencias.length === 0) return new Set();
    const { rows } = await db.query(
        `SELECT referencia_externa FROM movimentos_bancarios
          WHERE empresa_id = $1 AND conta_bancaria_id = $2 AND origem = 'EXTRATO' AND referencia_externa = ANY($3::text[])`,
        [empresaId, contaId, referencias]
    );
    return new Set(rows.map((r) => r.referencia_externa));
}

// Movimentos ativos que NÃO vieram de extrato (manual, Mercado Pago...) no período: candidatos a "mesma coisa".
async function movimentosParaCasar(empresaId, contaId, dataMin, dataMax) {
    const { rows } = await db.query(
        `SELECT id, tipo, (valor * 100)::bigint AS centavos,
                to_char((data_movimento AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS dia
           FROM movimentos_bancarios
          WHERE empresa_id = $1 AND conta_bancaria_id = $2 AND cancelado_em IS NULL AND origem <> 'EXTRATO'
            AND (data_movimento AT TIME ZONE '${TZ}')::date BETWEEN ($3::date - 1) AND ($4::date + 1)`,
        [empresaId, contaId, dataMin, dataMax]
    );
    return rows.map((r) => ({ id: Number(r.id), tipo: r.tipo, centavos: Number(r.centavos), dia: r.dia }));
}

// Sugestões para um movimento: título em aberto de MESMO valor (centavo exato) com vencimento até 15 dias de distância.
async function sugestoesParaMovimento(empresaId, movimentoId) {
    const { rows: mov } = await db.query(
        `SELECT id, tipo, valor, cancelado_em, (data_movimento AT TIME ZONE '${TZ}')::date AS dia
           FROM movimentos_bancarios WHERE id = $1 AND empresa_id = $2`,
        [movimentoId, empresaId]
    );
    if (!mov[0]) return null;
    if (mov[0].cancelado_em) return { origem: mov[0].tipo, titulos: [] };

    if (mov[0].tipo === 'SAIDA') {
        const { rows } = await db.query(
            `SELECT t.id, t.descricao, t.fornecedor, t.valor,
                    to_char(t.data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
                    (t.data_vencimento - $3::date) AS dias_de_diferenca
               FROM contas_pagar t
              WHERE t.empresa_id = $1 AND t.status = 'pendente' AND t.valor = $2
                AND t.data_vencimento BETWEEN ($3::date - 15) AND ($3::date + 15)
              ORDER BY abs(t.data_vencimento - $3::date), t.id
              LIMIT 5`,
            [empresaId, mov[0].valor, mov[0].dia]
        );

        return {
            origem: 'SAIDA',
            titulos: rows.map((r) => ({
                tipo_titulo: 'conta_pagar', id: Number(r.id), descricao: r.descricao, fornecedor: r.fornecedor ?? null,
                valor: String(r.valor), data_vencimento: r.data_vencimento, dias_de_diferenca: Number(r.dias_de_diferenca)
            }))
        };
    }

    // ENTRADA: o dinheiro pode ser a conta inteira (se nada foi recebido ainda), o que FALTAVA de uma conta já recebida em parte, ou um recebimento parcial
    // (ex.: Pix de R$ 40 numa parcela de R$ 100) feito até 3 dias antes/depois do movimento. `motivo` diz qual casou.
    const { rows } = await db.query(
        `SELECT t.id, t.descricao, t.valor, t.status,
                to_char(t.data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
                (t.data_vencimento - $3::date) AS dias_de_diferenca,
                GREATEST(t.valor - COALESCE(pp.valor_pago, 0), 0) AS valor_restante,
                CASE
                    WHEN t.status = 'pendente' AND t.valor = $2 AND COALESCE(pp.valor_pago, 0) = 0 THEN 'valor_total'
                    WHEN t.status = 'pendente' AND t.parcela_id IS NOT NULL AND t.valor - COALESCE(pp.valor_pago, 0) = $2 THEN 'valor_restante'
                    ELSE 'recebimento_parcial'
                END AS motivo
           FROM contas_receber t
           LEFT JOIN parcelas_pagamento pp ON pp.id = t.parcela_id AND pp.empresa_id = t.empresa_id
          WHERE t.empresa_id = $1 AND t.status <> 'cancelado'
            AND (
                (t.status = 'pendente' AND t.data_vencimento BETWEEN ($3::date - 15) AND ($3::date + 15)
                    AND ((t.valor = $2 AND COALESCE(pp.valor_pago, 0) = 0) OR (t.parcela_id IS NOT NULL AND t.valor - COALESCE(pp.valor_pago, 0) = $2)))
                OR (t.parcela_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM recebimentos_conta rc
                     WHERE rc.parcela_id = t.parcela_id AND rc.empresa_id = t.empresa_id AND rc.valor = $2
                       AND ((rc.data_recebimento AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date BETWEEN ($3::date - 3) AND ($3::date + 3)
                ))
            )
          ORDER BY abs(t.data_vencimento - $3::date), t.id
          LIMIT 5`,
        [empresaId, mov[0].valor, mov[0].dia]
    );

    return {
        origem: 'ENTRADA',
        titulos: rows.map((r) => ({
            tipo_titulo: 'conta_receber', id: Number(r.id), descricao: r.descricao, fornecedor: null,
            valor: String(r.valor), valor_restante: String(r.valor_restante), motivo: r.motivo,
            data_vencimento: r.data_vencimento, dias_de_diferenca: Number(r.dias_de_diferenca)
        }))
    };
}

module.exports = { dataSaldoInicial, referenciasExistentes, movimentosParaCasar, sugestoesParaMovimento };

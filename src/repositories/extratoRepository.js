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

    const tabela = mov[0].tipo === 'SAIDA' ? 'contas_pagar' : 'contas_receber';
    const extra = mov[0].tipo === 'SAIDA' ? 'fornecedor' : 'NULL::text AS fornecedor';
    const { rows } = await db.query(
        `SELECT t.id, t.descricao, ${extra}, t.valor,
                to_char(t.data_vencimento, 'YYYY-MM-DD') AS data_vencimento,
                (t.data_vencimento - $3::date) AS dias_de_diferenca
           FROM ${tabela} t
          WHERE t.empresa_id = $1 AND t.status = 'pendente' AND t.valor = $2
            AND t.data_vencimento BETWEEN ($3::date - 15) AND ($3::date + 15)
          ORDER BY abs(t.data_vencimento - $3::date), t.id
          LIMIT 5`,
        [empresaId, mov[0].valor, mov[0].dia]
    );
    return {
        origem: mov[0].tipo,
        titulos: rows.map((r) => ({
            tipo_titulo: mov[0].tipo === 'SAIDA' ? 'conta_pagar' : 'conta_receber',
            id: Number(r.id), descricao: r.descricao, fornecedor: r.fornecedor ?? null,
            valor: String(r.valor), data_vencimento: r.data_vencimento, dias_de_diferenca: Number(r.dias_de_diferenca)
        }))
    };
}

module.exports = { dataSaldoInicial, referenciasExistentes, movimentosParaCasar, sugestoesParaMovimento };

const db = require('../config/db');

const TZ = 'America/Sao_Paulo';

// Cobranças pagas (ou depois estornadas) que ainda não viraram movimento nesta conta. `desde` (YYYY-MM-DD)
// A data do saldo inicial da conta (lida no próprio SQL, sem passar por Date) limita o período: o que veio antes dela já está dentro do saldo informado.
async function listarCobrancasPendentes(empresaId, contaId, limite) {
    const { rows } = await db.query(
        `SELECT cb.id, cb.codigo, cb.metodo, cb.valor, cb.id_externo, cb.venda_id
           FROM cobrancas_pagamento cb
           JOIN contas_bancarias cs ON cs.id = $2 AND cs.empresa_id = cb.empresa_id
          WHERE cb.empresa_id = $1
            AND cb.provedor = 'mercadopago'
            AND cb.status IN ('pago', 'estornado')
            AND cb.id_externo IS NOT NULL
            AND (cs.data_saldo_inicial IS NULL OR (cb.criado_em AT TIME ZONE '${TZ}')::date >= cs.data_saldo_inicial)
            AND NOT EXISTS (
                SELECT 1 FROM movimentos_bancarios mv
                 WHERE mv.empresa_id = cb.empresa_id AND mv.conta_bancaria_id = $2
                   AND mv.origem = 'API_BANCO' AND mv.referencia_externa = 'mp:pay:' || cb.id_externo)
          ORDER BY cb.id
          LIMIT $3`,
        [empresaId, contaId, limite]
    );
    return rows;
}

async function listarDevolucoesPendentes(empresaId, contaId, limite) {
    const { rows } = await db.query(
        `SELECT d.id, d.cobranca_id, d.valor, d.atualizado_em, cb.id_externo
           FROM cobranca_devolucoes d
           JOIN cobrancas_pagamento cb ON cb.id = d.cobranca_id AND cb.empresa_id = d.empresa_id
           JOIN contas_bancarias cs ON cs.id = $2 AND cs.empresa_id = d.empresa_id
          WHERE d.empresa_id = $1
            AND d.status = 'concluida'
            AND (cs.data_saldo_inicial IS NULL OR (d.atualizado_em AT TIME ZONE '${TZ}')::date >= cs.data_saldo_inicial)
            AND NOT EXISTS (
                SELECT 1 FROM movimentos_bancarios mv
                 WHERE mv.empresa_id = d.empresa_id AND mv.conta_bancaria_id = $2
                   AND mv.origem = 'API_BANCO' AND mv.referencia_externa = 'mp:ref:' || d.id)
          ORDER BY d.id
          LIMIT $3`,
        [empresaId, contaId, limite]
    );
    return rows;
}

async function registrarSincronizacao(contaId, empresaId) {
    await db.query(
        `UPDATE contas_bancarias
            SET provedor = COALESCE(provedor, 'mercadopago'), ultima_sincronizacao_em = NOW(), updated_at = NOW()
          WHERE id = $1 AND empresa_id = $2`,
        [contaId, empresaId]
    );
}

module.exports = { listarCobrancasPendentes, listarDevolucoesPendentes, registrarSincronizacao };

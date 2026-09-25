const pool = require('../config/database');

async function criar(dados) {
  const {
    empresa_id, transacao_pagamento_id, transacao_pagamento_parcela_id = null,
    tipo, valor_bruto, taxa = 0, valor_liquido,
    data_prevista = null, referencia_externa = null, observacao = null, usuario_id = null
  } = dados;

  const { rows } = await pool.query(
    `INSERT INTO liquidacoes_pagamento
      (empresa_id, transacao_pagamento_id, transacao_pagamento_parcela_id, tipo,
       valor_bruto, taxa, valor_liquido, data_prevista, referencia_externa, observacao, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [empresa_id, transacao_pagamento_id, transacao_pagamento_parcela_id,
     tipo, valor_bruto, taxa, valor_liquido, data_prevista, referencia_externa, observacao, usuario_id]
  );
  return rows[0];
}

async function buscarPorId(id, empresaId) {
  const { rows } = await pool.query(
    'SELECT * FROM liquidacoes_pagamento WHERE id = $1 AND empresa_id = $2',
    [id, empresaId]
  );
  return rows[0] || null;
}

async function listar(empresaId, filtros = {}) {
  const params = [empresaId];
  const where = ['empresa_id = $1'];
  if (filtros.status) { params.push(filtros.status); where.push(`status = $${params.length}`); }
  if (filtros.transacaoPagamentoId) { params.push(filtros.transacaoPagamentoId); where.push(`transacao_pagamento_id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT * FROM liquidacoes_pagamento WHERE ${where.join(' AND ')} ORDER BY id DESC`,
    params
  );
  return rows;
}

async function atualizarStatus(id, empresaId, status, dataLiquidacao = null) {
  const { rows } = await pool.query(
    `UPDATE liquidacoes_pagamento
        SET status = $1, data_liquidacao = $2, updated_at = NOW()
      WHERE id = $3 AND empresa_id = $4
      RETURNING *`,
    [status, dataLiquidacao, id, empresaId]
  );
  return rows[0] || null;
}

module.exports = { criar, buscarPorId, listar, atualizarStatus };

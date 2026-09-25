const db=require('../config/db');

async function criar(dados){
    const {rows}=await db.query(
        `INSERT INTO transacoes_pagamento
            (empresa_id,tipo,forma_pagamento,origem,provedor,valor,taxa,
             valor_liquido,status,transacao_externa_id,autorizacao,nsu,tid,
             data_autorizacao,data_confirmacao,observacao,usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
            dados.empresa_id,dados.tipo,dados.forma_pagamento,
            dados.origem ?? 'MANUAL',dados.provedor ?? null,dados.valor,
            dados.taxa ?? 0,dados.valor_liquido ?? Number(dados.valor)-(Number(dados.taxa)||0),
            dados.status ?? 'PENDENTE',dados.transacao_externa_id ?? null,
            dados.autorizacao ?? null,dados.nsu ?? null,dados.tid ?? null,
            dados.data_autorizacao ?? null,dados.data_confirmacao ?? null,
            dados.observacao ?? null,dados.usuario_id ?? null
        ]
    );
    return rows[0];
}

async function criarParcela(dados){
    const {rows}=await db.query(
        `INSERT INTO transacoes_pagamento_parcelas
            (empresa_id,transacao_pagamento_id,numero,valor,data_prevista)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [dados.empresa_id,dados.transacao_pagamento_id,dados.numero,
         dados.valor,dados.data_prevista ?? null]
    );
    return rows[0];
}

async function buscarPorId(id,empresa_id){
    const {rows}=await db.query(
        'SELECT * FROM transacoes_pagamento WHERE id=$1 AND empresa_id=$2',
        [id,empresa_id]
    );
    return rows[0]||null;
}

async function listarParcelas(id,empresa_id){
    const {rows}=await db.query(
        `SELECT * FROM transacoes_pagamento_parcelas
         WHERE transacao_pagamento_id=$1 AND empresa_id=$2
         ORDER BY numero`,
        [id,empresa_id]
    );
    return rows;
}

module.exports={criar,criarParcela,buscarPorId,listarParcelas};

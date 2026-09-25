const db=require('../config/db');

async function resumo(empresaId,{dataInicio,dataFim,contaBancariaId=null}){
 const contaFiltro=contaBancariaId==null?'':' AND conta_bancaria_id = $4';
 const params=[empresaId,dataInicio,dataFim];
 if(contaBancariaId!=null) params.push(contaBancariaId);
 const {rows}=await db.query(
  `SELECT
     COALESCE(SUM(CASE WHEN tipo='ENTRADA' THEN valor ELSE 0 END),0) AS entradas,
     COALESCE(SUM(CASE WHEN tipo='SAIDA' THEN valor ELSE 0 END),0) AS saidas,
     COUNT(*)::int AS movimentos
   FROM movimentos_bancarios
   WHERE empresa_id=$1 AND data_movimento::date >= $2 AND data_movimento::date <= $3${contaFiltro}`,
  params);
 return rows[0];
}

async function porDia(empresaId,{dataInicio,dataFim,contaBancariaId=null}){
 const contaFiltro=contaBancariaId==null?'':' AND conta_bancaria_id = $4';
 const params=[empresaId,dataInicio,dataFim];
 if(contaBancariaId!=null) params.push(contaBancariaId);
 const {rows}=await db.query(
  `SELECT data_movimento::date AS data,
     COALESCE(SUM(CASE WHEN tipo='ENTRADA' THEN valor ELSE 0 END),0) AS entradas,
     COALESCE(SUM(CASE WHEN tipo='SAIDA' THEN valor ELSE 0 END),0) AS saidas
   FROM movimentos_bancarios
   WHERE empresa_id=$1 AND data_movimento::date >= $2 AND data_movimento::date <= $3${contaFiltro}
   GROUP BY data_movimento::date ORDER BY data`,
  params);
 return rows;
}

async function previsao(empresaId,{dataInicio,dataFim}){
 const {rows}=await db.query(
  `SELECT data_prevista AS data,
     COALESCE(SUM(CASE WHEN tipo='RECEBIMENTO' THEN valor_liquido ELSE 0 END),0) AS entradas_previstas,
     COALESCE(SUM(CASE WHEN tipo='PAGAMENTO' THEN valor_liquido ELSE 0 END),0) AS saidas_previstas
   FROM liquidacoes_pagamento
   WHERE empresa_id=$1 AND data_prevista IS NOT NULL
     AND data_prevista >= $2 AND data_prevista <= $3
     AND status IN ('PENDENTE','PREVISTA')
   GROUP BY data_prevista ORDER BY data_prevista`,
  [empresaId,dataInicio,dataFim]);
 return rows;
}

module.exports={resumo,porDia,previsao};

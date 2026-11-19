'use strict';

// Única fonte da regra "em que pé está a cobrança desta empresa". Fragmentos de SQL usados pela sessão
// (authMiddleware, uma ida ao banco por requisição) e pelas telas do Painel, para nunca divergirem.
// O "hoje" é o de São Paulo (CLAUDE.md: o dia de negócio nunca é o do servidor).
//
// Situações (nesta ordem de precedência):
//   NULL             empresa sem linha em empresa_cobranca (já existia antes do teste grátis): sem restrição
//   isenta           isenção concedida pela GiroNex
//   em_teste         hoje <= trial_fim
//   ativa            hoje <= pago_ate (pagamento registrado manualmente pela GiroNex)
//   somente_leitura  nenhuma das anteriores

const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

// `alias` = alias da tabela empresa_cobranca na consulta. Nunca vem do cliente.
const situacaoSql = (alias) => `(CASE
    WHEN ${alias}.empresa_id IS NULL THEN NULL
    WHEN ${alias}.isenta THEN 'isenta'
    WHEN ${alias}.trial_fim IS NOT NULL AND ${alias}.trial_fim >= ${HOJE_SQL} THEN 'em_teste'
    WHEN ${alias}.pago_ate IS NOT NULL AND ${alias}.pago_ate >= ${HOJE_SQL} THEN 'ativa'
    ELSE 'somente_leitura'
END)`;

// Último dia coberto na situação atual (fim do teste ou pagamento). NULL para isenta, sem regra e somente leitura.
const ateSql = (alias) => `(CASE
    WHEN ${alias}.empresa_id IS NULL OR ${alias}.isenta THEN NULL
    WHEN ${alias}.trial_fim IS NOT NULL AND ${alias}.trial_fim >= ${HOJE_SQL} THEN ${alias}.trial_fim::text
    WHEN ${alias}.pago_ate IS NOT NULL AND ${alias}.pago_ate >= ${HOJE_SQL} THEN ${alias}.pago_ate::text
END)`;

module.exports = { HOJE_SQL, situacaoSql, ateSql };

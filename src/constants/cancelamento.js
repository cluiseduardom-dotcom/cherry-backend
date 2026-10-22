'use strict';

// Política de cancelamento de venda por idade da venda (SPEC Cargos, Permissões e Cancelamento,
// decisão 8). Idade = tempo decorrido real desde a venda, em dias inteiros de 24 h (não depende
// de fuso horário nem de virada de calendário). Quem autoriza é definido por NÍVEL, não por nome
// de cargo: cada comércio ajusta a hierarquia na tela de cargos.

const LIMITE_SEM_AUTORIZACAO_DIAS = 7;
const LIMITE_SUPERVISOR_DIAS = 30;

const FAIXAS = Object.freeze({
    ATE_7_DIAS: Object.freeze({ codigo: 'ate_7_dias', ordem: 0, exige_autorizacao: false, cargo_minimo: null }),
    DE_8_A_30_DIAS: Object.freeze({ codigo: '8_a_30_dias', ordem: 1, exige_autorizacao: true, cargo_minimo: 'supervisor' }),
    ACIMA_30_DIAS: Object.freeze({ codigo: 'acima_30_dias', ordem: 2, exige_autorizacao: true, cargo_minimo: 'gerente' })
});

const CODIGOS_FAIXA = Object.freeze(Object.values(FAIXAS).map((faixa) => faixa.codigo));

function faixaPorDias(dias) {
    if (!Number.isFinite(dias) || dias < 0) {
        throw new Error('Idade da venda inválida');
    }

    if (dias <= LIMITE_SEM_AUTORIZACAO_DIAS) return FAIXAS.ATE_7_DIAS;
    if (dias <= LIMITE_SUPERVISOR_DIAS) return FAIXAS.DE_8_A_30_DIAS;

    return FAIXAS.ACIMA_30_DIAS;
}

function faixaPorCodigo(codigo) {
    return Object.values(FAIXAS).find((faixa) => faixa.codigo === codigo) || null;
}

module.exports = {
    LIMITE_SEM_AUTORIZACAO_DIAS,
    LIMITE_SUPERVISOR_DIAS,
    FAIXAS,
    CODIGOS_FAIXA,
    faixaPorDias,
    faixaPorCodigo
};

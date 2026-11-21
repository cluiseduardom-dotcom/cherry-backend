'use strict';

// Receita (ficha técnica) com rendimento. A ficha diz quanto de cada insumo UMA RECEITA consome (`quantidade`),
// e quantas unidades do produto acabado essa receita rende (`rendimento`, padrão 1). Quantidades são INTEIRAS,
// na menor unidade do insumo (gramas, ml...): o estoque do sistema continua inteiro, sem decimais no banco.
//
// Consumo de `unidades` produzidas = ceil(quantidade × unidades ÷ rendimento): arredonda PARA CIMA, então o
// sistema nunca registra menos insumo do que se gastou (diferença de até 1 unidade-base por insumo e por ordem).
// O máximo produzível é o inverso exato dessa regra: a maior quantidade cujo consumo cabe no saldo.
// Com rendimento 1 tudo coincide com a regra antiga (consumo por unidade × quantidade, floor(saldo ÷ consumo)).

// Divisão inteira com teto, só com inteiros (sem erro de ponto flutuante).
const divisaoCima = (numerador, denominador) => Math.floor((numerador + denominador - 1) / denominador);

// Rendimento ausente (ficha sem a coluna, dado antigo) vale 1: o comportamento de sempre.
const rendimentoOuUm = (rendimento) => (rendimento === undefined || rendimento === null ? 1 : Number(rendimento));

function consumoDaReceita(quantidade, rendimento, unidades) {
    return divisaoCima(Number(quantidade) * Number(unidades), rendimentoOuUm(rendimento));
}

function maximoProduzivel(saldo, quantidade, rendimento) {
    return Math.floor((Math.max(Number(saldo), 0) * rendimentoOuUm(rendimento)) / Number(quantidade));
}

// Consumo médio por unidade (só para mostrar; as contas usam consumoDaReceita).
function porUnidade(quantidade, rendimento) {
    return Number(quantidade) / rendimentoOuUm(rendimento);
}

module.exports = { consumoDaReceita, maximoProduzivel, porUnidade };

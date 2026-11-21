'use strict';

// Regras puras dos relatórios de gestão (sem banco, sem Express): período anterior, variação, curva ABC,
// cobertura de estoque e faixas de atraso. Os totais de dinheiro seguem as definições de
// `src/utils/resultadoVenda.js` (receita = subtotal − desconto; custo = custo congelado no item).

const { somarDias } = require('./dataSaoPaulo');
const { arredondar, percentual } = require('./resultadoVenda');

function paraMs(dataIso) {
    const [ano, mes, dia] = dataIso.split('-').map(Number);

    return Date.UTC(ano, mes - 1, dia);
}

// Dias corridos entre duas datas YYYY-MM-DD, contando os dois extremos.
function diasEntre(de, ate) {
    return Math.round((paraMs(ate) - paraMs(de)) / 86400000) + 1;
}

// Período imediatamente anterior, com o mesmo número de dias (base do comparativo).
function periodoAnterior(de, ate) {
    const dias = diasEntre(de, ate);

    return { data_de: somarDias(de, -dias), data_ate: somarDias(de, -1), dias };
}

// Variação percentual atual × anterior. Sem base de comparação (anterior = 0) não há %: null, nunca Infinity.
function variacaoPct(atual, anterior) {
    const a = Number(atual);
    const b = Number(anterior);

    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;

    return arredondar(((a - b) / Math.abs(b)) * 100, 2);
}

// Curva ABC pela receita acumulada: A até 80%, B até 95%, C o resto. Recebe itens com `receita` e devolve a
// mesma lista ordenada por receita (maior primeiro) com `curva` e `participacao_pct`. Receita total 0: tudo C.
function classificarCurvaAbc(itens) {
    const ordenados = [...itens].sort((x, y) => y.receita - x.receita);
    const total = ordenados.reduce((soma, item) => soma + item.receita, 0);
    let acumulado = 0;

    return ordenados.map((item) => {
        const antes = total > 0 ? (acumulado / total) * 100 : 100;

        acumulado += item.receita;

        // O item que cruza 80% ainda é A: a classe vem da posição ANTES de somá-lo.
        const curva = antes < 80 ? 'A' : antes < 95 ? 'B' : 'C';

        return { ...item, curva, participacao_pct: percentual(item.receita, total) };
    });
}

// Dias de estoque no ritmo de venda do período. Sem venda (ritmo 0) não há cobertura: null.
function coberturaDias(estoque, quantidadeVendida, diasDoPeriodo) {
    const ritmo = Number(quantidadeVendida) / diasDoPeriodo;

    if (!(ritmo > 0)) return null;

    return arredondar(Number(estoque) / ritmo, 1);
}

const FAIXAS_ATRASO = [
    { codigo: 'a_vencer', rotulo: 'A vencer', min: -Infinity, max: 0 },
    { codigo: 'ate_30', rotulo: '1 a 30 dias', min: 1, max: 30 },
    { codigo: 'de_31_a_60', rotulo: '31 a 60 dias', min: 31, max: 60 },
    { codigo: 'de_61_a_90', rotulo: '61 a 90 dias', min: 61, max: 90 },
    { codigo: 'acima_90', rotulo: 'Mais de 90 dias', min: 91, max: Infinity }
];

// Dias de atraso em relação à data de referência (positivo = vencido; ≤ 0 = a vencer ou vence hoje).
function diasDeAtraso(vencimento, dataRef) {
    return Math.round((paraMs(dataRef) - paraMs(vencimento)) / 86400000);
}

function faixaDeAtraso(dias) {
    return FAIXAS_ATRASO.find((faixa) => dias >= faixa.min && dias <= faixa.max);
}

module.exports = {
    diasEntre,
    periodoAnterior,
    variacaoPct,
    classificarCurvaAbc,
    coberturaDias,
    FAIXAS_ATRASO,
    diasDeAtraso,
    faixaDeAtraso
};

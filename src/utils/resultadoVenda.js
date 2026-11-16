'use strict';

// Resultado financeiro de venda(s): receita, custo, lucro bruto e lucro líquido, com a % sobre a receita.
//
// Definições (únicas, usadas na venda, na lista e no período):
//   receita        = subtotal − desconto (juros do crediário NÃO são receita de venda; mesma base da comissão)
//   custo          = Σ quantidade × custo_unitario congelado no item (não o custo atual do produto)
//   lucro_bruto    = receita − custo
//   comissao       = comissão do vendedor apurada na venda (estornada não conta)
//   impostos       = receita × alíquota configurada da empresa (a mesma do Ponto de Equilíbrio)
//   lucro_liquido  = lucro_bruto − comissao − impostos
// No período ainda se pode abater as despesas fixas rateadas (ver resultadoVendasService).
// A % é sempre sobre a receita; sem receita (0) não há %, e o retorno é null (nunca NaN/Infinity).

function arredondar(valor, casas = 2) {
    const fator = 10 ** casas;

    return Math.round((valor + Number.EPSILON) * fator) / fator;
}

function percentual(valor, receita) {
    if (!(receita > 0)) return null;

    return arredondar((valor / receita) * 100, 2);
}

function numero(valor) {
    const n = Number(valor);

    return Number.isFinite(n) ? n : 0;
}

function calcularResultado({ receita, custo, comissao = 0, aliquota = 0 }) {
    const r = numero(receita);
    const c = numero(custo);
    const com = numero(comissao);
    const imp = arredondar(r * numero(aliquota));
    const lucroBruto = arredondar(r - c);
    const lucroLiquido = arredondar(lucroBruto - com - imp);

    return {
        receita: arredondar(r),
        custo: arredondar(c),
        lucro_bruto: lucroBruto,
        margem_bruta_pct: percentual(lucroBruto, r),
        comissao: arredondar(com),
        impostos: imp,
        lucro_liquido: lucroLiquido,
        margem_liquida_pct: percentual(lucroLiquido, r)
    };
}

module.exports = { arredondar, percentual, calcularResultado };

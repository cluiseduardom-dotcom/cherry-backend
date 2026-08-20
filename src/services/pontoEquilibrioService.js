const pontoEquilibrioRepository = require('../repositories/pontoEquilibrioRepository');
const despesasFixasRepository = require('../repositories/despesasFixasRepository');
const configuracoesFinanceirasRepository = require('../repositories/configuracoesFinanceirasRepository');

function arredondar(valor, casas = 2) {
    const fator = 10 ** casas;
    return Math.round((valor + Number.EPSILON) * fator) / fator;
}

// margemContribuicao = 0 quando receita = 0 (em vez de NaN de uma divisão
// 0/0): isso empurra o cálculo pro mesmo caminho de "inviável" do passo
// seguinte (margemContribuicao <= 0), que é o tratamento de divisão por
// zero pedido — sem precisar de um caso especial separado.
//
// Quando inviável (margem de contribuição zero ou negativa), pontoEquilibrio
// e faltaParaAtingir voltam null: não existe um "quanto falta" bem definido
// quando a empresa não cobre nem o próprio custo variável com a receita
// atual — devolver 0 (que soaria como "meta batida") seria enganoso.
async function calcular({ dataInicio, dataFim }, empresaId) {
    const [receitaRaw, custoVariavelProdutosRaw, custoFixoTotalRaw, configuracao] = await Promise.all([
        pontoEquilibrioRepository.somarReceita(empresaId, dataInicio, dataFim),
        pontoEquilibrioRepository.somarCustoVariavelProdutos(empresaId, dataInicio, dataFim),
        despesasFixasRepository.somarAtivas(empresaId),
        configuracoesFinanceirasRepository.obterOuCriar(empresaId)
    ]);

    const receita = Number(receitaRaw);
    const custoVariavelProdutos = Number(custoVariavelProdutosRaw);
    const custoFixoTotal = Number(custoFixoTotalRaw);
    const aliquotaImposto = Number(configuracao.aliquota_imposto);

    const impostos = receita * aliquotaImposto;
    const custoVariavelTotal = custoVariavelProdutos + impostos;
    const margemContribuicao = receita > 0 ? (receita - custoVariavelTotal) / receita : 0;

    const inviavel = margemContribuicao <= 0;
    const pontoEquilibrio = inviavel ? null : custoFixoTotal / margemContribuicao;
    const faltaParaAtingir = inviavel ? null : Math.max(0, arredondar(pontoEquilibrio - receita));

    return {
        periodo: { inicio: dataInicio, fim: dataFim },
        receita: arredondar(receita),
        custoVariavelTotal: arredondar(custoVariavelTotal),
        margemContribuicao: arredondar(margemContribuicao, 4),
        custoFixoTotal: arredondar(custoFixoTotal),
        pontoEquilibrio: pontoEquilibrio === null ? null : arredondar(pontoEquilibrio),
        faltaParaAtingir,
        inviavel
    };
}

module.exports = {
    calcular
};

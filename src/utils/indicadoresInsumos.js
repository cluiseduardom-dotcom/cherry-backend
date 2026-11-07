// Indicadores de insumos (consumo, cobertura e reposição). Módulo puro, testável sem banco.
//
// Entrada: uma linha por insumo ativo com o saldo do Central, o consumo do período e a pendência.
// Regras (todas sobre dados que o sistema já tem; nenhum limite inventado):
//   consumo_medio_diario = consumo do período / dias
//   cobertura_dias       = saldo / consumo_medio_diario   (nula se não houve consumo no período)
//   reposição: "repor" quando esgotado (saldo 0), OU saldo <= estoque mínimo (se o mínimo for > 0),
//              OU há pendência (venda sem baixar por falta de saldo)
//   para_atingir_minimo  = max(0, mínimo - saldo) + pendência   (quanto comprar para sair do alerta)

const arredondar = (valor, casas) => {
    const fator = 10 ** casas;
    return Math.round((valor + Number.EPSILON) * fator) / fator;
};

function calcularIndicadorInsumo(linha, dias) {
    const saldo = Number(linha.saldo);
    const minimo = Number(linha.estoque_minimo) || 0;
    const consumo = Number(linha.consumo_periodo) || 0;
    const pendente = Number(linha.pendente) || 0;

    const motivos = [];
    if (saldo === 0) motivos.push('esgotado');
    if (minimo > 0 && saldo > 0 && saldo <= minimo) motivos.push('abaixo_minimo');
    if (pendente > 0) motivos.push('pendencia');

    const consumoMedioDiario = arredondar(consumo / dias, 2);

    return {
        id: linha.id,
        sku: linha.sku,
        nome: linha.nome,
        unidade: linha.unidade,
        saldo,
        estoque_minimo: minimo,
        consumo_periodo: consumo,
        consumo_medio_diario: consumoMedioDiario,
        cobertura_dias: consumo > 0 ? arredondar(saldo / (consumo / dias), 1) : null,
        pendente,
        repor: motivos.length > 0,
        motivos_reposicao: motivos,
        para_atingir_minimo: Math.max(0, minimo - saldo) + pendente
    };
}

function montarIndicadoresInsumos(linhas, dias) {
    const itens = linhas
        .map((linha) => ({ linha, indicador: calcularIndicadorInsumo(linha, dias) }));

    const insumos = itens.map(({ indicador }) => indicador);

    const totais = {
        insumos_ativos: insumos.length,
        esgotados: insumos.filter((i) => i.motivos_reposicao.includes('esgotado')).length,
        abaixo_minimo: insumos.filter((i) => i.motivos_reposicao.includes('abaixo_minimo')).length,
        com_pendencia: insumos.filter((i) => i.pendente > 0).length,
        a_repor: insumos.filter((i) => i.repor).length,
        sem_consumo_no_periodo: insumos.filter((i) => i.consumo_periodo === 0).length,
        consumo_total_periodo: insumos.reduce((soma, i) => soma + i.consumo_periodo, 0)
    };

    return { dias, insumos, totais };
}

module.exports = { calcularIndicadorInsumo, montarIndicadoresInsumos };

// Rateia despesas fixas (valor mensal) pelos dias reais dentro de um
// período: substitui a soma mensal cheia (que comparava um período de 7
// dias contra um mês inteiro de custo fixo, ou 3 meses contra só um mês).
//
// Todas as datas (dataInicio, dataFim, vigencia_inicio, vigencia_fim) são
// strings 'YYYY-MM-DD' — sem componente de hora, por isso Date.UTC em todas
// as conversões: não há "agora" envolvido aqui (diferente de
// pontoEquilibrioController.formatarData, que converte um Date de "agora"
// pra string e por isso usa getters locais), só aritmética entre datas já
// fixas, então UTC consistente nas duas pontas evita qualquer problema de
// fuso sem precisar dos getters locais.

function paraPartes(dataStr) {
    const [ano, mes, dia] = dataStr.split('-').map(Number);
    return { ano, mes, dia };
}

function paraMs(dataStr) {
    const { ano, mes, dia } = paraPartes(dataStr);
    return Date.UTC(ano, mes - 1, dia);
}

function diasNoMes(ano, mes) {
    // dia 0 do mês seguinte = último dia do mês `mes` (1-indexed)
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

// Divide [dataInicio, dataFim] em segmentos por mês calendário — cada
// segmento já é a interseção entre o período consultado e aquele mês.
function segmentosPorMes(dataInicioStr, dataFimStr) {
    const segmentos = [];
    const inicioPeriodoMs = paraMs(dataInicioStr);
    const fimPeriodoMs = paraMs(dataFimStr);

    let { ano, mes } = paraPartes(dataInicioStr);

    while (true) {
        const inicioMesMs = Date.UTC(ano, mes - 1, 1);
        const totalDiasNoMes = diasNoMes(ano, mes);
        const fimMesMs = Date.UTC(ano, mes - 1, totalDiasNoMes);

        segmentos.push({
            inicioMs: Math.max(inicioPeriodoMs, inicioMesMs),
            fimMs: Math.min(fimPeriodoMs, fimMesMs),
            diasNoMes: totalDiasNoMes
        });

        if (fimMesMs >= fimPeriodoMs) break;

        mes += 1;
        if (mes > 12) {
            mes = 1;
            ano += 1;
        }
    }

    return segmentos;
}

// max dos inícios, min dos fins — vigencia_fim null = sem limite superior.
function ratearCustoFixo(despesas, dataInicio, dataFim) {
    if (!despesas || despesas.length === 0) return 0;

    const segmentos = segmentosPorMes(dataInicio, dataFim);
    let total = 0;

    for (const despesa of despesas) {
        const valor = Number(despesa.valor);
        const vigenciaInicioMs = paraMs(despesa.vigencia_inicio);
        const vigenciaFimMs = despesa.vigencia_fim ? paraMs(despesa.vigencia_fim) : Infinity;

        for (const segmento of segmentos) {
            const overlapInicioMs = Math.max(segmento.inicioMs, vigenciaInicioMs);
            const overlapFimMs = Math.min(segmento.fimMs, vigenciaFimMs);

            if (overlapInicioMs > overlapFimMs) continue;

            const diasOverlap = Math.round((overlapFimMs - overlapInicioMs) / 86400000) + 1;
            total += valor * (diasOverlap / segmento.diasNoMes);
        }
    }

    return Math.round((total + Number.EPSILON) * 100) / 100;
}

module.exports = { ratearCustoFixo };

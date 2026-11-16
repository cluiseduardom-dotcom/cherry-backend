const { z } = require('zod');

const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const MAX_DIAS_PERIODO = 731;
const MAX_DIAS_SERIE_DIARIA = 93;

function paraMs(dataIso) {
    const [ano, mes, dia] = dataIso.split('-').map(Number);

    return Date.UTC(ano, mes - 1, dia);
}

// Dias corridos do período, contando os dois extremos.
function diasEntre(de, ate) {
    return Math.round((paraMs(ate) - paraMs(de)) / 86400000) + 1;
}

const resultadoPeriodoSchema = z.object({
    data_de: dataISO('Data inicial inválida'),
    data_ate: dataISO('Data final inválida'),
    agrupar: z.enum(['dia', 'mes'], { error: 'Agrupamento inválido (use dia ou mes)' }).optional()
}).superRefine((data, ctx) => {
    if (data.data_de > data.data_ate) {
        ctx.addIssue({ code: 'custom', message: 'Data inicial não pode ser depois da data final', path: ['data_ate'] });
        return;
    }

    const dias = diasEntre(data.data_de, data.data_ate);

    if (dias > MAX_DIAS_PERIODO) {
        ctx.addIssue({ code: 'custom', message: `Período máximo de ${MAX_DIAS_PERIODO} dias`, path: ['data_ate'] });
    } else if (data.agrupar === 'dia' && dias > MAX_DIAS_SERIE_DIARIA) {
        ctx.addIssue({ code: 'custom', message: `Série diária aceita no máximo ${MAX_DIAS_SERIE_DIARIA} dias`, path: ['agrupar'] });
    }
});

module.exports = { resultadoPeriodoSchema, diasEntre };

const pontoEquilibrioService = require('../services/pontoEquilibrioService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { periodoPontoEquilibrioSchema } = require('../validations/pontoEquilibrioValidation');

// Mês corrente = do dia 1 do mês até hoje (não o mês inteiro) — usa getters
// locais do Date (getFullYear/getMonth/getDate), nunca toISOString, mesma
// armadilha de fuso horário documentada na validação.
function formatarData(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function periodoPadrao() {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

    return {
        dataInicio: formatarData(inicioMes),
        dataFim: formatarData(hoje)
    };
}

async function calcular(req, res, next) {
    try {
        const parsed = periodoPontoEquilibrioSchema.safeParse({
            data_inicio: req.query.data_inicio,
            data_fim: req.query.data_fim
        });

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const padrao = periodoPadrao();
        const dataInicio = parsed.data.data_inicio ?? padrao.dataInicio;
        const dataFim = parsed.data.data_fim ?? padrao.dataFim;

        const resultado = await pontoEquilibrioService.calcular({ dataInicio, dataFim }, req.usuario.empresa_id);

        return response.success(res, resultado);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    calcular
};

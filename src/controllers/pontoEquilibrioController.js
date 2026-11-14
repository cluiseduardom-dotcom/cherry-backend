const pontoEquilibrioService = require('../services/pontoEquilibrioService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { hojeSP, inicioDoMesSP } = require('../utils/dataSaoPaulo');
const { periodoPontoEquilibrioSchema } = require('../validations/pontoEquilibrioValidation');

// Mês corrente = do dia 1 do mês até hoje (não o mês inteiro), no dia de São Paulo (o servidor roda em UTC).
function periodoPadrao() {
    return {
        dataInicio: inicioDoMesSP(),
        dataFim: hojeSP()
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

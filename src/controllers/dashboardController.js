const dashboardService = require('../services/dashboardService');
const response = require('../utils/response');

const DIAS_PADRAO = 90;
const DIAS_MAXIMO = 365;

function parseDias(query) {
    let dias = parseInt(query.dias, 10);

    if (!Number.isInteger(dias) || dias < 1) dias = DIAS_PADRAO;
    if (dias > DIAS_MAXIMO) dias = DIAS_MAXIMO;

    return dias;
}

async function resumo(req, res, next) {
    try {
        const dias = parseDias(req.query);
        const dados = await dashboardService.resumo(dias);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function curvaABC(req, res, next) {
    try {
        const dados = await dashboardService.curvaABC();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function giro(req, res, next) {
    try {
        const dias = parseDias(req.query);
        const dados = await dashboardService.giro(dias);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function cobertura(req, res, next) {
    try {
        const dias = parseDias(req.query);
        const dados = await dashboardService.cobertura(dias);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function margem(req, res, next) {
    try {
        const dados = await dashboardService.margem();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    resumo,
    curvaABC,
    giro,
    cobertura,
    margem
};

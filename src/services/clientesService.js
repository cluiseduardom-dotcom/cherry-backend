const clientesRepository = require('../repositories/clientesRepository');
const AppError = require('../errors/AppError');

async function listar(empresaId) {
    return clientesRepository.listar(empresaId);
}

async function criar(dados, empresaId) {
    return clientesRepository.criar({ ...dados, empresa_id: empresaId });
}

async function historico(id, empresaId) {
    const registros = await clientesRepository.getHistorico(id, empresaId);

    if (registros.length === 0) {
        throw new AppError('Nenhum histórico encontrado', 404);
    }

    return registros;
}

async function ranking(empresaId) {
    return clientesRepository.getRanking(empresaId);
}

async function totalGasto(id, empresaId) {
    const dados = await clientesRepository.getTotalGasto(id, empresaId);

    if (!dados) {
        throw new AppError('Cliente não encontrado', 404);
    }

    return dados;
}

module.exports = {
    listar,
    criar,
    historico,
    ranking,
    totalGasto
};

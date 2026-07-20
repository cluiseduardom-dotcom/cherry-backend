const clientesRepository = require('../repositories/clientesRepository');
const AppError = require('../errors/AppError');

async function listar() {
    return clientesRepository.listar();
}

async function criar(dados) {
    return clientesRepository.criar(dados);
}

async function historico(id) {
    const registros = await clientesRepository.getHistorico(id);

    if (registros.length === 0) {
        throw new AppError('Nenhum histórico encontrado', 404);
    }

    return registros;
}

async function ranking() {
    return clientesRepository.getRanking();
}

async function totalGasto(id) {
    const dados = await clientesRepository.getTotalGasto(id);

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

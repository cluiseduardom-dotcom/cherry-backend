const despesasFixasRepository = require('../repositories/despesasFixasRepository');
const AppError = require('../errors/AppError');

async function listar(empresaId) {
    return despesasFixasRepository.listar(empresaId);
}

async function criar(dados, empresaId) {
    return despesasFixasRepository.criar({ ...dados, empresa_id: empresaId });
}

async function atualizar(id, dados, empresaId) {
    const atualizada = await despesasFixasRepository.atualizar(id, dados, empresaId);

    if (!atualizada) {
        throw new AppError('Despesa fixa não encontrada', 404);
    }

    return atualizada;
}

async function remover(id, empresaId) {
    const removida = await despesasFixasRepository.deletar(id, empresaId);

    if (!removida) {
        throw new AppError('Despesa fixa não encontrada', 404);
    }

    return removida;
}

async function alternarAtivo(id, empresaId) {
    const alternada = await despesasFixasRepository.alternarAtivo(id, empresaId);

    if (!alternada) {
        throw new AppError('Despesa fixa não encontrada', 404);
    }

    return alternada;
}

module.exports = {
    listar,
    criar,
    atualizar,
    remover,
    alternarAtivo
};

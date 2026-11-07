const niveisCategoriaRepository = require('../repositories/niveisCategoriaRepository');
const AppError = require('../errors/AppError');

async function listar(empresaId, escopo = 'produto') {
    return niveisCategoriaRepository.listar(empresaId, escopo);
}

async function criar(dados, empresaId) {
    const escopo = dados.escopo ?? 'produto';
    const existente = await niveisCategoriaRepository.buscarPorNivel(dados.nivel, empresaId, escopo);

    if (existente) {
        throw new AppError('Já existe um rótulo para este nível', 409);
    }

    try {
        return await niveisCategoriaRepository.criar({ nivel: dados.nivel, nome: dados.nome, empresa_id: empresaId, escopo });
    } catch (error) {
        if (error.code === '23505') {
            throw new AppError('Já existe um rótulo para este nível', 409);
        }
        throw error;
    }
}

async function atualizar(id, dados, empresaId) {
    const atualizado = await niveisCategoriaRepository.atualizarNome(id, dados.nome, empresaId);

    if (!atualizado) {
        throw new AppError('Nível não encontrado', 404);
    }

    return atualizado;
}

async function remover(id, empresaId) {
    const removido = await niveisCategoriaRepository.remover(id, empresaId);

    if (!removido) {
        throw new AppError('Nível não encontrado', 404);
    }

    return removido;
}

module.exports = { listar, criar, atualizar, remover };

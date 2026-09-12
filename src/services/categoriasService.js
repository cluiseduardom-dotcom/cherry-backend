const categoriasRepository = require('../repositories/categoriasRepository');
const AppError = require('../errors/AppError');

async function listar({ page, pageSize }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await categoriasRepository.listarPaginado({ limit, offset, empresa_id: empresaId });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function criar(dados, empresaId) {
    const codigo = dados.codigo.toUpperCase();
    const existente = await categoriasRepository.buscarPorCodigoNivel(dados.nivel, codigo, empresaId);

    if (existente) {
        throw new AppError('Já existe uma categoria com esse código neste nível', 409);
    }

    return categoriasRepository.criar({ nivel: dados.nivel, codigo, nome: dados.nome, empresa_id: empresaId });
}

async function atualizar(id, dados, empresaId) {
    const atualizado = await categoriasRepository.atualizarNome(id, dados.nome, empresaId);

    if (!atualizado) {
        throw new AppError('Categoria não encontrada', 404);
    }

    return atualizado;
}

async function remover(id, empresaId) {
    const removido = await categoriasRepository.softDelete(id, empresaId);

    if (!removido) {
        throw new AppError('Categoria não encontrada', 404);
    }

    return removido;
}

module.exports = { listar, criar, atualizar, remover };

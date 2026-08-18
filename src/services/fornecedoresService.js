const fornecedoresRepository = require('../repositories/fornecedoresRepository');
const AppError = require('../errors/AppError');

async function listar({ page, pageSize, nome }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await fornecedoresRepository.listarPaginado({ limit, offset, nome, empresa_id: empresaId });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, empresaId) {
    const fornecedor = await fornecedoresRepository.buscarPorId(id, empresaId);

    if (!fornecedor) {
        throw new AppError('Fornecedor não encontrado', 404);
    }

    return fornecedor;
}

async function criar(dados, empresaId) {
    return fornecedoresRepository.criar({ ...dados, empresa_id: empresaId });
}

async function atualizar(id, dados, empresaId) {
    const fornecedor = await fornecedoresRepository.buscarPorId(id, empresaId);

    if (!fornecedor) {
        throw new AppError('Fornecedor não encontrado', 404);
    }

    return fornecedoresRepository.atualizar(id, dados, empresaId);
}

async function remover(id, empresaId) {
    const fornecedor = await fornecedoresRepository.buscarPorId(id, empresaId);

    if (!fornecedor) {
        throw new AppError('Fornecedor não encontrado', 404);
    }

    return fornecedoresRepository.desativar(id, empresaId);
}

module.exports = {
    listar,
    buscarPorId,
    criar,
    atualizar,
    remover
};

const producoesRepository = require('../repositories/producoesRepository');
const AppError = require('../errors/AppError');

async function criar(dados, usuarioId, empresaId) {
    return producoesRepository.criar({ ...dados, usuario_id: usuarioId, empresa_id: empresaId });
}

async function listar({ page, pageSize, produto_id, dataDe, dataAte }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await producoesRepository.listarPaginado({
        limit, offset, produto_id, dataDe, dataAte, empresa_id: empresaId
    });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, empresaId) {
    const producao = await producoesRepository.buscarPorId(id, empresaId);

    if (!producao) {
        throw new AppError('Produção não encontrada', 404);
    }

    return producao;
}

async function cancelar(id, usuarioId, empresaId) {
    return producoesRepository.cancelar(id, usuarioId, empresaId);
}

module.exports = { criar, listar, buscarPorId, cancelar };

const comprasRepository = require('../repositories/comprasRepository');
const AppError = require('../errors/AppError');

async function criar(dados, usuario_id, empresaId) {
    return comprasRepository.criar({ ...dados, usuario_id, empresa_id: empresaId });
}

async function listar({ page, pageSize, fornecedor_id, dataDe, dataAte }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await comprasRepository.listarPaginado({
        limit,
        offset,
        fornecedor_id,
        dataDe,
        dataAte,
        empresa_id: empresaId
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
    const compra = await comprasRepository.buscarPorId(id, empresaId);

    if (!compra) {
        throw new AppError('Compra não encontrada', 404);
    }

    return compra;
}

async function cancelar(id, usuario_id, empresaId) {
    return comprasRepository.cancelar(id, usuario_id, empresaId);
}

module.exports = {
    criar,
    listar,
    buscarPorId,
    cancelar
};

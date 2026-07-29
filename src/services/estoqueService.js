const estoqueRepository = require('../repositories/estoqueRepository');
const produtosRepository = require('../repositories/produtosRepository');
const AppError = require('../errors/AppError');

async function registrarMovimentacao(produto_id, { tipo, quantidade, motivo }, usuario_id, empresaId) {
    const produto = await produtosRepository.buscarPorId(produto_id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    if (!produto.ativo) {
        throw new AppError('Produto inativo não pode receber movimentações de estoque', 400);
    }

    const resultado = await estoqueRepository.criarMovimentacao({
        produto_id,
        tipo,
        quantidade,
        motivo,
        usuario_id,
        empresa_id: empresaId
    });

    if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') {
        throw new AppError('Produto não encontrado', 404);
    }

    if (resultado.erro === 'ESTOQUE_INSUFICIENTE') {
        throw new AppError('Estoque insuficiente para essa saída', 409);
    }

    return resultado.movimentacao;
}

async function historicoPorProduto(produto_id, { page, pageSize }, empresaId) {
    const produto = await produtosRepository.buscarPorId(produto_id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await estoqueRepository.listarPorProduto(produto_id, empresaId, { limit, offset });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function alertasEstoqueBaixo(empresaId) {
    return estoqueRepository.getEstoqueBaixo(empresaId);
}

module.exports = {
    registrarMovimentacao,
    historicoPorProduto,
    alertasEstoqueBaixo
};

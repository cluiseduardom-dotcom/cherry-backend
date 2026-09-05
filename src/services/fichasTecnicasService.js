const fichasTecnicasRepository = require('../repositories/fichasTecnicasRepository');
const produtosRepository = require('../repositories/produtosRepository');
const AppError = require('../errors/AppError');

async function criar(produtoId, dados, usuarioId, empresaId) {
    return fichasTecnicasRepository.criarVersao({
        produto_id: produtoId,
        itens: dados.itens,
        usuario_id: usuarioId,
        empresa_id: empresaId
    });
}

async function buscarVigente(produtoId, empresaId) {
    const produto = await produtosRepository.buscarPorId(produtoId, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const ficha = await fichasTecnicasRepository.buscarVigentePorProduto(produtoId, empresaId);

    if (!ficha) {
        throw new AppError('Ficha técnica não encontrada', 404);
    }

    return ficha;
}

async function historico(produtoId, empresaId) {
    const produto = await produtosRepository.buscarPorId(produtoId, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    return fichasTecnicasRepository.buscarHistoricoPorProduto(produtoId, empresaId);
}

module.exports = { criar, buscarVigente, historico };

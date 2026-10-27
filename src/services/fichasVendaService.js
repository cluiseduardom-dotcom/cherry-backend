const fichasVendaRepository = require('../repositories/fichasVendaRepository');
const AppError = require('../errors/AppError');

async function criar(produtoId, dados, usuarioId, empresaId) {
    return fichasVendaRepository.criarVersao({
        produto_id: produtoId,
        itens: dados.itens,
        usuario_id: usuarioId,
        empresa_id: empresaId
    });
}

// Produto sem ficha vigente não é erro: devolve ficha nula com o custo só do item (SKU sem insumos).
async function buscarVigente(produtoId, empresaId) {
    const { produto, ficha } = await fichasVendaRepository.buscarVigentePorProduto(produtoId, empresaId);

    if (!produto) throw new AppError('Produto não encontrado', 404);

    if (ficha) return ficha;

    const custoItem = Number(produto.custo);

    return {
        id: null,
        produto_id: produtoId,
        vigente: true,
        itens: [],
        custo_item: custoItem,
        custo_insumos: 0,
        custo_total_sku: custoItem
    };
}

async function historico(produtoId, empresaId) {
    const fichas = await fichasVendaRepository.buscarHistoricoPorProduto(produtoId, empresaId);

    if (!fichas) throw new AppError('Produto não encontrado', 404);

    return fichas;
}

module.exports = { criar, buscarVigente, historico };

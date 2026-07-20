const produtosRepository = require('../repositories/produtosRepository');
const AppError = require('../errors/AppError');

function comMargem(produto) {
    const precoVenda = Number(produto.preco_venda);
    const custo = Number(produto.custo);
    const margem_percentual = precoVenda > 0 ? Number((((precoVenda - custo) / precoVenda) * 100).toFixed(2)) : null;

    return { ...produto, margem_percentual };
}

async function listar({ page, pageSize }) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await produtosRepository.listarPaginado({ limit, offset });

    return {
        items: items.map(comMargem),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id) {
    const produto = await produtosRepository.buscarPorId(id);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    return comMargem(produto);
}

async function criar(dados) {
    const existente = await produtosRepository.buscarPorSku(dados.sku);

    if (existente) {
        throw new AppError('SKU já cadastrado', 409);
    }

    const produto = await produtosRepository.criar(dados);

    return comMargem(produto);
}

async function atualizar(id, dados) {
    const produto = await produtosRepository.buscarPorId(id);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    if (dados.sku && dados.sku !== produto.sku) {
        const existente = await produtosRepository.buscarPorSku(dados.sku);

        if (existente) {
            throw new AppError('SKU já cadastrado', 409);
        }
    }

    const atualizado = await produtosRepository.atualizar(id, dados);

    return comMargem(atualizado);
}

async function remover(id) {
    const produto = await produtosRepository.buscarPorId(id);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const desativado = await produtosRepository.desativar(id);

    return comMargem(desativado);
}

async function ajustarPreco(id, percentual) {
    const produto = await produtosRepository.buscarPorId(id);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    return produtosRepository.ajustarPreco(id, percentual);
}

async function giro() {
    return produtosRepository.getGiro();
}

async function parados() {
    return produtosRepository.getParados();
}

async function pricingProfissional() {
    return produtosRepository.getPricingProfissional();
}

async function lucroPorProduto() {
    return produtosRepository.getLucroPorProduto();
}

async function alertaPrejuizo() {
    return produtosRepository.getAlertaPrejuizo();
}

async function maisVendidos() {
    return produtosRepository.getMaisVendidos();
}

async function curvaABC() {
    return produtosRepository.getCurvaABC();
}

async function reposicao() {
    return produtosRepository.getReposicao();
}

async function sugestaoPreco() {
    return produtosRepository.getSugestaoPreco();
}

async function inteligencia() {
    return produtosRepository.getInteligencia();
}

async function acoes() {
    return produtosRepository.getAcoes();
}

async function dashboard() {
    return produtosRepository.getDashboard();
}

module.exports = {
    listar,
    buscarPorId,
    criar,
    atualizar,
    remover,
    ajustarPreco,
    giro,
    parados,
    pricingProfissional,
    lucroPorProduto,
    alertaPrejuizo,
    maisVendidos,
    curvaABC,
    reposicao,
    sugestaoPreco,
    inteligencia,
    acoes,
    dashboard
};

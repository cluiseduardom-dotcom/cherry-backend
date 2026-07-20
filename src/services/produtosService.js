const produtosRepository = require('../repositories/produtosRepository');
const AppError = require('../errors/AppError');

async function listar() {
    return produtosRepository.listar();
}

async function criar(dados) {
    return produtosRepository.criar(dados);
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
    criar,
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

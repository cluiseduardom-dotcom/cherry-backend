const produtosRepository = require('../repositories/produtosRepository');
const precosRepository = require('../repositories/precosRepository');
const AppError = require('../errors/AppError');

function comMargem(produto) {
    const precoVenda = Number(produto.preco_venda);
    const custo = Number(produto.custo);
    const margem_percentual = precoVenda > 0 ? Number((((precoVenda - custo) / precoVenda) * 100).toFixed(2)) : null;

    return { ...produto, margem_percentual };
}

async function resolverCanal(nome) {
    const canal = await precosRepository.buscarCanalPorNome(nome);

    if (!canal) {
        throw new AppError('Canal inválido', 400);
    }

    return canal;
}

function comPrecoCanal(produto, canalNome, precoRow) {
    return {
        ...produto,
        preco_canal: {
            canal: canalNome,
            preco_venda: precoRow ? Number(precoRow.preco_venda) : null,
            markup_percentual: precoRow ? Number(precoRow.markup_percentual) : null,
            margem_percentual: precoRow ? Number(precoRow.margem_percentual) : null,
            vigente_desde: precoRow ? precoRow.vigente_desde : null
        }
    };
}

async function listar({ page, pageSize, canal }) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const canalRow = await resolverCanal(canal);
    const { items, total } = await produtosRepository.listarPaginado({ limit, offset });

    const precos = await precosRepository.listarPrecosVigentesPorCanal(items.map((produto) => produto.id), canalRow.id);
    const precosPorProduto = new Map(precos.map((preco) => [preco.produto_id, preco]));

    return {
        items: items.map((produto) => comPrecoCanal(comMargem(produto), canalRow.nome, precosPorProduto.get(produto.id))),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, canal) {
    const produto = await produtosRepository.buscarPorId(id);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const canalRow = await resolverCanal(canal);
    const precoRow = await precosRepository.buscarPrecoVigente(id, canalRow.id);

    return comPrecoCanal(comMargem(produto), canalRow.nome, precoRow);
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

const produtosRepository = require('../repositories/produtosRepository');
const precosRepository = require('../repositories/precosRepository');
const AppError = require('../errors/AppError');

function comMargem(produto) {
    const precoVenda = Number(produto.preco_venda);
    const custo = Number(produto.custo);
    const margem_percentual = precoVenda > 0 ? Number((((precoVenda - custo) / precoVenda) * 100).toFixed(2)) : null;

    return { ...produto, margem_percentual };
}

async function resolverCanal(nome, empresaId) {
    const canal = await precosRepository.buscarCanalPorNome(nome, empresaId);

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

async function listar({ page, pageSize, canal }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const canalRow = await resolverCanal(canal, empresaId);
    const { items, total } = await produtosRepository.listarPaginado({ limit, offset, empresa_id: empresaId });

    const precos = await precosRepository.listarPrecosVigentesPorCanal(items.map((produto) => produto.id), canalRow.id, empresaId);
    const precosPorProduto = new Map(precos.map((preco) => [preco.produto_id, preco]));

    return {
        items: items.map((produto) => comPrecoCanal(comMargem(produto), canalRow.nome, precosPorProduto.get(produto.id))),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, canal, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const canalRow = await resolverCanal(canal, empresaId);
    const precoRow = await precosRepository.buscarPrecoVigente(id, canalRow.id, empresaId);

    return comPrecoCanal(comMargem(produto), canalRow.nome, precoRow);
}

async function criar(dados, empresaId) {
    const existente = await produtosRepository.buscarPorSku(dados.sku, empresaId);

    if (existente) {
        throw new AppError('SKU já cadastrado', 409);
    }

    const produto = await produtosRepository.criar({ ...dados, empresa_id: empresaId });

    return comMargem(produto);
}

async function atualizar(id, dados, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    if (dados.sku && dados.sku !== produto.sku) {
        const existente = await produtosRepository.buscarPorSku(dados.sku, empresaId);

        if (existente) {
            throw new AppError('SKU já cadastrado', 409);
        }
    }

    const atualizado = await produtosRepository.atualizar(id, dados, empresaId);

    return comMargem(atualizado);
}

async function remover(id, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const desativado = await produtosRepository.desativar(id, empresaId);

    return comMargem(desativado);
}

async function ajustarPreco(id, percentual, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    return produtosRepository.ajustarPreco(id, percentual, empresaId);
}

async function giro(empresaId) {
    return produtosRepository.getGiro(empresaId);
}

async function parados(empresaId) {
    return produtosRepository.getParados(empresaId);
}

async function pricingProfissional(empresaId) {
    return produtosRepository.getPricingProfissional(empresaId);
}

async function lucroPorProduto(empresaId) {
    return produtosRepository.getLucroPorProduto(empresaId);
}

async function alertaPrejuizo(empresaId) {
    return produtosRepository.getAlertaPrejuizo(empresaId);
}

async function maisVendidos(empresaId) {
    return produtosRepository.getMaisVendidos(empresaId);
}

async function curvaABC(empresaId) {
    return produtosRepository.getCurvaABC(empresaId);
}

async function reposicao(empresaId) {
    return produtosRepository.getReposicao(empresaId);
}

async function sugestaoPreco(empresaId) {
    return produtosRepository.getSugestaoPreco(empresaId);
}

async function inteligencia(empresaId) {
    return produtosRepository.getInteligencia(empresaId);
}

async function acoes(empresaId) {
    return produtosRepository.getAcoes(empresaId);
}

async function dashboard(empresaId) {
    return produtosRepository.getDashboard(empresaId);
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

const precosRepository = require('../repositories/precosRepository');
const produtosRepository = require('../repositories/produtosRepository');
const AppError = require('../errors/AppError');

function arredondar(valor) {
    return Number(valor.toFixed(2));
}

// markup_percentual é sempre relativo ao custo; margem_percentual é sempre
// relativa ao preço de venda. Um dos dois (markup ou preco_venda) já vem
// calculado ou informado; o outro é sempre derivado aqui, nunca aceito do cliente.
function calcularPreco({ custo, markup_percentual, preco_venda }) {
    let precoVenda;

    if (markup_percentual !== undefined) {
        precoVenda = custo * (1 + markup_percentual / 100);
    } else {
        precoVenda = preco_venda;
    }

    precoVenda = arredondar(precoVenda);

    const markup = arredondar(((precoVenda - custo) / custo) * 100);
    const margem = arredondar(((precoVenda - custo) / precoVenda) * 100);

    return { preco_venda: precoVenda, markup_percentual: markup, margem_percentual: margem };
}

async function listarCanais(empresaId) {
    return precosRepository.listarCanais(empresaId);
}

async function obterCanalPorNome(nome, empresaId) {
    const canal = await precosRepository.buscarCanalPorNome(nome, empresaId);

    if (!canal) {
        throw new AppError('Canal inválido', 400);
    }

    return canal;
}

async function definirPreco(produto_id, canal_id, dados, usuario_id, empresaId) {
    const produto = await produtosRepository.buscarPorId(produto_id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const canal = await precosRepository.buscarCanalPorId(canal_id, empresaId);

    if (!canal) {
        throw new AppError('Canal não encontrado', 404);
    }

    const custo = Number(produto.custo);
    const calculado = calcularPreco({ custo, ...dados });

    if (calculado.preco_venda < custo) {
        throw new AppError('Preço de venda não pode ser menor que o custo', 409);
    }

    return precosRepository.inserirPreco({
        produto_id,
        canal_id,
        preco_venda: calculado.preco_venda,
        markup_percentual: calculado.markup_percentual,
        margem_percentual: calculado.margem_percentual,
        usuario_id,
        empresa_id: empresaId
    });
}

async function listarVigentesPorProduto(produto_id, empresaId) {
    const produto = await produtosRepository.buscarPorId(produto_id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    return precosRepository.listarPrecosVigentesPorProduto(produto_id, empresaId);
}

async function historicoPorProduto(produto_id, canalNome, { page, pageSize }, empresaId) {
    const produto = await produtosRepository.buscarPorId(produto_id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    let canal_id;

    if (canalNome !== undefined) {
        const canal = await obterCanalPorNome(canalNome, empresaId);
        canal_id = canal.id;
    }

    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await precosRepository.listarHistoricoPorProduto(produto_id, canal_id, empresaId, { limit, offset });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

module.exports = {
    calcularPreco,
    listarCanais,
    obterCanalPorNome,
    definirPreco,
    listarVigentesPorProduto,
    historicoPorProduto
};

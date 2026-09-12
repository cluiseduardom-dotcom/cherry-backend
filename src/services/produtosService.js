const produtosRepository = require('../repositories/produtosRepository');
const precosRepository = require('../repositories/precosRepository');
const categoriasRepository = require('../repositories/categoriasRepository');
const skuService = require('./skuService');
const db = require('../config/db');
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
    // listarPrecosVigentesPorCanal usa LEFT JOIN LATERAL ... ON true, que sempre
    // devolve uma linha por produto (com colunas NULL quando não há preço) — por
    // isso `precoRow` sozinho não indica que existe preço: é preciso checar o
    // campo. Sem essa checagem, Number(null) vira 0 e o preço aparece como
    // "R$ 0,00" em vez de "sem preço definido".
    const temPreco = precoRow != null && precoRow.preco_venda != null;

    return {
        ...produto,
        preco_canal: {
            canal: canalNome,
            preco_venda: temPreco ? Number(precoRow.preco_venda) : null,
            markup_percentual: temPreco ? Number(precoRow.markup_percentual) : null,
            margem_percentual: temPreco ? Number(precoRow.margem_percentual) : null,
            vigente_desde: temPreco ? precoRow.vigente_desde : null
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

    const categoriaLinhas = await produtosRepository.buscarCategoriasPorProdutoIds(items.map((produto) => produto.id), empresaId);
    const categoriasPorProduto = new Map();
    for (const { produto_id, ...categoria } of categoriaLinhas) {
        if (!categoriasPorProduto.has(produto_id)) categoriasPorProduto.set(produto_id, []);
        categoriasPorProduto.get(produto_id).push(categoria);
    }

    return {
        items: items.map((produto) => ({
            ...comPrecoCanal(comMargem(produto), canalRow.nome, precosPorProduto.get(produto.id)),
            categorias: categoriasPorProduto.get(produto.id) || []
        })),
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
    const categorias = await produtosRepository.buscarCategoriasDoProduto(id, empresaId);

    return { ...comPrecoCanal(comMargem(produto), canalRow.nome, precoRow), categorias };
}

async function criar(dados, empresaId) {
    const produto = await produtosRepository.criar({ ...dados, empresa_id: empresaId });

    return comMargem(produto);
}

async function atualizar(id, dados, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
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

async function categorizar(id, categoriaIds, empresaId) {
    const produto = await produtosRepository.buscarPorId(id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    let categorias = [];

    if (categoriaIds.length > 0) {
        categorias = await categoriasRepository.buscarPorIds(categoriaIds, empresaId);

        if (categorias.length !== categoriaIds.length) {
            throw new AppError('Categoria inválida', 400);
        }

        const niveis = categorias.map((c) => c.nivel);
        if (new Set(niveis).size !== niveis.length) {
            throw new AppError('Não é permitido mais de uma categoria do mesmo nível', 400);
        }
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await produtosRepository.substituirCategorias(id, categoriaIds, empresaId, client);

        let produtoAtualizado = produto;

        if (!produto.sku && categorias.length > 0) {
            const sku = await skuService.gerar(categorias, empresaId, client);

            try {
                const atualizado = await produtosRepository.definirSkuSeNulo(id, sku, empresaId, client);
                if (atualizado) produtoAtualizado = atualizado;
            } catch (error) {
                if (error.code === '23505') {
                    throw new AppError('Erro ao gerar SKU, tente novamente', 409);
                }
                throw error;
            }
        }

        await client.query('COMMIT');

        const categoriasVinculadas = await produtosRepository.buscarCategoriasDoProduto(id, empresaId);

        return { ...comMargem(produtoAtualizado), categorias: categoriasVinculadas };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
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
    categorizar,
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

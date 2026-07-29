const produtosService = require('../services/produtosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarProdutoSchema, atualizarProdutoSchema, ajustarPrecoSchema } = require('../validations/produtosValidation');

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError('ID inválido', 400);
    }

    return id;
}

function parsePaginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;

    return { page, pageSize };
}

function parseCanal(query) {
    return typeof query.canal === 'string' && query.canal.trim() !== '' ? query.canal : 'loja_fisica';
}

function filtrarParaRole(produto, role) {
    if (role !== 'vendedor') return produto;

    const { custo, margem_percentual, preco_canal, ...resto } = produto;

    return {
        ...resto,
        ...(preco_canal && { preco_canal: { canal: preco_canal.canal, preco_venda: preco_canal.preco_venda } })
    };
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);
        const canal = parseCanal(req.query);
        const resultado = await produtosService.listar({ ...paginacao, canal }, req.usuario.empresa_id);

        const items = resultado.items.map((produto) => filtrarParaRole(produto, req.usuario.role));

        return response.success(res, { ...resultado, items });
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const canal = parseCanal(req.query);
        const produto = await produtosService.buscarPorId(id, canal, req.usuario.empresa_id);

        return response.success(res, filtrarParaRole(produto, req.usuario.role));
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarProdutoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const produto = await produtosService.criar(parsed.data, req.usuario.empresa_id);

        return response.success(res, produto, 201);
    } catch (error) {
        next(error);
    }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);

        const parsed = atualizarProdutoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const produto = await produtosService.atualizar(id, parsed.data, req.usuario.empresa_id);

        return response.success(res, produto);
    } catch (error) {
        next(error);
    }
}

async function remover(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const produto = await produtosService.remover(id, req.usuario.empresa_id);

        return response.success(res, produto);
    } catch (error) {
        next(error);
    }
}

async function giro(req, res, next) {
    try {
        const dados = await produtosService.giro(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function parados(req, res, next) {
    try {
        const dados = await produtosService.parados(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function pricingProfissional(req, res, next) {
    try {
        const dados = await produtosService.pricingProfissional(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function lucroPorProduto(req, res, next) {
    try {
        const dados = await produtosService.lucroPorProduto(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function alertaPrejuizo(req, res, next) {
    try {
        const dados = await produtosService.alertaPrejuizo(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function maisVendidos(req, res, next) {
    try {
        const dados = await produtosService.maisVendidos(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function curvaABC(req, res, next) {
    try {
        const dados = await produtosService.curvaABC(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function reposicao(req, res, next) {
    try {
        const dados = await produtosService.reposicao(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function sugestaoPreco(req, res, next) {
    try {
        const dados = await produtosService.sugestaoPreco(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function inteligencia(req, res, next) {
    try {
        const dados = await produtosService.inteligencia(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function acoes(req, res, next) {
    try {
        const dados = await produtosService.acoes(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function ajustarPreco(req, res, next) {
    try {
        const parsed = ajustarPrecoSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { id, percentual } = parsed.data;

        const produto = await produtosService.ajustarPreco(id, percentual, req.usuario.empresa_id);

        return response.success(res, produto);
    } catch (error) {
        next(error);
    }
}

async function dashboard(req, res, next) {
    try {
        const dados = await produtosService.dashboard(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    buscarPorId,
    criar,
    atualizar,
    remover,
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
    ajustarPreco,
    dashboard
};

const produtosService = require('../services/produtosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarProdutoSchema, ajustarPrecoSchema } = require('../validations/produtosValidation');

async function listar(req, res, next) {
    try {
        const produtos = await produtosService.listar();
        return response.success(res, produtos);
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

        const produto = await produtosService.criar(parsed.data);

        return response.success(res, produto, 201);
    } catch (error) {
        next(error);
    }
}

async function giro(req, res, next) {
    try {
        const dados = await produtosService.giro();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function parados(req, res, next) {
    try {
        const dados = await produtosService.parados();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function pricingProfissional(req, res, next) {
    try {
        const dados = await produtosService.pricingProfissional();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function lucroPorProduto(req, res, next) {
    try {
        const dados = await produtosService.lucroPorProduto();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function alertaPrejuizo(req, res, next) {
    try {
        const dados = await produtosService.alertaPrejuizo();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function maisVendidos(req, res, next) {
    try {
        const dados = await produtosService.maisVendidos();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function curvaABC(req, res, next) {
    try {
        const dados = await produtosService.curvaABC();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function reposicao(req, res, next) {
    try {
        const dados = await produtosService.reposicao();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function sugestaoPreco(req, res, next) {
    try {
        const dados = await produtosService.sugestaoPreco();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function inteligencia(req, res, next) {
    try {
        const dados = await produtosService.inteligencia();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function acoes(req, res, next) {
    try {
        const dados = await produtosService.acoes();
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

        const produto = await produtosService.ajustarPreco(id, percentual);

        return response.success(res, produto);
    } catch (error) {
        next(error);
    }
}

async function dashboard(req, res, next) {
    try {
        const dados = await produtosService.dashboard();
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

module.exports = {
    listar,
    criar,
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

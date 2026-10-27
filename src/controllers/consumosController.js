const consumosService = require('../services/consumosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { podeVerCustos } = require('../services/permissoesService');
const {
    consumoAvulsoSchema, acrescentarNaVendaSchema, substituicaoSchema, previaSubstituicaoQuerySchema, filtrosPeriodoQuerySchema
} = require('../validations/consumosValidation');

function parseId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);
    return id;
}

function parseCorpo(schema, dados) {
    const parsed = schema.safeParse(dados);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    return parsed.data;
}

function parsePaginacao(query) {
    let page = parseInt(query.page, 10);
    let pageSize = parseInt(query.pageSize, 10);
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 20;
    if (pageSize > 100) pageSize = 100;
    return { page, pageSize };
}

// Quem não tem a capacidade `ver_custos` recebe tudo, menos valores (mesma regra da ficha de venda).
function semCusto(objeto, campos) {
    const copia = { ...objeto };
    for (const campo of campos) delete copia[campo];
    return copia;
}
const filtrarCusto = (usuario, objeto, campos) => (podeVerCustos(usuario) ? objeto : semCusto(objeto, campos));

const envolver = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (error) {
        next(error);
    }
};

const listarInsumos = envolver(async (req, res) => {
    const insumos = await consumosService.listarInsumos(req.usuario.empresa_id);
    return response.success(res, insumos.map((i) => filtrarCusto(req.usuario, i, ['custo'])));
});

const registrarAvulso = envolver(async (req, res) => {
    const dados = parseCorpo(consumoAvulsoSchema, req.body);
    const consumo = await consumosService.registrarAvulso(dados, req.usuario.id, req.usuario.empresa_id);
    return response.success(res, filtrarCusto(req.usuario, consumo, ['custo_unitario']), 201);
});

const listarAvulsos = envolver(async (req, res) => {
    const filtros = parseCorpo(filtrosPeriodoQuerySchema, req.query);
    const resultado = await consumosService.listarAvulsos(filtros, parsePaginacao(req.query), req.usuario.empresa_id);
    return response.success(res, {
        ...resultado,
        items: resultado.items.map((i) => filtrarCusto(req.usuario, i, ['custo_unitario']))
    });
});

const linhasDaVenda = envolver(async (req, res) => {
    const { venda, linhas } = await consumosService.linhasDaVenda(parseId(req.params.vendaId), req.usuario.empresa_id);
    return response.success(res, {
        venda: { id: venda.id, status: venda.status, data: venda.data },
        linhas: linhas.map((l) => filtrarCusto(req.usuario, l, ['custo_unitario']))
    });
});

const acrescentarNaVenda = envolver(async (req, res) => {
    const dados = parseCorpo(acrescentarNaVendaSchema, req.body);
    const { linha, pendencias } = await consumosService.acrescentarNaVenda(
        parseId(req.params.vendaId), dados, req.usuario.id, req.usuario.empresa_id
    );
    return response.success(res, { linha: filtrarCusto(req.usuario, linha, ['custo_unitario']), pendencias }, 201);
});

const retirarLinha = envolver(async (req, res) => {
    const linha = await consumosService.retirarLinha(
        parseId(req.params.vendaId), parseId(req.params.consumoId), req.usuario.id, req.usuario.empresa_id
    );
    return response.success(res, filtrarCusto(req.usuario, linha, ['custo_unitario']));
});

const regularizarLinha = envolver(async (req, res) => {
    const linha = await consumosService.regularizarLinha(
        parseId(req.params.vendaId), parseId(req.params.consumoId), req.usuario.id, req.usuario.empresa_id
    );
    return response.success(res, filtrarCusto(req.usuario, linha, ['custo_unitario']));
});

const previaSubstituicao = envolver(async (req, res) => {
    const { de_insumo_id } = parseCorpo(previaSubstituicaoQuerySchema, req.query);
    return response.success(res, await consumosService.previaSubstituicao(de_insumo_id, req.usuario.empresa_id));
});

const substituirInsumo = envolver(async (req, res) => {
    const dados = parseCorpo(substituicaoSchema, req.body);
    return response.success(res, await consumosService.substituirInsumo(dados, req.usuario.id, req.usuario.empresa_id));
});

const relatorio = envolver(async (req, res) => {
    const filtros = parseCorpo(filtrosPeriodoQuerySchema, req.query);
    const resultado = await consumosService.relatorio(filtros, req.usuario.empresa_id);

    if (podeVerCustos(req.usuario)) return response.success(res, resultado);

    return response.success(res, {
        itens: resultado.itens.map((i) => semCusto(i, ['custo_total'])),
        totais: { por_motivo: resultado.totais.por_motivo.map((m) => semCusto(m, ['custo_total'])) }
    });
});

module.exports = {
    listarInsumos, registrarAvulso, listarAvulsos, linhasDaVenda, acrescentarNaVenda, retirarLinha,
    regularizarLinha, previaSubstituicao, substituirInsumo, relatorio
};

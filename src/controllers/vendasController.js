const vendasService = require('../services/vendasService');
const cancelamentosService = require('../services/cancelamentosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { criarVendaSchema } = require('../validations/vendasValidation');
const { cancelarVendaSchema } = require('../validations/cancelamentosValidation');
const { listarVendasSchema } = require('../validations/listarVendasValidation');
const { podeVerCustosOperacionais, podeVerCustos, podeVerVendasDeTodos, temCapacidade } = require('../services/permissoesService');
const resultadoVendasService = require('../services/resultadoVendasService');
const { resultadoPeriodoSchema } = require('../validations/resultadoVendasValidation');
const { CAPACIDADES } = require('../constants/cargos');
const { escopoDeClientes } = require('../services/clientesService');

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

// custo_unitario é dado de custo — vendedor nunca vê, mesmo padrão de
// produtosController.filtrarParaRole. venda.itens pode não existir
// (listagem paginada hoje não inclui itens), por isso o guard.
function filtrarParaRole(venda, usuario) {
    if (podeVerCustosOperacionais(usuario) || !Array.isArray(venda.itens)) return venda;

    return {
        ...venda,
        itens: venda.itens.map(({ custo_unitario, ...resto }) => resto)
    };
}

async function resumo(req, res, next) {
    try {
        const dados = await vendasService.resumo(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function porDia(req, res, next) {
    try {
        const dados = await vendasService.porDia(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function porMes(req, res, next) {
    try {
        const dados = await vendasService.porMes(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function maisVendidos(req, res, next) {
    try {
        const dados = await vendasService.maisVendidos(req.usuario.empresa_id);
        return response.success(res, dados);
    } catch (error) {
        next(error);
    }
}

async function criar(req, res, next) {
    try {
        const parsed = criarVendaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const idempotencyKey = req.get('Idempotency-Key')?.trim() || null;
        if (idempotencyKey && idempotencyKey.length > 200) {
            throw new AppError('Idempotency-Key excede 200 caracteres', 400);
        }

        // Sem `ver_todos_clientes`, o cliente da venda precisa ser um que o próprio usuário cadastrou.
        const venda = await vendasService.criar(
            parsed.data,
            req.usuario.id,
            req.usuario.empresa_id,
            idempotencyKey,
            escopoDeClientes(req.usuario),
            // Pix/link de cartão cobrado por outro usuário: só admin e quem gere o financeiro usam na venda de outra pessoa.
            {
                podeUsarCobrancaDeOutros: temCapacidade(req.usuario, CAPACIDADES.GERIR_FINANCEIRO),
                // Funcionalidade `caixa` ligada: a venda exige o caixa do vendedor aberto (vem do plano resolvido, nunca do cliente).
                caixaLigado: Array.isArray(req.usuario.funcionalidades) && req.usuario.funcionalidades.includes('caixa')
            }
        );

        return response.success(res, filtrarParaRole(venda, req.usuario), 201);
    } catch (error) {
        next(error);
    }
}

async function listar(req, res, next) {
    try {
        const paginacao = parsePaginacao(req.query);
        const parsedFiltros = listarVendasSchema.safeParse({
            status: req.query.status,
            canal: req.query.canal,
            data_de: req.query.data_de,
            data_ate: req.query.data_ate
        });

        if (!parsedFiltros.success) {
            throw new AppError(parsedFiltros.error.issues[0].message, 400);
        }

        const resultado = await vendasService.listar({
            ...paginacao,
            ...parsedFiltros.data
        }, req.usuario);
        let items = resultado.items.map((venda) => filtrarParaRole(venda, req.usuario));

        // Lucro (receita, custo, bruto, líquido e %) só para quem tem `ver_custos`: vendedor nunca recebe.
        if (podeVerCustos(req.usuario)) {
            const resultados = await resultadoVendasService.resultadoDasVendas(items, req.usuario.empresa_id);

            items = items.map((venda) => ({ ...venda, resultado: resultados.get(venda.id) ?? null }));
        }

        return response.success(res, { ...resultado, items });
    } catch (error) {
        next(error);
    }
}

async function buscarPorId(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const venda = await vendasService.buscarPorId(id, req.usuario);
        const filtrada = filtrarParaRole(venda, req.usuario);

        if (!podeVerCustos(req.usuario)) return response.success(res, filtrada);

        const resultados = await resultadoVendasService.resultadoDasVendas([filtrada], req.usuario.empresa_id);

        return response.success(res, { ...filtrada, resultado: resultados.get(filtrada.id) ?? null });
    } catch (error) {
        next(error);
    }
}

// Resultado do período (e, opcionalmente, por dia ou por mês). Exige `ver_custos` (na rota) e enxergar as
// vendas de todos: o total de uma empresa não pode ser montado por quem só vê as próprias vendas.
async function resultado(req, res, next) {
    try {
        if (!podeVerVendasDeTodos(req.usuario)) {
            throw new AppError('Acesso negado: sem permissão para ver o resultado de todas as vendas', 403);
        }

        const parsed = resultadoPeriodoSchema.safeParse({
            data_de: req.query.data_de,
            data_ate: req.query.data_ate,
            agrupar: req.query.agrupar
        });

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        return response.success(res, await resultadoVendasService.resultadoPeriodo(parsed.data, req.usuario));
    } catch (error) {
        next(error);
    }
}

async function cancelar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const parsed = cancelarVendaSchema.safeParse(req.body ?? {});

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const venda = await cancelamentosService.cancelar(id, req.usuario, parsed.data);

        return response.success(res, venda);
    } catch (error) {
        next(error);
    }
}

async function previaCancelamento(req, res, next) {
    try {
        const id = parseId(req.params.id);

        return response.success(res, await cancelamentosService.previa(id, req.usuario));
    } catch (error) {
        next(error);
    }
}

module.exports = {
    resumo,
    porDia,
    porMes,
    maisVendidos,
    criar,
    listar,
    buscarPorId,
    resultado,
    cancelar,
    previaCancelamento
};

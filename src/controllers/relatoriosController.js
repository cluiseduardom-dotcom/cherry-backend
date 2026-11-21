const AppError = require('../errors/AppError');
const response = require('../utils/response');
const relatoriosService = require('../services/relatoriosService');
const { periodoSchema, produtosSchema, inventarioSchema, creditoSchema } = require('../validations/relatoriosValidation');

function validar(schema, entrada) {
    const parsed = schema.safeParse(entrada);

    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);

    return parsed.data;
}

const periodoDaQuery = (query) => ({ data_de: query.data_de, data_ate: query.data_ate });

function handler(schema, entrada, servico) {
    return async (req, res, next) => {
        try {
            const filtros = validar(schema, entrada(req.query));

            return response.success(res, await servico(filtros, req.usuario));
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = {
    vendas: handler(periodoSchema, periodoDaQuery, relatoriosService.vendas),
    desempenho: handler(periodoSchema, periodoDaQuery, relatoriosService.desempenho),
    produtos: handler(produtosSchema, (q) => ({ ...periodoDaQuery(q), ordem: q.ordem, limite: q.limite }), relatoriosService.produtos),
    inventario: handler(
        inventarioSchema,
        (q) => ({ local_id: q.local_id, tipo: q.tipo, somente_com_saldo: q.somente_com_saldo, page: q.page, pageSize: q.pageSize }),
        relatoriosService.inventario
    ),
    credito: handler(creditoSchema, (q) => ({ data_ref: q.data_ref }), relatoriosService.credito)
};

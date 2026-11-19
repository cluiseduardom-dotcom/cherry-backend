const repository = require('../repositories/cobrancaEmpresaRepository');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const {
    empresaIdParamSchema, iniciarTesteSchema, pagamentoCobrancaSchema, acaoCobrancaSchema
} = require('../validations/plataformaValidation');

function validar(schema, dados) {
    const parsed = schema.safeParse(dados);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

// Quem fez a mudança: sempre o operador autenticado do painel (nunca o corpo da requisição).
const quem = (req) => ({ responsavel: req.responsavelPlataforma, operador_id: req.operador.id, ip: req.ip });

// Cada ação muda estado da empresa: nada de cache. A empresa-alvo vem da rota (exceção deliberada do painel).
function acao(schema, executar, status = 200) {
    return async (req, res, next) => {
        try {
            const { id } = validar(empresaIdParamSchema, req.params);
            const corpo = validar(schema, req.body ?? {});

            res.set('Cache-Control', 'no-store');
            return response.success(res, await executar({ empresa_id: id, ...corpo, ...quem(req) }), status);
        } catch (error) {
            next(error);
        }
    };
}

async function obter(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.obter(id));
    } catch (error) {
        next(error);
    }
}

module.exports = {
    obter,
    iniciarTeste: acao(iniciarTesteSchema, repository.iniciarTeste, 201),
    registrarPagamento: acao(pagamentoCobrancaSchema, repository.registrarPagamento),
    definirIsencao: acao(acaoCobrancaSchema, repository.definirIsencao),
    removerIsencao: acao(acaoCobrancaSchema, repository.removerIsencao),
    desligar: acao(acaoCobrancaSchema, repository.desligar),
    religar: acao(acaoCobrancaSchema, repository.religar)
};

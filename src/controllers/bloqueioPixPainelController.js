const repository = require('../repositories/bloqueiosPixRepository');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { empresaIdParamSchema, pixManualAcaoSchema } = require('../validations/plataformaValidation');

// Sinalização e liberação do Pix manual de uma empresa (T7). Só operador do painel (requirePainel na rota); a empresa-alvo
// vem da rota; o responsável é sempre o operador da sessão (nunca o corpo); a trilha é gravada pelo repository.

function validar(schema, dados) {
    const parsed = schema.safeParse(dados);

    if (!parsed.success) {
        throw new AppError(parsed.error.issues[0].message, 400);
    }

    return parsed.data;
}

const quem = (req) => ({ responsavel: req.responsavelPlataforma, operador_id: req.operador.id, ip: req.ip });

async function bloquear(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const { justificativa } = validar(pixManualAcaoSchema, req.body ?? {});

        return response.success(res, await repository.bloquearPixManual({ empresa_id: id, justificativa, ...quem(req) }), 201);
    } catch (error) {
        next(error);
    }
}

async function liberar(req, res, next) {
    try {
        const { id } = validar(empresaIdParamSchema, req.params);
        const { justificativa } = validar(pixManualAcaoSchema, req.body ?? {});

        return response.success(res, await repository.liberarPixManual({ empresa_id: id, justificativa, ...quem(req) }));
    } catch (error) {
        next(error);
    }
}

module.exports = { bloquear, liberar };

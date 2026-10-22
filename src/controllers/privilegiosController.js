const privilegiosService = require('../services/privilegiosService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const {
    confirmacaoSchema, usuarioIdSchema, cargoSchema, historicoQuerySchema
} = require('../validations/privilegiosValidation');

function ler(schema, valor) {
    const resultado = schema.safeParse(valor);

    if (!resultado.success) {
        throw new AppError(resultado.error.issues[0].message, 400);
    }

    return resultado.data;
}

// O ator (empresa_id, id, cargo, perfil) vem SEMPRE do token (req.usuario); o corpo só leva senha e motivo.
const acao = (servico, lerAlvo) => async (req, res, next) => {
    try {
        const alvo = lerAlvo(req.params);
        const confirmacao = ler(confirmacaoSchema, req.body);

        return response.success(res, await servico(req.usuario, alvo, confirmacao));
    } catch (error) {
        next(error);
    }
};

const alvoUsuario = (params) => ler(usuarioIdSchema, params.usuarioId);
const alvoCargo = (params) => ler(cargoSchema, params.cargo);

const concederAUsuario = acao((...args) => privilegiosService.concederAUsuario(...args), alvoUsuario);
const revogarDeUsuario = acao((...args) => privilegiosService.revogarDeUsuario(...args), alvoUsuario);
const concederACargo = acao((...args) => privilegiosService.concederACargo(...args), alvoCargo);
const revogarDeCargo = acao((...args) => privilegiosService.revogarDeCargo(...args), alvoCargo);

async function listarAdministradores(req, res, next) {
    try {
        return response.success(res, await privilegiosService.listarAdministradores(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function listarUsuarios(req, res, next) {
    try {
        return response.success(res, await privilegiosService.listarUsuarios(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function historico(req, res, next) {
    try {
        const filtros = ler(historicoQuerySchema, req.query);

        return response.success(res, await privilegiosService.historico(req.usuario.empresa_id, filtros));
    } catch (error) {
        next(error);
    }
}

module.exports = {
    concederAUsuario, revogarDeUsuario, concederACargo, revogarDeCargo,
    listarAdministradores, listarUsuarios, historico
};

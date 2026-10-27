const authService = require('../services/authService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { loginSchema, registerSchema, alterarSenhaSchema } = require('../validations/authValidation');

async function login(req, res, next) {

    try {

        const parsed = loginSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { email, senha } = parsed.data;

        const resultado = await authService.login(email, senha);

        return response.success(res, resultado);

    } catch (error) {

        next(error);

    }

}

// Quem sou eu agora, segundo o banco (cargo, nível e capacidades vigentes), para o frontend
// mostrar ou esconder o que o usuário pode fazer. A decisão final continua no servidor.
async function me(req, res, next) {

    try {

        const { id, empresa_id, role, cargo, nivel, capacidades, senha_temporaria, plataforma_admin } = req.usuario;

        return response.success(res, { id, empresa_id, perfil: role, cargo, nivel, capacidades, senha_temporaria: senha_temporaria === true, plataforma_admin: plataforma_admin === true });

    } catch (error) {

        next(error);

    }

}

async function register(req, res, next) {

    try {

        const parsed = registerSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { nome, email, senha, papel } = parsed.data;

        const resultado = await authService.register(nome, email, senha, papel, req.usuario.empresa_id);

        return response.success(res, resultado, 201);

    } catch (error) {

        next(error);

    }

}

async function alterarSenha(req, res, next) {

    try {

        const parsed = alterarSenhaSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { senha_atual, nova_senha } = parsed.data;

        const resultado = await authService.alterarPropriaSenha(req.usuario, senha_atual, nova_senha);

        return response.success(res, resultado);

    } catch (error) {

        next(error);

    }

}

module.exports = {
    login,
    register,
    me,
    alterarSenha
};

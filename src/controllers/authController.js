const authService = require('../services/authService');
const usuarioFotosService = require('../services/usuarioFotosService');
const usuariosFotosRepository = require('../repositories/usuariosFotosRepository');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { loginSchema, registerSchema, alterarSenhaSchema } = require('../validations/authValidation');

async function login(req, res, next) {

    try {

        const parsed = loginSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        const { identificador, senha, empresa_slug } = parsed.data;

        const resultado = await authService.login(identificador, senha, empresa_slug);

        return response.success(res, resultado);

    } catch (error) {

        next(error);

    }

}

// Quem sou eu agora, segundo o banco (cargo, nível e capacidades vigentes), para o frontend
// mostrar ou esconder o que o usuário pode fazer. A decisão final continua no servidor.
async function me(req, res, next) {

    try {

        const { id, empresa_id, role, cargo, nivel, capacidades, funcionalidades, senha_temporaria } = req.usuario;
        const foto_url = usuarioFotosService.urlDaChave(await usuariosFotosRepository.buscarChave(id, empresa_id));

        // `funcionalidades`: o que o plano da empresa liga (só para o frontend esconder menus; o servidor barra de fato).
        return response.success(res, { id, empresa_id, perfil: role, cargo, nivel, capacidades, funcionalidades: funcionalidades ?? [], senha_temporaria: senha_temporaria === true, foto_url });

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

async function renovar(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');

        return response.success(res, authService.renovarSessao(req.usuario, req.sessao));
    } catch (error) {
        next(error);
    }
}

module.exports = {
    login,
    register,
    me,
    alterarSenha,
    renovar
};

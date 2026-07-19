const authService = require('../services/authService');
const response = require('../utils/response');
const AppError = require('../errors/AppError');
const { loginSchema } = require('../validations/authValidation');

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

module.exports = {
    login
};

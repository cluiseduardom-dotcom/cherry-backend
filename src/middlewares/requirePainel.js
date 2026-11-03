const AppError = require('../errors/AppError');
const painelAuthService = require('../services/painelAuthService');

// Sessão do Painel GiroNex (token próprio, nunca o do ERP). Põe o operador em req.operador e o texto de
// responsável que as ações de plataforma gravam. Com senha temporária só passa o que for `permitirTemporaria`.
function requirePainel({ permitirTemporaria = false } = {}) {
    return async (req, res, next) => {
        try {
            const auth = req.headers.authorization;
            if (!auth || !auth.startsWith('Bearer ')) throw new AppError('Sessão do painel não informada', 401);

            const op = await painelAuthService.operadorDaSessao(auth.slice(7));
            if (op.senha_temporaria && !permitirTemporaria) throw new AppError('Troque a senha temporária para continuar', 403);

            req.operador = op;
            req.responsavelPlataforma = `painel:${op.email} (#${op.id})`;
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = requirePainel;

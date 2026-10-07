const AppError = require('../errors/AppError');
const tokenService = require('../services/tokenService');
const sessaoRepository = require('../repositories/sessaoRepository');

const MENSAGEM_TOKEN_INVALIDO = 'Token inválido ou expirado';

module.exports = async (req, res, next) => {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new AppError('Token não informado', 401));
    }

    const token = authHeader.split(' ')[1];

    let payload;

    try {
        payload = tokenService.verificarToken(token);
    } catch (error) {
        return next(new AppError(MENSAGEM_TOKEN_INVALIDO, 401));
    }

    try {
        // Assinatura válida não basta: o acesso pode ter sido revogado depois
        // da emissão (usuário/empresa desativados ou token_version avançada).
        const estado = await sessaoRepository.buscarEstado(payload.id, payload.empresa_id);

        const revogado = !estado
            || estado.ativo === false
            || estado.empresa_status !== 'ativa'
            || estado.token_version !== (payload.tv ?? 0);

        if (revogado) {
            return next(new AppError(MENSAGEM_TOKEN_INVALIDO, 401));
        }

        req.usuario = { id: payload.id, role: payload.role, empresa_id: payload.empresa_id };

        return next();
    } catch (error) {
        // Falha ao consultar o estado da sessão: nega (fail-closed) e deixa o
        // errorHandler responder 500 genérico.
        return next(error);
    }

};

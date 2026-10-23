const AppError = require('../errors/AppError');
const { MODULOS } = require('../constants/modulos');
const moduloRepository = require('../repositories/moduloRepository');

// Barra a rota quando o módulo não está ativo para a empresa do JWT. Deve vir DEPOIS do
// authMiddleware. Falha fechada: sem usuário/empresa, módulo desligado ou erro de consulta
// nunca liberam a rota. O frontend esconde menus, mas esta é a fronteira de segurança.
module.exports = (modulo) => {
    // Erro de programação detectado na montagem da rota, não em produção.
    if (!MODULOS.includes(modulo)) {
        throw new Error(`Módulo desconhecido: ${modulo}`);
    }

    return async (req, res, next) => {
        const empresa_id = req.usuario && req.usuario.empresa_id;

        if (!empresa_id) {
            return next(new AppError('Acesso negado', 403));
        }

        try {
            const ativo = await moduloRepository.estaAtivo(empresa_id, modulo);

            if (!ativo) {
                return next(new AppError('Módulo não habilitado para esta empresa', 403));
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
};

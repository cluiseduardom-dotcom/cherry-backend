const AppError = require('../errors/AppError');
const { CODIGOS_FUNCIONALIDADES } = require('../constants/funcionalidades');

const MENSAGEM = 'Funcionalidade não incluída no seu plano. Fale com a GiroNex.';

// Barra a rota quando a funcionalidade não está ligada para a empresa do JWT. Deve vir DEPOIS do
// authMiddleware, que traz a lista já resolvida (plano + ligações avulsas - desligamentos) na mesma
// consulta da sessão, sem ida extra ao banco. Falha fechada: sem usuário, sem lista ou funcionalidade
// ausente nunca liberam a rota, nem para admin. O frontend esconde menus, mas esta é a fronteira de segurança.
module.exports = (funcionalidade) => {
    // Erro de programação detectado na montagem da rota, não em produção.
    if (!CODIGOS_FUNCIONALIDADES.includes(funcionalidade)) {
        throw new Error(`Funcionalidade desconhecida: ${funcionalidade}`);
    }

    return (req, res, next) => {
        const ligadas = req.usuario && req.usuario.funcionalidades;

        if (!Array.isArray(ligadas) || !ligadas.includes(funcionalidade)) {
            return next(new AppError(MENSAGEM, 403));
        }

        return next();
    };
};

module.exports.MENSAGEM = MENSAGEM;

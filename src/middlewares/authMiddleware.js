const AppError = require('../errors/AppError');
const tokenService = require('../services/tokenService');
const sessaoRepository = require('../repositories/sessaoRepository');
const { resolverCargo, aplicarConcessoes } = require('../services/permissoesService');

const MENSAGEM_TOKEN_INVALIDO = 'Token inválido ou expirado';

// Com senha temporária (definida por um admin) só dá para ver quem sou e trocar a senha.
const ROTAS_COM_SENHA_TEMPORARIA = ['/auth/me', '/auth/senha'];

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

        if (estado.senha_temporaria === true) {
            const rota = (req.originalUrl || '').split('?')[0];

            if (!ROTAS_COM_SENHA_TEMPORARIA.includes(rota)) {
                return next(new AppError('Troque a senha temporária para continuar', 403));
            }
        }

        // O cargo vem do banco (estado.papel); o do JWT só vale quando a consulta não o devolve.
        const cargo = estado.papel ?? payload.role;
        const linha = estado.cargo_configurado
            ? { nivel: estado.cargo_nivel, ativo: estado.cargo_ativo, capacidades: estado.cargo_capacidades }
            : null;
        const base = resolverCargo(cargo, linha);

        // Cargo desconhecido ou desligado no comércio: nega (fail-closed).
        if (!base) {
            return next(new AppError(MENSAGEM_TOKEN_INVALIDO, 401));
        }

        if (!base.ativo) {
            return next(new AppError('Cargo desabilitado neste comércio', 403));
        }

        // Admin concedido individualmente soma-se ao cargo (vale já na próxima requisição).
        const permissoes = aplicarConcessoes(base, { administrador_concedido: estado.administrador_concedido === true });

        req.usuario = {
            id: payload.id,
            // Login (e-mail) vindo do banco; vai para o registro de cancelamento de venda.
            email: estado.email,
            // Perfil com que rotas e filtros já existentes enxergam o usuário (admin | vendedor | estoquista | faturista).
            role: permissoes.role,
            cargo: permissoes.cargo,
            nivel: permissoes.nivel,
            capacidades: permissoes.capacidades,
            empresa_id: payload.empresa_id,
            senha_temporaria: estado.senha_temporaria === true,
            // Operador da plataforma (leitura entre empresas em /plataforma). Vem do banco, nunca do token.
            plataforma_admin: estado.plataforma_admin === true
        };

        return next();
    } catch (error) {
        // Falha ao consultar o estado da sessão: nega (fail-closed) e deixa o
        // errorHandler responder 500 genérico.
        return next(error);
    }

};

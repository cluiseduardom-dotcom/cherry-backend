const AppError = require('../errors/AppError');
const tokenService = require('../services/tokenService');
const sessaoRepository = require('../repositories/sessaoRepository');
const { resolverCargo, aplicarConcessoes } = require('../services/permissoesService');

const MENSAGEM_TOKEN_INVALIDO = 'Token inválido ou expirado';

// Com senha temporária (definida por um admin) só dá para ver quem sou e trocar a senha.
const ROTAS_COM_SENHA_TEMPORARIA = ['/auth/me', '/auth/senha'];

// Somente leitura (teste grátis e pagamento vencidos): consulta e exporta, não grava. Só a sessão continua viva:
// renovar o token e trocar a própria senha. Webhooks do Mercado Pago não passam por aqui (não têm sessão de loja).
const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);
const ROTAS_LIBERADAS_SOMENTE_LEITURA = ['/auth/renovar', '/auth/senha'];
const MENSAGEM_SOMENTE_LEITURA = 'O período de uso terminou: a conta está somente para consulta. Fale com a GiroNex para ativar o plano.';

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

        if (estado.cobranca_situacao === 'somente_leitura' && !METODOS_DE_LEITURA.has(req.method)) {
            const rota = (req.originalUrl || '').split('?')[0];

            if (!ROTAS_LIBERADAS_SOMENTE_LEITURA.includes(rota)) {
                return next(new AppError(MENSAGEM_SOMENTE_LEITURA, 403));
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

        // Dados da sessão atual (só leitura): início assinado no token e o estado que a renovação reaproveita.
        req.sessao = { inicio: payload.sa ?? payload.iat, token_version: estado.token_version, papel: estado.papel ?? payload.role };

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
            // Códigos ligados para a empresa (plano + avulsas - desligadas); lido por exigirFuncionalidade.
            funcionalidades: Array.isArray(estado.funcionalidades) ? estado.funcionalidades : [],
            senha_temporaria: estado.senha_temporaria === true,
            // Cobrança da empresa (só para o frontend avisar; o servidor barra de fato, acima). null = sem regra.
            cobranca: estado.cobranca_situacao ? { situacao: estado.cobranca_situacao, ate: estado.cobranca_ate ?? null } : null
        };

        return next();
    } catch (error) {
        // Falha ao consultar o estado da sessão: nega (fail-closed) e deixa o
        // errorHandler responder 500 genérico.
        return next(error);
    }

};

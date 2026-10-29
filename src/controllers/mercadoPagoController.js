const AppError = require('../errors/AppError');
const response = require('../utils/response');
const mercadoPagoService = require('../services/mercadoPagoService');
const cobrancasService = require('../services/cobrancasPagamentoService');
const { obterConfigMercadoPago } = require('../config/mercadoPagoConfig');
const { assinaturaValida } = require('../utils/mercadoPagoAssinatura');
const { criarPixSchema, codigoCobrancaSchema } = require('../validations/mercadoPagoValidation');

async function status(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await mercadoPagoService.obterStatus(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function disponibilidade(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await mercadoPagoService.obterDisponibilidade(req.usuario.empresa_id));
    } catch (error) {
        next(error);
    }
}

async function conectar(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, await mercadoPagoService.iniciarConexao(req.usuario.empresa_id, req.usuario.id));
    } catch (error) {
        next(error);
    }
}

async function desconectar(req, res, next) {
    try {
        const desconectou = await mercadoPagoService.desconectar(req.usuario.empresa_id);
        return response.success(res, { desconectado: desconectou });
    } catch (error) {
        next(error);
    }
}

// Retorno do OAuth: chega do navegador, sem JWT. Sempre termina em redirecionamento ao frontend,
// sem expor detalhe do erro na URL.
async function callback(req, res, next) {
    const config = obterConfigMercadoPago();

    if (!config) {
        return next(new AppError('A integração com o Mercado Pago não está configurada neste ambiente.', 503));
    }

    const destino = (resultado) => `${config.frontendUrl}/configuracoes/empresa?mercadopago=${resultado}`;

    if (req.query.error) {
        return res.redirect(302, destino('erro'));
    }

    try {
        await mercadoPagoService.concluirConexao({ code: req.query.code, state: req.query.state });
        return res.redirect(302, destino('conectado'));
    } catch (error) {
        if (!error.isOperational) {
            console.error('Mercado Pago: erro inesperado no retorno do OAuth', error.message);
        }

        return res.redirect(302, destino('erro'));
    }
}

async function criarPix(req, res, next) {
    try {
        const parsed = criarPixSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new AppError(parsed.error.issues[0].message, 400);
        }

        res.set('Cache-Control', 'no-store');

        return response.success(res, await cobrancasService.criarPix(
            { empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id },
            parsed.data
        ), 201);
    } catch (error) {
        next(error);
    }
}

async function consultarCobranca(req, res, next) {
    try {
        const codigo = codigoCobrancaSchema.safeParse(req.params.codigo);

        if (!codigo.success) {
            throw new AppError('Cobrança não encontrada', 404);
        }

        res.set('Cache-Control', 'no-store');

        return response.success(res, await cobrancasService.consultar(req.usuario.empresa_id, codigo.data));
    } catch (error) {
        next(error);
    }
}

// Webhook do Mercado Pago. Público, protegido pela assinatura. Só aciona uma consulta à API do
// provedor: nada do corpo recebido é gravado.
async function webhook(req, res, next) {
    try {
        const config = obterConfigMercadoPago();

        if (!config) {
            return next(new AppError('Integração não configurada', 503));
        }

        const dataId = req.query['data.id'] ?? req.query.data_id ?? req.body?.data?.id;

        const valida = assinaturaValida({
            xSignature: req.get('x-signature'),
            xRequestId: req.get('x-request-id'),
            dataId,
            segredo: config.webhookSecret
        });

        if (!valida) {
            return res.status(401).json({ success: false, message: 'Assinatura inválida' });
        }

        const tipo = req.query.type ?? req.body?.type;

        if (tipo === 'payment' && dataId) {
            await cobrancasService.processarNotificacao(dataId);
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        next(error);
    }
}

module.exports = { status, disponibilidade, conectar, desconectar, callback, criarPix, consultarCobranca, webhook };

const AppError = require('../errors/AppError');
const cobrancasService = require('./cobrancasPagamentoService');
const pedidosRepository = require('../repositories/lojaPedidosRepository');
const { obterConfigMercadoPago } = require('../config/mercadoPagoConfig');

// Pagamento do pedido da loja online (Pix ou link de cartão do Mercado Pago). A cliente NUNCA aprova pagamento: este
// serviço só cria a cobrança e devolve o QR ou o link. Quem marca o pedido como pago é o webhook validado do
// Mercado Pago (que reconsulta o provedor), em cobrancasPagamentoService.aposSincronizar.
//
// Regras do PDV valem aqui: a taxa da plataforma incide só sobre o Pix (a cobrança de cartão leva 0, decisão do PO).

// Endereço público da loja (https obrigatório no Mercado Pago). Sem ele, o link de cartão não devolve a cliente à loja.
function urlsDeRetorno(codigoPedido, env = process.env) {
    const base = String(env.LOJA_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');

    if (!/^https:\/\/[^\s/]+/.test(base)) return null;

    const url = (resultado) => `${base}/pedido/${codigoPedido}?pagamento=${resultado}`;

    return { sucesso: url('sucesso'), pendente: url('pendente'), falha: url('falha') };
}

// Só o necessário para a cliente pagar. Nunca traz taxa, id do provedor, código interno da cobrança nem dado do pagador.
function paraCliente(resposta, metodo) {
    const base = {
        metodo,
        status: resposta.status,
        valor: Number(resposta.valor),
        expira_em: resposta.expira_em ?? null,
        expira_em_segundos: resposta.expira_em_segundos ?? null
    };

    return metodo === 'cartao'
        ? { ...base, link_url: resposta.link_url, parcelas_maximas: resposta.parcelas_maximas }
        : { ...base, qr_code: resposta.qr_code, qr_code_base64: resposta.qr_code_base64 };
}

// Devolve { pagamento, criado }. Idempotente: pedir de novo com a cobrança em aberto devolve a MESMA cobrança.
async function iniciarPagamento({ empresa_id, codigoPedido, metodo }) {
    const preparo = await pedidosRepository.prepararPagamento({ empresa_id, codigo: codigoPedido, metodo });

    if (preparo.acao === 'reutilizar') {
        return { pagamento: paraCliente(await cobrancasService.consultar(empresa_id, preparo.cobrancaCodigo), metodo), criado: false };
    }

    const { pedido, cobrancaCodigo } = preparo;
    const usuario = { empresa_id, usuario_id: null };
    const valor = Number(pedido.total);
    let resposta;

    try {
        resposta = metodo === 'pix'
            ? await cobrancasService.criarPix(usuario, { valor, cliente_email: pedido.cliente_email }, { codigo: cobrancaCodigo, descricao: 'Pedido na loja online' })
            : await cobrancasService.criarLinkCartao(usuario, { valor }, { codigo: cobrancaCodigo, urlsRetorno: urlsDeRetorno(pedido.codigo) });
    } catch (error) {
        await pedidosRepository.liberarPagamentoNaoCriado({ empresa_id, pedido_id: pedido.id, cobrancaCodigo });

        // A mensagem do provedor e a da conexão da loja são para o caixa, não para a cliente: vão ao log.
        console.error(`Loja online: falha ao criar a cobrança do pedido ${pedido.id}: ${error.message}`);
        const indisponivel = new AppError('Não foi possível gerar o pagamento agora. Tente novamente em instantes.', 503);
        indisponivel.codigo = 'PAGAMENTO_INDISPONIVEL';
        throw indisponivel;
    }

    await pedidosRepository.estenderReserva({ empresa_id, pedido_id: pedido.id, cobrancaCodigo, metodo });

    return { pagamento: paraCliente(resposta, metodo), criado: true };
}

// Reconsulta no Mercado Pago os pagamentos pendentes dos pedidos da loja (rotina do cron, a cada minuto). Rede de
// segurança do webhook: se uma notificação se perder, ou nunca chegar, o pedido pago não fica parado.
//
// É a MESMA validação do webhook, só que disparada por nós: `consultar` pergunta ao provedor com o token da loja dona da
// cobrança e confere id, referência e valor; o pedido só vira pago se o provedor disser aprovado e tudo conferir. A
// cliente não participa. No máximo uma consulta a cada 5 s por cobrança. Uma falha numa cobrança não impede as outras.
async function reconciliarPendentes({ limite = 50 } = {}) {
    if (!obterConfigMercadoPago()) return { pulado: true, consultadas: 0, pagos: 0 };

    const pendentes = await pedidosRepository.listarCobrancasParaReconciliar({ limite });
    let pagos = 0;

    for (const { empresa_id, codigo } of pendentes) {
        try {
            const cobranca = await cobrancasService.consultar(empresa_id, codigo);
            if (cobranca.status === 'pago') pagos += 1;
        } catch (error) {
            console.error(`Loja online: falha ao reconsultar a cobrança ${codigo}: ${error.message}`);
        }
    }

    return { pulado: false, consultadas: pendentes.length, pagos };
}

module.exports = { iniciarPagamento, reconciliarPendentes, urlsDeRetorno, paraCliente };

const crypto = require('node:crypto');
const AppError = require('../errors/AppError');
const mercadoPagoClient = require('../integrations/mercadoPagoClient');
const mercadoPagoService = require('./mercadoPagoService');
const cobrancasRepository = require('../repositories/cobrancasPagamentoRepository');
const taxasPlataformaRepository = require('../repositories/taxasPlataformaRepository');
const db = require('../config/db');
const { reaisParaCentavos, calcularTaxaPlataformaCentavos, centavosParaReais } = require('../utils/taxaPlataforma');

// O QR vale 30 minutos (mínimo aceito pelo Mercado Pago): o PDV é um fluxo de balcão.
const VALIDADE_PIX_MS = 30 * 60 * 1000;
// Consulta ao provedor na leitura da cobrança: no máximo uma a cada 5 s por cobrança.
const INTERVALO_CONSULTA_MS = 5000;

// Transições permitidas. pago -> estornado existe; nada volta para pendente.
const TRANSICOES = {
    pendente: ['pago', 'cancelado', 'estornado'],
    pago: ['estornado'],
    cancelado: [],
    estornado: [],
    falhou: []
};

function mapearStatusProvedor(statusMp) {
    switch (statusMp) {
        case 'approved': return 'pago';
        case 'cancelled':
        case 'rejected': return 'cancelado';
        case 'refunded':
        case 'charged_back': return 'estornado';
        case 'pending':
        case 'in_process':
        case 'in_mediation':
        case 'authorized':
        default: return 'pendente';
    }
}

// Brasil não tem horário de verão desde 2019: offset fixo -03:00 no formato aceito pelo provedor.
function formatarExpiracao(data) {
    return new Date(data.getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00');
}

// O que o PDV pode ver: nunca a taxa da plataforma, nunca ids internos.
function paraResposta(cobranca) {
    const agora = Date.now();
    const alvo = cobranca.expira_em ? new Date(cobranca.expira_em).getTime() : NaN;
    const expirada = cobranca.status === 'pendente' && cobranca.expira_em && alvo < agora;

    return {
        codigo: cobranca.codigo,
        status: cobranca.status,
        valor: cobranca.valor,
        qr_code: cobranca.qr_code,
        qr_code_base64: cobranca.qr_code_base64,
        ticket_url: cobranca.ticket_url,
        expira_em: cobranca.expira_em,
        // Segundos até expirar, pelo relógio do servidor: o PDV conta a partir daqui e não depende
        // do relógio do computador do operador (que pode estar errado).
        expira_em_segundos: Number.isNaN(alvo) ? null : Math.max(0, Math.floor((alvo - agora) / 1000)),
        expirada: Boolean(expirada)
    };
}

async function criarPix({ empresa_id, usuario_id }, { valor, cliente_email }) {
    const config = mercadoPagoService.exigirConfig();
    const valorCentavos = reaisParaCentavos(valor);

    const emailPagador = cliente_email ?? await cobrancasRepository.buscarEmailContatoEmpresa(empresa_id);

    if (!emailPagador) {
        // 400 (e não 409): o PDV só cai no Pix manual com 409 (integração desligada / loja sem Mercado Pago).
        // Cadastro incompleto precisa aparecer ao operador, não ser engolido.
        throw new AppError('Informe o e-mail de contato da empresa em Dados da empresa para gerar o Pix.', 400);
    }

    // Falha cedo (409) se a loja não conectou o Mercado Pago, antes de gravar qualquer cobrança.
    const accessToken = await mercadoPagoService.obterAccessToken(empresa_id);

    // Mesma regra de taxa das vendas (condição individual > plano > padrão), pela empresa do JWT.
    const regra = await taxasPlataformaRepository.resolverRegra(empresa_id, db);
    const taxaCentavos = calcularTaxaPlataformaCentavos(valorCentavos, regra.percentual);

    if (taxaCentavos >= valorCentavos) {
        throw new AppError('Regra de taxa inválida para esta cobrança.', 409);
    }

    const codigo = crypto.randomUUID();
    const cobranca = await cobrancasRepository.criar({
        codigo,
        empresa_id,
        valor: centavosParaReais(valorCentavos),
        taxa_plataforma: centavosParaReais(taxaCentavos),
        criado_por: usuario_id
    });

    const expiraEm = new Date(Date.now() + VALIDADE_PIX_MS);

    let criada;

    try {
        criada = await mercadoPagoClient.criarPagamentoPix(config, {
            accessToken,
            codigo,
            valor: Number(centavosParaReais(valorCentavos)),
            descricao: 'Venda no PDV',
            emailPagador,
            taxaPlataforma: Number(centavosParaReais(taxaCentavos)),
            expiraEm: formatarExpiracao(expiraEm)
        });
    } catch (error) {
        await cobrancasRepository.marcarFalhou(cobranca.id, empresa_id);
        throw error;
    }

    const atualizada = await cobrancasRepository.registrarCriadaNoProvedor({
        id: cobranca.id,
        empresa_id,
        idExterno: criada.idExterno,
        qrCode: criada.qrCode,
        qrCodeBase64: criada.qrCodeBase64,
        ticketUrl: criada.ticketUrl,
        expiraEm,
        status: mapearStatusProvedor(criada.status)
    });

    return paraResposta(atualizada);
}

// Consulta o provedor e aplica a transição. NUNCA confia no corpo do webhook: o estado vem da API,
// com o token da loja dona da cobrança, e é conferido contra o que nós criamos.
async function sincronizar(cobranca) {
    const config = mercadoPagoService.exigirConfig();

    if (!cobranca.id_externo) {
        return cobranca;
    }

    const accessToken = await mercadoPagoService.obterAccessToken(cobranca.empresa_id);
    const pagamento = await mercadoPagoClient.buscarPagamento(config, { accessToken, idExterno: cobranca.id_externo });

    const confere = pagamento
        && String(pagamento.id) === String(cobranca.id_externo)
        && pagamento.external_reference === cobranca.codigo
        && reaisParaCentavos(pagamento.transaction_amount) === reaisParaCentavos(cobranca.valor);

    if (!confere) {
        console.error(`Mercado Pago: pagamento ${cobranca.id_externo} não confere com a cobrança ${cobranca.codigo}; ignorado`);
        await cobrancasRepository.registrarConsulta(cobranca.id, cobranca.empresa_id);
        return cobranca;
    }

    const novo = mapearStatusProvedor(pagamento.status);

    if (novo === cobranca.status || !TRANSICOES[cobranca.status]?.includes(novo)) {
        await cobrancasRepository.registrarConsulta(cobranca.id, cobranca.empresa_id);
        return cobranca;
    }

    const atualizada = await cobrancasRepository.atualizarStatus({
        id: cobranca.id, empresa_id: cobranca.empresa_id, de: cobranca.status, para: novo
    });

    // Se outra notificação ganhou a corrida, a linha já está no estado novo.
    return atualizada ?? await cobrancasRepository.buscarPorCodigo(cobranca.codigo, cobranca.empresa_id);
}

async function consultar(empresa_id, codigo) {
    let cobranca = await cobrancasRepository.buscarPorCodigo(codigo, empresa_id);

    if (!cobranca) {
        throw new AppError('Cobrança não encontrada', 404);
    }

    const vencida = !cobranca.consultado_em || Date.now() - new Date(cobranca.consultado_em).getTime() > INTERVALO_CONSULTA_MS;

    if (cobranca.status === 'pendente' && cobranca.id_externo && vencida) {
        try {
            cobranca = await sincronizar(cobranca);
        } catch (error) {
            // Leitura não falha por instabilidade do provedor: devolve o último estado conhecido.
            console.error(`Mercado Pago: falha ao consultar a cobrança ${cobranca.codigo} (${error.message})`);
        }
    }

    return paraResposta(cobranca);
}

async function processarNotificacao(dataId) {
    const cobranca = await cobrancasRepository.buscarPorIdExterno(dataId);

    // Pagamento que não é nosso (outra integração da mesma conta, por exemplo): nada a fazer.
    if (!cobranca) {
        return { processada: false };
    }

    await sincronizar(cobranca);

    return { processada: true };
}

module.exports = { criarPix, consultar, processarNotificacao, mapearStatusProvedor, formatarExpiracao, TRANSICOES };

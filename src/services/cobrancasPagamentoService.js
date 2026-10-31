const crypto = require('node:crypto');
const AppError = require('../errors/AppError');
const mercadoPagoClient = require('../integrations/mercadoPagoClient');
const mercadoPagoService = require('./mercadoPagoService');
const mercadoPagoRepository = require('../repositories/mercadoPagoRepository');
const cobrancasRepository = require('../repositories/cobrancasPagamentoRepository');
const devolucoesRepository = require('../repositories/cobrancaDevolucoesRepository');
const taxasPlataformaRepository = require('../repositories/taxasPlataformaRepository');
const db = require('../config/db');
const { reaisParaCentavos, calcularTaxaPlataformaCentavos, centavosParaReais } = require('../utils/taxaPlataforma');

// O QR vale 30 minutos (mínimo aceito pelo Mercado Pago): o PDV é um fluxo de balcão.
const VALIDADE_PIX_MS = 30 * 60 * 1000;
// Link de cartão: validade e teto de parcelas oferecidas. Taxa da plataforma no cartão = 0 por decisão do PO
// (a taxa só incide sobre Pix); o campo marketplace_fee existe no cliente e só é enviado se isto mudar.
const VALIDADE_LINK_CARTAO_MS = 2 * 60 * 60 * 1000;
const PARCELAS_MAXIMAS_LINK = 12;
// account_money (saldo do comprador no Mercado Pago) não pode ser excluído do link: entra como débito (à vista, 1x).
const TIPO_CARTAO_POR_TIPO_PAGAMENTO = { credit_card: 'credito', debit_card: 'debito', account_money: 'debito' };
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

    const resposta = {
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

    if (cobranca.metodo === 'cartao_link') {
        // Cartão: o PDV recebe o link e, depois de pago, o tipo e as parcelas lidos do Mercado Pago.
        return {
            ...resposta,
            metodo: 'cartao_link',
            link_url: cobranca.link_url,
            parcelas_maximas: cobranca.parcelas_maximas,
            tipo_cartao: cobranca.tipo_cartao,
            parcelas: cobranca.parcelas
        };
    }

    return resposta;
}

async function criarPix({ empresa_id, usuario_id }, { valor, cliente_email }) {
    const config = mercadoPagoService.exigirConfig();
    const valorCentavos = reaisParaCentavos(valor);

    // payer.email do Pix: e-mail do cliente (se informado) > e-mail neutro da plataforma (MP_EMAIL_PAGADOR_PADRAO)
    // > e-mail de contato da empresa (comportamento anterior). O neutro evita usar o e-mail da loja como
    // pagador, que pode coincidir com o da conta Mercado Pago que recebe.
    const emailPagador = cliente_email ?? config.emailPagadorPadrao ?? await cobrancasRepository.buscarEmailContatoEmpresa(empresa_id);

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

// Link de pagamento de cartão (crédito/débito, até 12x). O cliente paga na página do Mercado Pago; a
// venda só nasce depois, com o pagamento já confirmado (mesmo modelo do Pix).
async function criarLinkCartao({ empresa_id, usuario_id }, { valor }) {
    const config = mercadoPagoService.exigirConfig();
    const valorCentavos = reaisParaCentavos(valor);

    // Falha cedo (409) se a loja não conectou o Mercado Pago, antes de gravar qualquer cobrança.
    const accessToken = await mercadoPagoService.obterAccessToken(empresa_id);

    const codigo = crypto.randomUUID();
    const cobranca = await cobrancasRepository.criar({
        codigo,
        empresa_id,
        valor: centavosParaReais(valorCentavos),
        taxa_plataforma: 0,
        criado_por: usuario_id,
        metodo: 'cartao_link',
        parcelas_maximas: PARCELAS_MAXIMAS_LINK
    });

    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + VALIDADE_LINK_CARTAO_MS);

    let criada;

    try {
        criada = await mercadoPagoClient.criarPreferenciaCartao(config, {
            accessToken,
            codigo,
            valor: Number(centavosParaReais(valorCentavos)),
            descricao: 'Venda no PDV',
            taxaPlataforma: 0,
            parcelasMaximas: PARCELAS_MAXIMAS_LINK,
            expiraDe: formatarExpiracao(agora),
            expiraAte: formatarExpiracao(expiraEm)
        });
    } catch (error) {
        await cobrancasRepository.marcarFalhou(cobranca.id, empresa_id);
        throw error;
    }

    const atualizada = await cobrancasRepository.registrarLinkCriado({
        id: cobranca.id, empresa_id, preferenciaId: criada.preferenciaId, linkUrl: criada.linkUrl, expiraEm
    });

    return paraResposta(atualizada);
}

// Entre os pagamentos achados pelo external_reference, só vale um que seja NOSSO (mesma referência), de cartão
// de crédito/débito e do valor exato da cobrança. Aprovado ganha; tentativas recusadas ou em análise não
// fecham a cobrança (o cliente pode tentar de novo no mesmo link).
function escolherPagamentoCartao(pagamentos, cobranca) {
    const validos = pagamentos.filter((p) => p
        && p.external_reference === cobranca.codigo
        && TIPO_CARTAO_POR_TIPO_PAGAMENTO[p.payment_type_id]
        && reaisParaCentavos(p.transaction_amount) === reaisParaCentavos(cobranca.valor));

    return validos.find((p) => p.status === 'approved') ?? null;
}

// Consulta o provedor e aplica a transição. NUNCA confia no corpo do webhook: o estado vem da API,
// com o token da loja dona da cobrança, e é conferido contra o que nós criamos.
async function sincronizar(cobrancaInicial) {
    const config = mercadoPagoService.exigirConfig();
    let cobranca = cobrancaInicial;

    // Pix tem o id do pagamento desde a criação; o link de cartão só depois que alguém paga.
    if (!cobranca.id_externo && cobranca.metodo !== 'cartao_link') {
        return cobranca;
    }

    const accessToken = await mercadoPagoService.obterAccessToken(cobranca.empresa_id);
    let pagamento;

    if (!cobranca.id_externo) {
        const encontrados = await mercadoPagoClient.buscarPagamentosPorReferencia(config, { accessToken, codigo: cobranca.codigo });
        const aprovado = escolherPagamentoCartao(encontrados, cobranca);

        if (!aprovado) {
            await cobrancasRepository.registrarConsulta(cobranca.id, cobranca.empresa_id);
            return cobranca;
        }

        const parcelas = TIPO_CARTAO_POR_TIPO_PAGAMENTO[aprovado.payment_type_id] === 'debito'
            ? 1
            : Math.min(24, Math.max(1, Number.parseInt(aprovado.installments, 10) || 1));

        const registrada = await cobrancasRepository.registrarPagamentoCartao({
            id: cobranca.id,
            empresa_id: cobranca.empresa_id,
            idExterno: String(aprovado.id),
            tipoCartao: TIPO_CARTAO_POR_TIPO_PAGAMENTO[aprovado.payment_type_id],
            parcelas
        });

        // Outra consulta pode ter registrado antes: segue com a linha atual do banco.
        cobranca = registrada ?? await cobrancasRepository.buscarPorCodigo(cobranca.codigo, cobranca.empresa_id);
        pagamento = aprovado;
    } else {
        pagamento = await mercadoPagoClient.buscarPagamento(config, { accessToken, idExterno: cobranca.id_externo });
    }

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

    if (atualizada && novo === 'estornado') {
        await devolucoesRepository.concluirPorCobranca(cobranca.id, cobranca.empresa_id);
    }

    // Se outra notificação ganhou a corrida, a linha já está no estado novo.
    return atualizada ?? await cobrancasRepository.buscarPorCodigo(cobranca.codigo, cobranca.empresa_id);
}

async function consultar(empresa_id, codigo) {
    let cobranca = await cobrancasRepository.buscarPorCodigo(codigo, empresa_id);

    if (!cobranca) {
        throw new AppError('Cobrança não encontrada', 404);
    }

    const vencida = !cobranca.consultado_em || Date.now() - new Date(cobranca.consultado_em).getTime() > INTERVALO_CONSULTA_MS;

    // Link de cartão não tem id de pagamento até alguém pagar: ele é consultado pelo external_reference.
    if (cobranca.status === 'pendente' && (cobranca.id_externo || cobranca.metodo === 'cartao_link') && vencida) {
        try {
            cobranca = await sincronizar(cobranca);
        } catch (error) {
            // Leitura não falha por instabilidade do provedor: devolve o último estado conhecido.
            console.error(`Mercado Pago: falha ao consultar a cobrança ${cobranca.codigo} (${error.message})`);
        }
    }

    return paraResposta(cobranca);
}

async function processarNotificacao(dataId, { mpUserId } = {}) {
    const cobranca = await cobrancasRepository.buscarPorIdExterno(dataId);

    if (cobranca) {
        await sincronizar(cobranca);
        return { processada: true };
    }

    // Link de cartão: o pagamento ainda não está ligado a nenhuma cobrança. A loja vem do user_id da
    // notificação; o pagamento é lido na API com o token DELA, e o external_reference o liga à cobrança.
    // Nada do corpo recebido é gravado: se o pagamento não for dessa loja, a consulta falha ou não confere.
    if (!mpUserId) {
        return { processada: false };
    }

    const conexao = await mercadoPagoRepository.buscarEmpresaPorMpUserId(String(mpUserId));

    if (!conexao) {
        return { processada: false };
    }

    const config = mercadoPagoService.exigirConfig();
    const accessToken = await mercadoPagoService.obterAccessToken(conexao.empresa_id);
    const pagamento = await mercadoPagoClient.buscarPagamento(config, { accessToken, idExterno: dataId });
    const codigo = typeof pagamento?.external_reference === 'string' ? pagamento.external_reference : null;

    if (!codigo || !/^[0-9a-f-]{36}$/i.test(codigo)) {
        return { processada: false };
    }

    const doLink = await cobrancasRepository.buscarPorCodigo(codigo, conexao.empresa_id);

    if (!doLink || doLink.metodo !== 'cartao_link') {
        return { processada: false };
    }

    await sincronizar(doLink);

    return { processada: true };
}

// Devolve (estorna) o Pix pago ao pagador. Só quem tem gerir_financeiro chega aqui (rota); empresa_id e
// quem pede vêm do JWT. Só vale para Pix pago sem venda ou de venda cancelada.
// Ordem: 1) reconsulta o provedor (se já foi devolvido no painel, só reflete); 2) reserva o pedido sob a
// trava da cobrança (conferindo as regras); 3) chama o provedor com chave de idempotência própria;
// 4) registra o resultado. Falha do provedor = pedido 'falhou' (pode pedir de novo); se a resposta se
// perder, a consulta/webhook seguinte conclui o pedido. Devolver duas vezes é impedido por índice único
// e, no provedor, porque o valor integral só pode ser devolvido uma vez.
async function devolver({ empresa_id, usuario_id }, codigo, { motivo }) {
    const existente = await cobrancasRepository.buscarPorCodigo(codigo, empresa_id);

    if (!existente) {
        throw new AppError('Cobrança Pix não encontrada', 404);
    }

    if (existente.metodo !== 'pix') {
        throw new AppError('A devolução de pagamentos de cartão ainda não está disponível. Faça pelo painel do Mercado Pago.', 409);
    }

    const config = mercadoPagoService.exigirConfig();

    await sincronizar(existente);

    const { cobranca, devolucao } = await devolucoesRepository.reservar({
        empresa_id, codigo, motivo: motivo.trim(), solicitado_por: usuario_id
    });

    let resultado;

    try {
        const accessToken = await mercadoPagoService.obterAccessToken(empresa_id);

        resultado = await mercadoPagoClient.devolverPagamento(config, {
            accessToken,
            idExterno: cobranca.id_externo,
            idempotencia: `devolucao-${devolucao.id}`
        });
    } catch (error) {
        await devolucoesRepository.marcarFalhou({ id: devolucao.id, empresa_id, erro: error.message });
        throw error;
    }

    if (resultado.status !== 'approved') {
        // Em processamento no provedor: continua 'solicitada' e a consulta/webhook seguinte conclui.
        return { codigo, valor: cobranca.valor, status: 'solicitada' };
    }

    await devolucoesRepository.marcarConcluida({ id: devolucao.id, empresa_id, idExterno: resultado.idExterno });
    await cobrancasRepository.atualizarStatus({ id: cobranca.id, empresa_id, de: 'pago', para: 'estornado' });

    return { codigo, valor: cobranca.valor, status: 'concluida' };
}

async function listarADevolver(empresa_id, paginacao) {
    return devolucoesRepository.listarADevolver({ empresa_id, ...paginacao });
}

async function listarDevolucoes(empresa_id, paginacao) {
    return devolucoesRepository.listarDevolucoes({ empresa_id, ...paginacao });
}

module.exports = { criarPix, criarLinkCartao, escolherPagamentoCartao, consultar, processarNotificacao, devolver, listarADevolver, listarDevolucoes, mapearStatusProvedor, formatarExpiracao, TRANSICOES };

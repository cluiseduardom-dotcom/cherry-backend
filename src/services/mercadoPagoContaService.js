const AppError = require('../errors/AppError');
const contasRepo = require('../repositories/contasBancariasRepository');
const movimentosRepo = require('../repositories/movimentosBancariosRepository');
const mpContaRepo = require('../repositories/mercadoPagoContaRepository');
const mercadoPagoService = require('./mercadoPagoService');
const mercadoPagoClient = require('../integrations/mercadoPagoClient');

// Sincroniza uma conta bancária "Conta de pagamento" com o que o Mercado Pago já pagou/devolveu pelo Vertumno.
// Por PUXADA e sob demanda, nunca dentro da venda: uma falha aqui não toca em venda, cobrança nem estoque.
// Idempotente: cada lançamento tem referência única (mp:pay:<id do pagamento>, mp:ref:<id da devolução>).
//
// O que entra: o valor LÍQUIDO que o Mercado Pago repassa (net_received_amount: já sem tarifa e sem a taxa da
// plataforma), na DATA DE LIBERAÇÃO (money_release_date). Data futura = "a liberar", fora do saldo atual.
// Devolução concluída entra como saída pelo valor devolvido.
// [CONFIRMAR NO PRIMEIRO USO REAL] se a tarifa do Mercado Pago é devolvida junto com a devolução: hoje a
// saída é o valor bruto devolvido, então o saldo pode ficar abaixo do real pela tarifa; a conferência com o
// extrato do Mercado Pago pega a diferença.

const LIMITE_POR_EXECUCAO = 100;
const STATUS_PAGOS = new Set(['approved', 'refunded', 'charged_back']);

const centavos = (v) => Math.round(Number(v) * 100);
const reais = (c) => c / 100;
const moeda = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function dataValida(texto) {
    const d = new Date(texto);
    return Number.isNaN(d.getTime()) ? null : d;
}

function somarTarifas(feeDetails) {
    const lista = Array.isArray(feeDetails) ? feeDetails : [];
    const porTipo = {};
    for (const f of lista) {
        const valor = Number(f?.amount);
        if (Number.isFinite(valor) && valor > 0) porTipo[String(f?.type ?? 'outra')] = (porTipo[String(f?.type ?? 'outra')] ?? 0) + valor;
    }
    return porTipo;
}

// Transforma o pagamento do Mercado Pago no lançamento de entrada (ou lança erro curto, sem dados do provedor).
function montarEntrada(cobranca, pagamento) {
    if (!pagamento || String(pagamento.id) !== String(cobranca.id_externo)) {
        throw new AppError('Pagamento não confere com a cobrança.', 422);
    }
    if (!STATUS_PAGOS.has(pagamento.status)) {
        throw new AppError(`Pagamento com status "${String(pagamento.status).slice(0, 30)}" no Mercado Pago.`, 422);
    }

    const liquido = Number(pagamento.transaction_details?.net_received_amount);
    if (!Number.isFinite(liquido) || liquido <= 0) {
        throw new AppError('O Mercado Pago não informou o valor líquido deste pagamento.', 422);
    }

    const liberacao = dataValida(pagamento.money_release_date) ?? dataValida(pagamento.date_approved);
    if (!liberacao) throw new AppError('O Mercado Pago não informou a data de liberação deste pagamento.', 422);

    const tarifas = somarTarifas(pagamento.fee_details);
    const partes = [`Bruto ${moeda(pagamento.transaction_amount ?? cobranca.valor)}`];
    if (tarifas.mercadopago_fee) partes.push(`tarifa MP ${moeda(tarifas.mercadopago_fee)}`);
    if (tarifas.application_fee) partes.push(`taxa da plataforma ${moeda(tarifas.application_fee)}`);
    if (tarifas.financing_fee) partes.push(`juros de parcelamento ${moeda(tarifas.financing_fee)}`);

    return {
        tipo: 'ENTRADA',
        valor: reais(centavos(liquido)),
        data_movimento: liberacao.toISOString(),
        descricao: `Mercado Pago ${cobranca.metodo === 'pix' ? 'Pix' : 'cartão'} #${cobranca.id_externo}`,
        referencia_externa: `mp:pay:${cobranca.id_externo}`,
        observacao: partes.join(' · ')
    };
}

async function sincronizar({ conta_bancaria_id: contaId }, usuario) {
    const empresaId = usuario.empresa_id;
    const conta = await contasRepo.buscarPorId(contaId, empresaId);

    if (!conta) throw new AppError('Conta bancária não encontrada', 404);
    if (conta.tipo !== 'CONTA_PAGAMENTO') throw new AppError('Escolha uma conta do tipo "Conta de pagamento" para o Mercado Pago.', 409);
    if (conta.status !== 'ATIVA') throw new AppError('A conta está inativa.', 409);
    if (conta.provedor && conta.provedor !== 'mercadopago') throw new AppError('Esta conta já está ligada a outro provedor.', 409);

    // Sem conexão ativa isto falha com 409 claro, antes de qualquer lançamento.
    const config = mercadoPagoService.exigirConfig();
    const accessToken = await mercadoPagoService.obterAccessToken(empresaId);

    const resultado = { entradas: 0, saidas: 0, ja_lancados: 0, erros: [], tem_mais: false };

    const cobrancas = await mpContaRepo.listarCobrancasPendentes(empresaId, conta.id, LIMITE_POR_EXECUCAO);
    for (const cobranca of cobrancas) {
        try {
            const pagamento = await mercadoPagoClient.buscarPagamento(config, { accessToken, idExterno: cobranca.id_externo });
            const lancamento = montarEntrada(cobranca, pagamento);
            const { criado } = await movimentosRepo.criarSeNovo({
                ...lancamento, empresa_id: empresaId, conta_bancaria_id: conta.id, origem: 'API_BANCO', usuario_id: usuario.id
            });
            if (criado) resultado.entradas += 1; else resultado.ja_lancados += 1;
        } catch (erro) {
            resultado.erros.push({ referencia: `mp:pay:${cobranca.id_externo}`, erro: erro instanceof AppError ? erro.message : 'Falha ao lançar este pagamento.' });
        }
    }

    const devolucoes = await mpContaRepo.listarDevolucoesPendentes(empresaId, conta.id, LIMITE_POR_EXECUCAO);
    for (const devolucao of devolucoes) {
        try {
            const { criado } = await movimentosRepo.criarSeNovo({
                empresa_id: empresaId,
                conta_bancaria_id: conta.id,
                tipo: 'SAIDA',
                origem: 'API_BANCO',
                valor: reais(centavos(devolucao.valor)),
                data_movimento: new Date(devolucao.atualizado_em).toISOString(),
                descricao: `Devolução Mercado Pago #${devolucao.id_externo}`,
                referencia_externa: `mp:ref:${devolucao.id}`,
                observacao: 'Devolução concluída pelo Vertumno',
                usuario_id: usuario.id
            });
            if (criado) resultado.saidas += 1; else resultado.ja_lancados += 1;
        } catch {
            resultado.erros.push({ referencia: `mp:ref:${devolucao.id}`, erro: 'Falha ao lançar esta devolução.' });
        }
    }

    resultado.tem_mais = cobrancas.length === LIMITE_POR_EXECUCAO || devolucoes.length === LIMITE_POR_EXECUCAO;
    await mpContaRepo.registrarSincronizacao(conta.id, empresaId);

    return resultado;
}

module.exports = { sincronizar, montarEntrada };

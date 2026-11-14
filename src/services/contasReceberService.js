const contasReceberRepository = require('../repositories/contasReceberRepository');
const comissoesRepository = require('../repositories/comissoesRepository');
const AppError = require('../errors/AppError');
const pagamentosService = require('./pagamentosService');

// "atrasado" nunca é gravado: é sempre derivado de status + data_vencimento
// no momento da resposta, mesmo padrão de contasPagarService.comAtraso.
function comAtraso(conta) {
    if (!conta) return conta;

    const hoje = new Date().toISOString().slice(0, 10);
    const vencimento = new Date(conta.data_vencimento).toISOString().slice(0, 10);
    const atrasado = conta.status === 'pendente' && vencimento < hoje;

    return { ...conta, atrasado };
}

async function listar({ page, pageSize, status, vencimentoDe, vencimentoAte }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await contasReceberRepository.listarPaginado({
        limit,
        offset,
        status,
        vencimentoDe,
        vencimentoAte,
        empresa_id: empresaId
    });

    return {
        items: items.map(comAtraso),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, empresaId) {
    const conta = await contasReceberRepository.buscarPorId(id, empresaId);

    if (!conta) {
        throw new AppError('Conta a receber não encontrada', 404);
    }

    return comAtraso(conta);
}

// A checagem de "só pendente pode virar recebida" mora no repository
// (transação com FOR UPDATE), não aqui — mesmo motivo de vendasService.cancelar
// delegar direto pro repository: leitura+checagem aqui deixaria uma janela
// para duas requisições concorrentes passarem ambas pela checagem antes de
// qualquer uma escrever.
async function marcarComoRecebida(id, empresaId, usuarioId = null) {
    const existente = await contasReceberRepository.buscarPorId(id, empresaId);

    // Conta do fluxo novo (com parcela): "receber" passa a registrar o recebimento da parcela, que atualiza a parcela, o
    // pagamento, a conta e a comissão na mesma transação. Antes, este botão só virava a conta para "recebido" e deixava a
    // parcela pendente, sem recebimento registrado e com a comissão sem liberar.
    if (existente && existente.parcela_id) {
        if (existente.status !== 'pendente') {
            throw new AppError('Somente contas pendentes podem ser marcadas como recebidas', 409);
        }

        const { conta } = await receber(id, {}, { id: usuarioId, empresa_id: empresaId });

        return conta;
    }

    return marcarContaLegadaComoRecebida(id, empresaId, usuarioId);
}

// Conta legada (venda a prazo anterior às parcelas): sem parcela, só admite recebimento por inteiro.
async function marcarContaLegadaComoRecebida(id, empresaId, usuarioId = null) {
    const recebida = await contasReceberRepository.marcarComoRecebida(id, empresaId);

    // Venda legada a prazo: o recebimento da conta libera a comissão da venda. Venda do
    // fluxo novo (parcelas) é liberada pelo recebimento da parcela, não por aqui.
    if (recebida && recebida.venda_id) {
        await comissoesRepository.recalcularLiberacaoAvulso({
            venda_id: recebida.venda_id, empresa_id: empresaId, origem: 'conta_receber', executado_por: usuarioId
        });
    }

    return comAtraso(recebida);
}

// Recebimento (total ou parcial) de uma conta a receber. Sem `valor`, recebe o RESTANTE (calculado pelo servidor, sob trava).
// Com `valor`, recebe aquele valor (não pode passar do restante). A conta só vira "recebido" quando o restante zera; enquanto
// isso fica "pendente" com `valor_recebido` e `valor_restante`. Conta legada (sem parcela) só admite recebimento por inteiro.
async function receber(id, { valor, forma_pagamento = 'dinheiro', observacao = null, chave = null }, usuario) {
    const conta = await contasReceberRepository.buscarPorId(id, usuario.empresa_id);

    if (!conta) throw new AppError('Conta a receber não encontrada', 404);
    if (conta.status === 'cancelado') throw new AppError('Conta cancelada não pode receber pagamento', 409);

    const semValor = valor === undefined || valor === null;

    if (!conta.parcela_id) {
        if (!semValor && Math.round(Number(valor) * 100) !== Math.round(Number(conta.valor) * 100)) {
            throw new AppError('Esta conta é de uma venda antiga e só pode ser recebida por inteiro', 422);
        }

        await marcarContaLegadaComoRecebida(id, usuario.empresa_id, usuario.id);

        return { conta: comAtraso(await contasReceberRepository.buscarPorId(id, usuario.empresa_id)), recebimento: null, reaproveitado: false };
    }

    // Repetição de um recebimento já feito (mesma chave): devolve o original, mesmo que a conta já esteja recebida.
    if (conta.status === 'recebido' && !chave) throw new AppError('Esta conta já foi recebida por inteiro', 409);

    const resultado = await pagamentosService.receberParcela(
        conta.parcela_id,
        { valor, forma_pagamento, observacao, chave, receberRestante: semValor },
        usuario
    );
    const atualizada = await contasReceberRepository.buscarPorId(id, usuario.empresa_id);

    return { conta: comAtraso(atualizada), recebimento: resultado.recebimento, reaproveitado: resultado.reaproveitado === true };
}

async function listarRecebimentos(id, empresaId) {
    const conta = await contasReceberRepository.buscarPorId(id, empresaId);

    if (!conta) throw new AppError('Conta a receber não encontrada', 404);

    return contasReceberRepository.listarRecebimentos(id, empresaId);
}

module.exports = {
    listar,
    buscarPorId,
    marcarComoRecebida,
    receber,
    listarRecebimentos
};

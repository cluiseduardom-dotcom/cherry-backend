const contasPagarRepository = require('../repositories/contasPagarRepository');
const AppError = require('../errors/AppError');

// "atrasado" nunca é gravado: é sempre derivado de status + data_vencimento
// no momento da resposta, no mesmo espírito de produtosService.comMargem.
// Comparação por string de data (YYYY-MM-DD) evita pegadinha de fuso horário
// entre o Date que o pg devolve pra uma coluna DATE e o "hoje" do servidor.
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

    const { items, total } = await contasPagarRepository.listarPaginado({
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
    const conta = await contasPagarRepository.buscarPorId(id, empresaId);

    if (!conta) {
        throw new AppError('Conta a pagar não encontrada', 404);
    }

    return comAtraso(conta);
}

async function criar(dados, usuario_id, empresaId) {
    const conta = await contasPagarRepository.criar({ ...dados, usuario_id, empresa_id: empresaId });
    return comAtraso(conta);
}

// A checagem de "só pendente pode ser editada" mora no repository (transação
// com FOR UPDATE), mesmo motivo de marcarComoPaga/cancelar: leitura+checagem
// aqui deixaria uma janela para um PATCH concorrente escapar da validação.
async function atualizar(id, dados, empresaId) {
    const atualizada = await contasPagarRepository.atualizar(id, dados, empresaId);
    return comAtraso(atualizada);
}

// A checagem de "só pendente pode virar paga/cancelada" mora no repository
// (transação com FOR UPDATE), não aqui — mesmo motivo de vendasService.cancelar
// delegar direto pro repository: fazer a leitura+checagem aqui e a escrita lá
// deixaria uma janela para duas requisições concorrentes passarem ambas pela
// checagem antes de qualquer uma escrever.
async function marcarComoPaga(id, empresaId) {
    const paga = await contasPagarRepository.marcarComoPaga(id, empresaId);
    return comAtraso(paga);
}

async function cancelar(id, empresaId) {
    const cancelada = await contasPagarRepository.cancelar(id, empresaId);
    return comAtraso(cancelada);
}

module.exports = {
    listar,
    buscarPorId,
    criar,
    atualizar,
    marcarComoPaga,
    cancelar
};

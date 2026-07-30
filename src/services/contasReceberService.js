const contasReceberRepository = require('../repositories/contasReceberRepository');
const AppError = require('../errors/AppError');

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
async function marcarComoRecebida(id, empresaId) {
    const recebida = await contasReceberRepository.marcarComoRecebida(id, empresaId);
    return comAtraso(recebida);
}

module.exports = {
    listar,
    buscarPorId,
    marcarComoRecebida
};

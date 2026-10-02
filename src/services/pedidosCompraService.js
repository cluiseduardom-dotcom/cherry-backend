const AppError = require('../errors/AppError');
const repository = require('../repositories/pedidosCompraRepository');

const STATUS_EDITAVEIS = new Set(['RASCUNHO']);
const TRANSICOES = {
    RASCUNHO: ['PENDENTE_APROVACAO', 'CANCELADO'],
    PENDENTE_APROVACAO: ['APROVADO', 'RASCUNHO', 'CANCELADO'],
    APROVADO: ['ENVIADO', 'RASCUNHO', 'CANCELADO'],
    ENVIADO: ['CONFIRMADO', 'PARCIALMENTE_RECEBIDO', 'RECEBIDO', 'CANCELADO'],
    CONFIRMADO: ['PARCIALMENTE_RECEBIDO', 'RECEBIDO', 'CANCELADO'],
    PARCIALMENTE_RECEBIDO: ['RECEBIDO'],
    RECEBIDO: [],
    CANCELADO: []
};

function validarStatusEditavel(status) {
    if (!STATUS_EDITAVEIS.has(status)) {
        throw new AppError('Pedido de compra não está em estado editável', 409);
    }
}

function validarTransicao(atual, proximo) {
    if (!TRANSICOES[atual]?.includes(proximo)) {
        throw new AppError(`Transição de pedido de compra inválida: ${atual} → ${proximo}`, 409);
    }
}

async function criar(dados) {
    if (!dados.numero || !String(dados.numero).trim()) {
        throw new AppError('Número do pedido de compra é obrigatório', 400);
    }
    if (!(Number(dados.fornecedor_id) > 0)) {
        throw new AppError('Fornecedor é obrigatório', 400);
    }
    return repository.criar(dados);
}

async function adicionarItem(pedidoId, dados, usuario) {
    const pedido = await repository.buscarPorId(pedidoId, usuario.empresa_id);
    if (!pedido) throw new AppError('Pedido de compra não encontrado', 404);
    validarStatusEditavel(pedido.status);

    if (!dados.descricao_snapshot || !String(dados.descricao_snapshot).trim()) {
        throw new AppError('Descrição do item é obrigatória', 400);
    }
    if (!(Number(dados.quantidade) > 0)) {
        throw new AppError('Quantidade deve ser maior que zero', 400);
    }
    if (!(Number(dados.preco_unitario) >= 0)) {
        throw new AppError('Preço unitário não pode ser negativo', 400);
    }

    const item = await repository.adicionarItem({
        ...dados,
        pedido_compra_id: pedidoId,
        empresa_id: usuario.empresa_id
    });
    await repository.recalcularTotal(pedidoId, usuario.empresa_id);
    return item;
}

async function alterarStatus(id, proximoStatus, usuario) {
    const pedido = await repository.buscarPorId(id, usuario.empresa_id);
    if (!pedido) throw new AppError('Pedido de compra não encontrado', 404);

    validarTransicao(pedido.status, proximoStatus);

    const agora = new Date().toISOString();
    const dados = {};
    if (proximoStatus === 'ENVIADO') dados.enviado_em = agora;
    if (proximoStatus === 'CONFIRMADO') dados.confirmado_em = agora;

    return repository.atualizarStatus(
        id,
        usuario.empresa_id,
        proximoStatus,
        dados
    );
}

async function obter(id, usuario) {
    const pedido = await repository.buscarPorId(id, usuario.empresa_id);
    if (!pedido) throw new AppError('Pedido de compra não encontrado', 404);

    return {
        ...pedido,
        itens: await repository.listarItens(id, usuario.empresa_id)
    };
}

async function listar(filtros, usuario) {
    return repository.listar({
        ...filtros,
        empresa_id: usuario.empresa_id
    });
}

module.exports = {
    criar,
    adicionarItem,
    alterarStatus,
    obter,
    listar,
    validarStatusEditavel,
    validarTransicao
};

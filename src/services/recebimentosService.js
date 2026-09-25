const AppError = require('../errors/AppError');
const repository = require('../repositories/recebimentosRepository');

const TRANSICOES = {
    RASCUNHO: ['EM_CONFERENCIA', 'CANCELADO'],
    EM_CONFERENCIA: ['CONFERIDO', 'DIVERGENCIA', 'RASCUNHO', 'CANCELADO'],
    CONFERIDO: ['APROVADO', 'DIVERGENCIA', 'EM_CONFERENCIA'],
    DIVERGENCIA: ['EM_CONFERENCIA', 'CONFERIDO', 'CANCELADO'],
    APROVADO: [],
    CANCELADO: []
};

function validarTransicao(atual, proximo) {
    if (!TRANSICOES[atual]?.includes(proximo)) {
        throw new AppError(`Transição de recebimento inválida: ${atual} → ${proximo}`, 409);
    }
}

async function criar(dados) {
    if (!(Number(dados.pedido_compra_id) > 0)) {
        throw new AppError('Pedido de compra é obrigatório', 400);
    }
    if (!(Number(dados.fornecedor_id) > 0)) {
        throw new AppError('Fornecedor é obrigatório', 400);
    }
    if (!dados.numero || !String(dados.numero).trim()) {
        throw new AppError('Número do recebimento é obrigatório', 400);
    }
    if (dados.chave_nf && !/^\d{44}$/.test(String(dados.chave_nf))) {
        throw new AppError('Chave da NF-e deve conter 44 dígitos', 400);
    }
    return repository.criar(dados);
}

async function adicionarItem(recebimentoId, dados, usuario) {
    const recebimento = await repository.buscarPorId(recebimentoId, usuario.empresa_id);
    if (!recebimento) throw new AppError('Recebimento não encontrado', 404);
    if (recebimento.status !== 'RASCUNHO') {
        throw new AppError('Recebimento não está em estado editável', 409);
    }

    const pedidoItem = await repository.buscarPedidoItem(
        dados.pedido_compra_item_id,
        usuario.empresa_id
    );
    if (!pedidoItem) throw new AppError('Item do pedido de compra não encontrado', 404);

    if (!dados.descricao_snapshot || !String(dados.descricao_snapshot).trim()) {
        throw new AppError('Descrição do item é obrigatória', 400);
    }

    const quantidade = Number(dados.quantidade_recebida);
    if (!(quantidade > 0)) {
        throw new AppError('Quantidade recebida deve ser maior que zero', 400);
    }

    const jaRecebida = await repository.quantidadeJaRecebida(
        pedidoItem.id,
        usuario.empresa_id
    );
    if (jaRecebida + quantidade > Number(pedidoItem.quantidade)) {
        throw new AppError('Quantidade recebida excede o saldo do pedido de compra', 409);
    }

    return repository.adicionarItem({
        ...dados,
        recebimento_id: recebimentoId,
        empresa_id: usuario.empresa_id,
        quantidade_pedida: Number(pedidoItem.quantidade),
        produto_id: dados.produto_id ?? pedidoItem.produto_id,
        unidade: dados.unidade ?? pedidoItem.unidade,
        preco_unitario: dados.preco_unitario ?? pedidoItem.preco_unitario
    });
}

async function alterarStatus(id, proximoStatus, usuario) {
    const recebimento = await repository.buscarPorId(id, usuario.empresa_id);
    if (!recebimento) throw new AppError('Recebimento não encontrado', 404);
    validarTransicao(recebimento.status, proximoStatus);
    return repository.atualizarStatus(id, usuario.empresa_id, proximoStatus);
}

async function obter(id, usuario) {
    const recebimento=await repository.buscarPorId(id, usuario.empresa_id);
    if(!recebimento) throw new AppError('Recebimento não encontrado',404);
    return {...recebimento,itens:await repository.listarItens(id,usuario.empresa_id)};
}

async function listar(filtros,usuario){
    return repository.listar({...filtros,empresa_id:usuario.empresa_id});
}

module.exports={criar,adicionarItem,alterarStatus,obter,listar,validarTransicao};

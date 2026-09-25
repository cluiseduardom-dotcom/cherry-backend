const AppError = require('../errors/AppError');
const repository = require('../repositories/ocPcRepository');

async function vincular(dados, usuario) {
    const empresaId = usuario.empresa_id;
    const quantidade = Number(dados.quantidade_vinculada);

    if (!(Number(dados.ordem_compra_item_id) > 0)) {
        throw new AppError('Item da ordem de compra é obrigatório', 400);
    }

    if (!(Number(dados.pedido_compra_item_id) > 0)) {
        throw new AppError('Item do pedido de compra é obrigatório', 400);
    }

    if (!(quantidade > 0)) {
        throw new AppError('Quantidade vinculada deve ser maior que zero', 400);
    }

    const ocItem = await repository.buscarOcItem(
        dados.ordem_compra_item_id,
        empresaId
    );
    if (!ocItem) {
        throw new AppError('Item da ordem de compra não encontrado', 404);
    }

    const pcItem = await repository.buscarPcItem(
        dados.pedido_compra_item_id,
        empresaId
    );
    if (!pcItem) {
        throw new AppError('Item do pedido de compra não encontrado', 404);
    }

    const ocVinculada = await repository.quantidadeVinculadaOcItem(
        ocItem.id,
        empresaId
    );
    if (ocVinculada + quantidade > Number(ocItem.quantidade_solicitada)) {
        throw new AppError('Quantidade vinculada excede o saldo da ordem de compra', 409);
    }

    const pcVinculada = await repository.quantidadeVinculadaPcItem(
        pcItem.id,
        empresaId
    );
    if (pcVinculada + quantidade > Number(pcItem.quantidade)) {
        throw new AppError('Quantidade vinculada excede a quantidade do pedido de compra', 409);
    }

    return repository.criarVinculo({
        ...dados,
        empresa_id: empresaId,
        quantidade_vinculada: quantidade
    });
}

async function listarPorOc(itemId, usuario) {
    return repository.listarPorOc(itemId, usuario.empresa_id);
}

async function listarPorPc(itemId, usuario) {
    return repository.listarPorPc(itemId, usuario.empresa_id);
}

module.exports = {
    vincular,
    listarPorOc,
    listarPorPc
};

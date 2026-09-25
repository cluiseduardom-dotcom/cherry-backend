const AppError = require('../errors/AppError');
const repository = require('../repositories/ordensCompraRepository');

const STATUS_EDITAVEIS = new Set(['RASCUNHO', 'REJEITADA']);

function validarStatusEditavel(status) {
    if (!STATUS_EDITAVEIS.has(status)) {
        throw new AppError('Ordem de compra não está em estado editável', 409);
    }
}

function validarOrigem(origem) {
    if (!['PLANEJADA', 'COMPRA_DIRETA'].includes(origem)) {
        throw new AppError('Origem da ordem de compra inválida', 400);
    }
}

async function criar(dados) {
    validarOrigem(dados.origem ?? 'PLANEJADA');
    return repository.criar(dados);
}

async function adicionarItem(ordemId, dados, usuario) {
    const ordem = await repository.buscarPorId(ordemId, usuario.empresa_id);
    if (!ordem) throw new AppError('Ordem de compra não encontrada', 404);
    validarStatusEditavel(ordem.status);

    if (!dados.descricao_snapshot || !String(dados.descricao_snapshot).trim()) {
        throw new AppError('Descrição do item é obrigatória', 400);
    }
    if (!(Number(dados.quantidade_solicitada) > 0)) {
        throw new AppError('Quantidade solicitada deve ser maior que zero', 400);
    }

    return repository.adicionarItem({
        ...dados,
        ordem_compra_id: ordemId,
        empresa_id: usuario.empresa_id
    });
}

async function obter(id, usuario) {
    const ordem = await repository.buscarPorId(id, usuario.empresa_id);
    if (!ordem) throw new AppError('Ordem de compra não encontrada', 404);
    return { ...ordem, itens: await repository.listarItens(id, usuario.empresa_id) };
}

async function listar(filtros, usuario) {
    return repository.listar({
        ...filtros,
        empresa_id: usuario.empresa_id
    });
}

module.exports = { criar, adicionarItem, obter, listar, validarStatusEditavel };

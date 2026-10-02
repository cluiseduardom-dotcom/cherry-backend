const AppError = require('../errors/AppError');
const repository = require('../repositories/cotacoesRepository');

const STATUS_EDITAVEIS = new Set(['RASCUNHO']);
const STATUS_OFERTAS = new Set(['ABERTA', 'EM_ANALISE']);

function validarStatusEditavel(status) {
    if (!STATUS_EDITAVEIS.has(status)) {
        throw new AppError('Cotação não está em estado editável', 409);
    }
}

function validarStatusOferta(status) {
    if (!STATUS_OFERTAS.has(status)) {
        throw new AppError('Cotação não está recebendo propostas', 409);
    }
}

async function criar(dados) {
    if (!dados.numero || !String(dados.numero).trim()) {
        throw new AppError('Número da cotação é obrigatório', 400);
    }
    return repository.criar(dados);
}

async function adicionarItem(cotacaoId, dados, usuario) {
    const cotacao = await repository.buscarPorId(cotacaoId, usuario.empresa_id);
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);
    validarStatusEditavel(cotacao.status);

    if (!dados.descricao_snapshot || !String(dados.descricao_snapshot).trim()) {
        throw new AppError('Descrição do item é obrigatória', 400);
    }
    if (!(Number(dados.quantidade_solicitada) > 0)) {
        throw new AppError('Quantidade solicitada deve ser maior que zero', 400);
    }

    return repository.adicionarItem({
        ...dados,
        cotacao_id: cotacaoId,
        empresa_id: usuario.empresa_id
    });
}

async function adicionarFornecedor(cotacaoId, dados, usuario) {
    const cotacao = await repository.buscarPorId(cotacaoId, usuario.empresa_id);
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);
    validarStatusEditavel(cotacao.status);

    if (!(Number(dados.fornecedor_id) > 0)) {
        throw new AppError('Fornecedor é obrigatório', 400);
    }

    return repository.adicionarFornecedor({
        ...dados,
        cotacao_id: cotacaoId,
        empresa_id: usuario.empresa_id
    });
}

async function adicionarOferta(cotacaoFornecedorId, dados, usuario) {
    if (!(Number(cotacaoFornecedorId) > 0)) {
        throw new AppError('Fornecedor da cotação é obrigatório', 400);
    }

    if (!(Number(dados.cotacao_item_id) > 0)) {
        throw new AppError('Item da cotação é obrigatório', 400);
    }
    if (!(Number(dados.quantidade_ofertada) > 0)) {
        throw new AppError('Quantidade ofertada deve ser maior que zero', 400);
    }
    if (!(Number(dados.preco_unitario) >= 0)) {
        throw new AppError('Preço unitário não pode ser negativo', 400);
    }

    const fornecedor = await repository.buscarFornecedor(
        cotacaoFornecedorId,
        usuario.empresa_id
    );
    if (!fornecedor) throw new AppError('Fornecedor da cotação não encontrado', 404);

    const cotacao = await repository.buscarPorId(
        fornecedor.cotacao_id,
        usuario.empresa_id
    );
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);
    validarStatusOferta(cotacao.status);

    const item = await repository.buscarItem(
        dados.cotacao_item_id,
        usuario.empresa_id
    );
    if (!item || item.cotacao_id !== fornecedor.cotacao_id) {
        throw new AppError('Item não pertence à cotação informada', 400);
    }

    return repository.adicionarOferta({
        ...dados,
        cotacao_fornecedor_id: cotacaoFornecedorId,
        empresa_id: usuario.empresa_id
    });
}

async function abrir(id, usuario) {
    const cotacao = await repository.buscarPorId(id, usuario.empresa_id);
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);
    if (cotacao.status !== 'RASCUNHO') {
        throw new AppError('Somente cotação em rascunho pode ser aberta', 409);
    }
    return repository.atualizarStatus(id, usuario.empresa_id, 'ABERTA', {
        data_abertura: new Date().toISOString().slice(0, 10)
    });
}

async function iniciarAnalise(id, usuario) {
    const cotacao = await repository.buscarPorId(id, usuario.empresa_id);
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);
    if (cotacao.status !== 'ABERTA') {
        throw new AppError('Somente cotação aberta pode entrar em análise', 409);
    }
    return repository.atualizarStatus(id, usuario.empresa_id, 'EM_ANALISE');
}

async function encerrar(id, usuario) {
    const cotacao = await repository.buscarPorId(id, usuario.empresa_id);
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);
    if (!['ABERTA', 'EM_ANALISE'].includes(cotacao.status)) {
        throw new AppError('Cotação não pode ser encerrada neste estado', 409);
    }
    return repository.atualizarStatus(id, usuario.empresa_id, 'ENCERRADA');
}

async function obter(id, usuario) {
    const cotacao = await repository.buscarPorId(id, usuario.empresa_id);
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);

    return {
        ...cotacao,
        itens: await repository.listarItens(id, usuario.empresa_id),
        fornecedores: await repository.listarFornecedores(id, usuario.empresa_id),
        ofertas: await repository.listarOfertas(id, usuario.empresa_id)
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
    adicionarFornecedor,
    adicionarOferta,
    abrir,
    iniciarAnalise,
    encerrar,
    obter,
    listar,
    validarStatusEditavel,
    validarStatusOferta
};

const estoqueRepository = require('../repositories/estoqueRepository');
const produtosRepository = require('../repositories/produtosRepository');
const AppError = require('../errors/AppError');
const { MOTIVOS_ESTOQUE } = require('../constants/motivosEstoque');
const { CAPACIDADES } = require('../constants/cargos');
const { temCapacidade } = require('./permissoesService');

// Movimentação AVULSA (tela de Estoque). Entrada de mercadoria normal é Compra ou Recebimento; aqui só
// entram: estoque inicial (Admin, produto sem nenhuma movimentação) e recebimento sem compra
// (capacidade `receber_sem_compra`). Ajuste para MAIS exige `ajustar_estoque`; saída e ajuste para
// MENOS seguem liberados ao Estoquista, sempre com motivo da lista. As permissões são checadas aqui
// no backend; a tela só esconde o que o usuário não pode.
// `usuario` é o req.usuario; sem ele, nada que exija permissão passa.
async function registrarMovimentacao(produto_id, { tipo, quantidade, motivo_codigo, observacao, local_id }, usuario_id, empresaId, usuario) {
    if (tipo === 'entrada') {
        if (motivo_codigo === 'estoque_inicial' && usuario?.role !== 'admin') {
            throw new AppError('Somente o administrador pode lançar estoque inicial', 403);
        }

        if (motivo_codigo === 'recebimento_sem_compra' && !temCapacidade(usuario, CAPACIDADES.RECEBER_SEM_COMPRA)) {
            throw new AppError('Sem permissão para receber mercadoria sem compra', 403);
        }
    }

    const rotulo = MOTIVOS_ESTOQUE[tipo][motivo_codigo].rotulo;
    const motivo = observacao ? `${rotulo} — ${observacao}` : rotulo;

    const produto = await produtosRepository.buscarPorId(produto_id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    if (!produto.ativo) {
        throw new AppError('Produto inativo não pode receber movimentações de estoque', 400);
    }

    const resultado = await estoqueRepository.criarMovimentacao({
        produto_id,
        tipo,
        quantidade,
        motivo,
        usuario_id,
        empresa_id: empresaId,
        local_id,
        origem: motivo_codigo,
        bloquearAjusteParaMais: tipo === 'ajuste' && !temCapacidade(usuario, CAPACIDADES.AJUSTAR_ESTOQUE),
        exigirSemHistorico: motivo_codigo === 'estoque_inicial'
    });

    if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') {
        throw new AppError('Produto não encontrado', 404);
    }

    if (resultado.erro === 'LOCAL_NAO_ENCONTRADO') {
        throw new AppError('Local de estoque não encontrado', 404);
    }

    if (resultado.erro === 'ESTOQUE_INSUFICIENTE') {
        throw new AppError('Estoque insuficiente para essa saída', 409);
    }

    if (resultado.erro === 'AJUSTE_PARA_MAIS_NAO_AUTORIZADO') {
        throw new AppError('Sem permissão para ajustar o estoque para mais. Para entrada de mercadoria, registre uma compra ou um recebimento', 403);
    }

    if (resultado.erro === 'ENTRADA_INICIAL_COM_HISTORICO') {
        throw new AppError('Estoque inicial só pode ser lançado em produto sem nenhuma movimentação. Para entrada de mercadoria, registre uma compra ou um recebimento', 409);
    }

    return resultado.movimentacao;
}

async function saldosPorLocal(produto_id, empresaId) {
    const resultado = await estoqueRepository.saldosPorLocal(produto_id, empresaId);

    if (!resultado) {
        throw new AppError('Produto não encontrado', 404);
    }

    return resultado;
}

async function listarLocais(empresaId) {
    return estoqueRepository.listarLocais(empresaId);
}

async function historicoPorProduto(produto_id, { page, pageSize }, empresaId) {
    const produto = await produtosRepository.buscarPorId(produto_id, empresaId);

    if (!produto) {
        throw new AppError('Produto não encontrado', 404);
    }

    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await estoqueRepository.listarPorProduto(produto_id, empresaId, { limit, offset });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function alertasEstoqueBaixo(empresaId) {
    return estoqueRepository.getEstoqueBaixo(empresaId);
}

async function listarMovimentacoesRelatorio(filtros, empresaId) {
    const { page, pageSize } = filtros;
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await estoqueRepository.listarMovimentacoesRelatorio({
        ...filtros,
        limit,
        offset,
        empresa_id: empresaId
    });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

module.exports = {
    registrarMovimentacao,
    saldosPorLocal,
    listarLocais,
    historicoPorProduto,
    alertasEstoqueBaixo,
    listarMovimentacoesRelatorio
};

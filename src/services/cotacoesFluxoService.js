const AppError = require('../errors/AppError');
const repository = require('../repositories/cotacoesFluxoRepository');
const pedidosRepository = require('../repositories/pedidosCompraFluxoRepository');
const { hojeSP } = require('../utils/dataSaoPaulo');
const { totalDaOferta, melhorPorItem } = require('../utils/cotacoes');

const n = (v) => (v === null || v === undefined ? v : Number(v));

function visao({ cotacao, itens, fornecedores, ofertas }) {
    const ofertasVisao = ofertas.map((o) => ({
        id: n(o.id),
        cotacao_fornecedor_id: n(o.cotacao_fornecedor_id),
        fornecedor_id: n(o.fornecedor_id),
        cotacao_item_id: n(o.cotacao_item_id),
        quantidade_ofertada: n(o.quantidade_ofertada),
        preco_unitario: n(o.preco_unitario),
        desconto: n(o.desconto),
        prazo_entrega_dias: n(o.prazo_entrega_dias),
        condicao_pagamento: o.condicao_pagamento,
        total: totalDaOferta(o)
    }));
    const melhor = melhorPorItem(ofertasVisao);
    const fornecedorDe = new Map(fornecedores.map((f) => [n(f.id), n(f.fornecedor_id)]));

    return {
        id: n(cotacao.id),
        numero: cotacao.numero,
        status: cotacao.status,
        data_abertura: cotacao.data_abertura,
        data_limite: cotacao.data_limite,
        observacoes: cotacao.observacoes,
        itens: itens.map((i) => ({
            id: n(i.id), produto_id: n(i.produto_id), produto_nome: i.produto_nome, descricao_snapshot: i.descricao_snapshot,
            quantidade_solicitada: n(i.quantidade_solicitada), unidade: i.unidade,
            // aponta a melhor oferta (menor preço efetivo por unidade): só sugestão, a escolha é da pessoa
            melhor_fornecedor_id: melhor[n(i.id)] === undefined ? null : fornecedorDe.get(melhor[n(i.id)])
        })),
        fornecedores: fornecedores.map((f) => ({
            id: n(f.id), fornecedor_id: n(f.fornecedor_id), fornecedor_nome: f.fornecedor_nome, status: f.status, data_resposta: f.data_resposta
        })),
        ofertas: ofertasVisao
    };
}

async function obter(id, usuario) {
    const detalhe = await repository.detalhar(id, usuario.empresa_id);

    if (!detalhe) throw new AppError('Cotação não encontrada', 404);

    return visao(detalhe);
}

async function criar(dados, usuario) {
    const ids = [...new Set(dados.itens.map((i) => i.produto_id))];
    const produtos = new Map((await pedidosRepository.buscarProdutos(ids, usuario.empresa_id)).map((p) => [p.id, p]));
    const fornecedores = await repository.buscarFornecedores(dados.fornecedor_ids, usuario.empresa_id);

    if (fornecedores.length !== dados.fornecedor_ids.length) throw new AppError('Fornecedor não encontrado', 404);
    if (fornecedores.some((f) => f.ativo === false)) throw new AppError('Fornecedor inativo', 400);

    const itens = dados.itens.map((item) => {
        const produto = produtos.get(item.produto_id);

        if (!produto) throw new AppError('Produto não encontrado', 404);
        if (produto.ativo === false) throw new AppError(`Produto inativo: ${produto.nome}`, 400);

        return { produto_id: produto.id, descricao_snapshot: item.descricao || produto.nome, quantidade_solicitada: item.quantidade, unidade: produto.unidade || 'UN' };
    });
    const hoje = hojeSP();
    const id = await repository.criarComItens(
        { data_limite: dados.data_limite, observacoes: dados.observacoes }, itens, dados.fornecedor_ids,
        { empresa_id: usuario.empresa_id, usuario_id: usuario.id, ano: hoje.slice(0, 4), hoje }
    );

    return obter(id, usuario);
}

async function listar({ page, pageSize, status }, usuario) {
    const { rows, total } = await repository.listarPaginado({ empresa_id: usuario.empresa_id, status, page, pageSize });

    return { items: rows.map((r) => ({ ...r, id: n(r.id) })), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function registrarOferta(id, fornecedorId, dados, usuario) {
    await repository.registrarOferta(id, usuario.empresa_id, fornecedorId, dados.itens);

    return obter(id, usuario);
}

async function recusarFornecedor(id, fornecedorId, usuario) {
    await repository.recusarFornecedor(id, usuario.empresa_id, fornecedorId);

    return obter(id, usuario);
}

async function cancelar(id, usuario) {
    await repository.cancelar(id, usuario.empresa_id);

    return obter(id, usuario);
}

async function gerarPedidos(id, dados, usuario) {
    const hoje = hojeSP();
    const pedidos = await repository.gerarPedidos(id, usuario.empresa_id, dados.escolhas, { usuario_id: usuario.id, ano: hoje.slice(0, 4), hoje });

    return { cotacao: await obter(id, usuario), pedidos: pedidos.map((p) => ({ ...p, id: n(p.id), fornecedor_id: n(p.fornecedor_id), total: n(p.total) })) };
}

module.exports = { criar, obter, listar, registrarOferta, recusarFornecedor, cancelar, gerarPedidos };

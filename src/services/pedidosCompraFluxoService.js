const AppError = require('../errors/AppError');
const repository = require('../repositories/pedidosCompraFluxoRepository');
const { validarTransicao } = require('./pedidosCompraService');
const { hojeSP } = require('../utils/dataSaoPaulo');

const numero = (v) => (v === null || v === undefined ? v : Number(v));
// Colunas bigint chegam como texto do pg.
const idNumerico = (v) => (v === null || v === undefined ? v : Number(v));

function visaoPedido(pedido, itens) {
    const saida = {
        ...pedido,
        id: idNumerico(pedido.id),
        fornecedor_id: idNumerico(pedido.fornecedor_id),
        total: numero(pedido.total),
        frete_valor: numero(pedido.frete_valor),
        desconto: numero(pedido.desconto),
        outras_despesas: numero(pedido.outras_despesas)
    };

    if (itens) {
        saida.itens = itens.map((i) => ({
            ...i,
            id: idNumerico(i.id),
            pedido_compra_id: idNumerico(i.pedido_compra_id),
            produto_id: idNumerico(i.produto_id),
            quantidade: numero(i.quantidade),
            quantidade_recebida: numero(i.quantidade_recebida),
            preco_unitario: numero(i.preco_unitario),
            desconto: numero(i.desconto),
            saldo: numero(i.quantidade) - numero(i.quantidade_recebida)
        }));
    }

    return saida;
}

// Fornecedor e produtos precisam ser da empresa do JWT; produto inativo não entra no pedido.
async function prepararItens(dados, empresa_id) {
    const fornecedor = await repository.buscarFornecedor(dados.fornecedor_id, empresa_id);

    if (!fornecedor) throw new AppError('Fornecedor não encontrado', 404);
    if (fornecedor.ativo === false) throw new AppError('Fornecedor inativo', 400);

    const ids = [...new Set(dados.itens.map((i) => i.produto_id))];
    const produtos = new Map((await repository.buscarProdutos(ids, empresa_id)).map((p) => [p.id, p]));

    return dados.itens.map((item) => {
        const produto = produtos.get(item.produto_id);

        if (!produto) throw new AppError('Produto não encontrado', 404);
        if (produto.ativo === false) throw new AppError(`Produto inativo: ${produto.nome}`, 400);
        if ((item.desconto ?? 0) > item.quantidade * item.preco_unitario) {
            throw new AppError(`Desconto maior que o valor do item: ${produto.nome}`, 400);
        }

        return {
            produto_id: produto.id,
            descricao_snapshot: item.descricao || produto.nome,
            quantidade: item.quantidade,
            unidade: produto.unidade || 'UN',
            preco_unitario: item.preco_unitario,
            desconto: item.desconto ?? 0
        };
    });
}

function cabecalhoDe(dados) {
    const { itens: _itens, ...cabecalho } = dados;

    return cabecalho;
}

async function obter(id, usuario) {
    const detalhe = await repository.detalhar(id, usuario.empresa_id);

    if (!detalhe) throw new AppError('Pedido de compra não encontrado', 404);

    return visaoPedido(detalhe.pedido, detalhe.itens);
}

async function criar(dados, usuario) {
    const itens = await prepararItens(dados, usuario.empresa_id);
    const hoje = hojeSP();
    const id = await repository.criarComItens(cabecalhoDe(dados), itens, {
        empresa_id: usuario.empresa_id, usuario_id: usuario.id, ano: hoje.slice(0, 4), hoje
    });

    return obter(id, usuario);
}

async function atualizar(id, dados, usuario) {
    const itens = await prepararItens(dados, usuario.empresa_id);

    await repository.substituirRascunho(id, usuario.empresa_id, cabecalhoDe(dados), itens);

    return obter(id, usuario);
}

async function listar({ page, pageSize, status, fornecedor_id }, usuario) {
    const { rows, total } = await repository.listarPaginado({ empresa_id: usuario.empresa_id, status, fornecedor_id, page, pageSize });

    return {
        items: rows.map((p) => ({ ...p, id: idNumerico(p.id), fornecedor_id: idNumerico(p.fornecedor_id), total: numero(p.total) })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

// Sem etapa de aprovação interna: do rascunho direto para enviado (ou do aprovado, se a empresa usar o fluxo antigo).
async function enviar(id, usuario) {
    await repository.mudarStatus(id, usuario.empresa_id, (pedido) => {
        if (!['RASCUNHO', 'APROVADO'].includes(pedido.status)) {
            throw new AppError(`Só é possível enviar um pedido em rascunho (está ${pedido.status})`, 409);
        }
        return { status: 'ENVIADO', dados: { enviado_em: new Date().toISOString() } };
    });

    return obter(id, usuario);
}

async function confirmar(id, usuario) {
    await repository.mudarStatus(id, usuario.empresa_id, (pedido) => {
        validarTransicao(pedido.status, 'CONFIRMADO');
        return { status: 'CONFIRMADO', dados: { confirmado_em: new Date().toISOString() } };
    });

    return obter(id, usuario);
}

async function cancelar(id, usuario) {
    await repository.mudarStatus(id, usuario.empresa_id, (pedido) => {
        validarTransicao(pedido.status, 'CANCELADO');
        return { status: 'CANCELADO', dados: {} };
    });

    return obter(id, usuario);
}

module.exports = { criar, atualizar, listar, obter, enviar, confirmar, cancelar };

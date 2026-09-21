const vendasRepository = require('../repositories/vendasRepository');
const precosRepository = require('../repositories/precosRepository');
const AppError = require('../errors/AppError');

async function resumo(empresaId) {
    return vendasRepository.getResumo(empresaId);
}

async function porDia(empresaId) {
    return vendasRepository.getPorDia(empresaId);
}

async function porMes(empresaId) {
    return vendasRepository.getPorMes(empresaId);
}

async function maisVendidos(empresaId) {
    return vendasRepository.getMaisVendidosPeriodo(empresaId);
}

async function criar(dados, usuario_id, empresaId) {
    const { cliente_id, canal, pagamentos, forma_pagamento, meses_prazo, desconto, juros, itens } = dados;

    const canalRow = await precosRepository.buscarCanalPorNome(canal || 'loja_fisica', empresaId);

    if (!canalRow) {
        throw new AppError('Canal inválido', 400);
    }

    // Mantém o contrato antigo intacto quando a chamada não utiliza o núcleo
    // financeiro novo. Isso preserva consumidores e testes existentes durante
    // a migração do frontend.
    if (!pagamentos && forma_pagamento === undefined && meses_prazo === undefined && desconto === undefined && juros === undefined) {
        return vendasRepository.criar({
            cliente_id: cliente_id ?? null,
            canal_id: canalRow.id,
            usuario_id,
            empresa_id: empresaId,
            itens
        });
    }

    let pagamentosEfetivos = pagamentos;

    if (!pagamentosEfetivos) {
        const formaLegada = forma_pagamento === 'prazo' ? 'crediario' : 'dinheiro';
        pagamentosEfetivos = [{
            forma_pagamento: formaLegada,
            valor: null,
            numero_parcelas: 1,
            meses_prazo: formaLegada === 'crediario' ? meses_prazo : undefined,
            observacao: 'Pagamento criado pelo contrato legado'
        }];
    }

    return vendasRepository.criar({
        cliente_id: cliente_id ?? null,
        canal_id: canalRow.id,
        usuario_id,
        empresa_id: empresaId,
        pagamentos: pagamentosEfetivos,
        desconto: desconto ?? 0,
        juros: juros ?? 0,
        itens,
        ...(forma_pagamento !== undefined ? { forma_pagamento } : {}),
        ...(meses_prazo !== undefined ? { meses_prazo } : {})
    });
}
async function listar({ page, pageSize, status, canal, data_de, data_ate }, usuario) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const usuario_id = usuario.role === 'vendedor' ? usuario.id : undefined;

    const { items, total } = await vendasRepository.listarPaginado({
        limit,
        offset,
        usuario_id,
        empresa_id: usuario.empresa_id,
        status,
        canal,
        data_de,
        data_ate
    });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, usuario) {
    const venda = await vendasRepository.buscarPorId(id, usuario.empresa_id);

    if (!venda) {
        throw new AppError('Venda não encontrada', 404);
    }

    // Vendedor não pode ver vendas de outros usuários — tratamos como se não
    // existisse (404) em vez de 403, para não confirmar a existência do id.
    if (usuario.role === 'vendedor' && venda.usuario_id !== usuario.id) {
        throw new AppError('Venda não encontrada', 404);
    }

    return venda;
}

async function cancelar(id, usuario_id, empresaId) {
    return vendasRepository.cancelar(id, usuario_id, empresaId);
}

module.exports = {
    resumo,
    porDia,
    porMes,
    maisVendidos,
    criar,
    listar,
    buscarPorId,
    cancelar
};

const vendasRepository = require('../repositories/vendasRepository');
const precosRepository = require('../repositories/precosRepository');
const AppError = require('../errors/AppError');
const { podeVerVendasDeTodos } = require('./permissoesService');
const storage = require('./storage/imagensStorage');

// A chave do objeto no bucket nunca sai da API: o cliente recebe só a URL pública da foto do vendedor.
function comFotoDoVendedor(venda) {
    const { vendedor_foto_chave: chave, ...resto } = venda;

    return { ...resto, vendedor_foto_url: chave ? storage.urlPublica(chave) : null };
}

// Quem só enxerga as próprias vendas: perfil Vendedor (inclui os cargos novos) sem a
// capacidade `ver_vendas_de_todos`.
const veSomenteAsProprias = (usuario) => usuario.role === 'vendedor' && !podeVerVendasDeTodos(usuario);

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

async function criar({ cliente_id, canal, pagamentos, forma_pagamento, meses_prazo, desconto, juros, itens }, usuario_id, empresaId, idempotencyKey = null, somenteClientesDoUsuario = undefined) {
    const canalRow = await precosRepository.buscarCanalPorNome(canal || 'loja_fisica', empresaId);

    if (!canalRow) {
        throw new AppError('Canal inválido', 400);
    }

    // O contrato legado permanece intacto até o frontend migrar para
    // pagamentos[]. O novo núcleo financeiro só é acionado quando o payload
    // explicitamente envia pagamentos.
    return vendasRepository.criar({
        cliente_id: cliente_id ?? null,
        canal_id: canalRow.id,
        usuario_id,
        empresa_id: empresaId,
        itens,
        ...(pagamentos !== undefined ? { pagamentos } : {}),
        ...(desconto !== undefined ? { desconto } : {}),
        ...(juros !== undefined ? { juros } : {}),
        ...(forma_pagamento !== undefined ? { forma_pagamento } : {}),
        ...(meses_prazo !== undefined ? { meses_prazo } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        // Quem só vê os próprios clientes só vende para eles (o backend, não a tela, decide).
        ...(somenteClientesDoUsuario !== undefined ? { somente_clientes_do_usuario: somenteClientesDoUsuario } : {})
    });
}
async function listar({ page, pageSize, status, canal, data_de, data_ate }, usuario) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const usuario_id = veSomenteAsProprias(usuario) ? usuario.id : undefined;

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
        items: items.map(comFotoDoVendedor),
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
    if (veSomenteAsProprias(usuario) && venda.usuario_id !== usuario.id) {
        throw new AppError('Venda não encontrada', 404);
    }

    return comFotoDoVendedor(venda);
}

module.exports = {
    resumo,
    porDia,
    porMes,
    maisVendidos,
    criar,
    listar,
    buscarPorId
};

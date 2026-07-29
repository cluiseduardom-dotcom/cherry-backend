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

async function criar({ cliente_id, canal, itens }, usuario_id, empresaId) {
    const canalRow = await precosRepository.buscarCanalPorNome(canal || 'loja_fisica', empresaId);

    if (!canalRow) {
        throw new AppError('Canal inválido', 400);
    }

    return vendasRepository.criar({
        cliente_id: cliente_id ?? null,
        canal_id: canalRow.id,
        usuario_id,
        empresa_id: empresaId,
        itens
    });
}

async function listar({ page, pageSize }, usuario) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const usuario_id = usuario.role === 'vendedor' ? usuario.id : undefined;

    const { items, total } = await vendasRepository.listarPaginado({ limit, offset, usuario_id, empresa_id: usuario.empresa_id });

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

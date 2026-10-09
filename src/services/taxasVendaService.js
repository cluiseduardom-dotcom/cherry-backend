const taxasPlataformaRepository = require('../repositories/taxasPlataformaRepository');

// Consulta administrativa das taxas internas geradas nas vendas do tenant.
// empresa_id vem sempre do JWT (controller), nunca da requisição.
async function listar({ page, pageSize, data_inicio, data_fim }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total, totais } = await taxasPlataformaRepository.listarPaginado({
        limit,
        offset,
        empresa_id: empresaId,
        data_inicio,
        data_fim
    });

    return {
        items,
        totais,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

module.exports = { listar };

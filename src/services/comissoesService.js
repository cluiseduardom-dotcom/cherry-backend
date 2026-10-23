const comissoesRepository = require('../repositories/comissoesRepository');

// empresa_id e usuario_id vêm sempre do JWT (controller), nunca da requisição.

async function minhas({ page, pageSize, data_inicio, data_fim }, usuario) {
    const { items, total, totais } = await comissoesRepository.listarDoUsuario({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        empresa_id: usuario.empresa_id,
        usuario_id: usuario.id,
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

async function equipe({ data_inicio, data_fim }, empresaId) {
    return comissoesRepository.resumoEquipe({ empresa_id: empresaId, data_inicio, data_fim });
}

async function listarPercentuais(empresaId) {
    return comissoesRepository.listarPercentuais(empresaId);
}

async function definirPercentual({ usuario_id, percentual }, usuario) {
    return comissoesRepository.definirPercentual({
        empresa_id: usuario.empresa_id,
        usuario_id: usuario_id ?? null,
        percentual,
        atualizado_por: usuario.id
    });
}

module.exports = { minhas, equipe, listarPercentuais, definirPercentual };

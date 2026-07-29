const dashboardRepository = require('../repositories/dashboardRepository');
const precosRepository = require('../repositories/precosRepository');

async function curvaABC(empresaId) {
    return dashboardRepository.getCurvaABC(empresaId);
}

async function giro(dias, empresaId) {
    const rows = await dashboardRepository.getGiroECobertura(dias, empresaId);

    return rows.map(({ id, nome, estoque_atual, quantidade_vendida_periodo, giro: giroProduto }) => ({
        id, nome, estoque_atual, quantidade_vendida_periodo, giro: giroProduto
    }));
}

async function cobertura(dias, empresaId) {
    const rows = await dashboardRepository.getGiroECobertura(dias, empresaId);

    return rows.map(({ id, nome, estoque_atual, quantidade_vendida_periodo, cobertura_dias }) => ({
        id, nome, estoque_atual, quantidade_vendida_periodo, cobertura_dias
    }));
}

async function margem(empresaId) {
    return precosRepository.listarMargemPorProdutoECanal(empresaId);
}

async function resumo(dias, empresaId) {
    const [curva_abc, giroRows, coberturaRows, margemRows] = await Promise.all([
        curvaABC(empresaId),
        giro(dias, empresaId),
        cobertura(dias, empresaId),
        margem(empresaId)
    ]);

    return { curva_abc, giro: giroRows, cobertura: coberturaRows, margem: margemRows };
}

module.exports = {
    curvaABC,
    giro,
    cobertura,
    margem,
    resumo
};

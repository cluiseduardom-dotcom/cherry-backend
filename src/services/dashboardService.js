const dashboardRepository = require('../repositories/dashboardRepository');
const precosRepository = require('../repositories/precosRepository');

async function curvaABC() {
    return dashboardRepository.getCurvaABC();
}

async function giro(dias) {
    const rows = await dashboardRepository.getGiroECobertura(dias);

    return rows.map(({ id, nome, estoque_atual, quantidade_vendida_periodo, giro: giroProduto }) => ({
        id, nome, estoque_atual, quantidade_vendida_periodo, giro: giroProduto
    }));
}

async function cobertura(dias) {
    const rows = await dashboardRepository.getGiroECobertura(dias);

    return rows.map(({ id, nome, estoque_atual, quantidade_vendida_periodo, cobertura_dias }) => ({
        id, nome, estoque_atual, quantidade_vendida_periodo, cobertura_dias
    }));
}

async function margem() {
    return precosRepository.listarMargemPorProdutoECanal();
}

async function resumo(dias) {
    const [curva_abc, giroRows, coberturaRows, margemRows] = await Promise.all([
        curvaABC(),
        giro(dias),
        cobertura(dias),
        margem()
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

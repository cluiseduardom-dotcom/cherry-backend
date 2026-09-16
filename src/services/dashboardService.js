const dashboardRepository = require('../repositories/dashboardRepository');
const precosRepository = require('../repositories/precosRepository');
const niveisCategoriaRepository = require('../repositories/niveisCategoriaRepository');
const { agregarGrupo, agregarPorNivel, montarRankings, montarRupturas } = require('../utils/agregacaoGiroCobertura');

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

// Relatório agregado de giro/cobertura: total da empresa, quebra por nível
// de categoria e rankings de produto. Ver src/utils/agregacaoGiroCobertura.js
// pra regra de agregação (soma/soma, nunca média de razões).
async function giroCoberturaAgregado(dias, empresaId) {
    const [produtosRaw, vinculos, niveisExistentes, niveisRotulos] = await Promise.all([
        dashboardRepository.getVendasEstoquePorProduto(dias, empresaId),
        dashboardRepository.getVinculosCategoriasProdutos(empresaId),
        dashboardRepository.getNiveisExistentes(empresaId),
        niveisCategoriaRepository.listar(empresaId)
    ]);

    // SUM(iv.quantidade) volta como bigint (string) do pg — converter antes de
    // somar em JS evita concatenação de string ('5' + '20' = '520').
    const produtos = produtosRaw.map((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        estoque_atual: Number(p.estoque_atual),
        quantidade_vendida_periodo: Number(p.quantidade_vendida_periodo)
    }));

    const rotulosPorNivel = new Map(niveisRotulos.map((n) => [n.nivel, n.nome]));

    const total = agregarGrupo(produtos, dias);
    const por_nivel = agregarPorNivel(produtos, vinculos, niveisExistentes, rotulosPorNivel, dias);
    const { topGiro, menorGiro } = montarRankings(produtos, dias);
    const rupturas = montarRupturas(produtos);

    return { total, por_nivel, top_giro: topGiro, menor_giro: menorGiro, rupturas };
}

module.exports = {
    curvaABC,
    giro,
    cobertura,
    margem,
    resumo,
    giroCoberturaAgregado
};

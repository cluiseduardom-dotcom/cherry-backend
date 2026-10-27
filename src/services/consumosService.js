const consumosRepository = require('../repositories/consumosRepository');
const fichasVendaRepository = require('../repositories/fichasVendaRepository');

const listarInsumos = (empresaId) => consumosRepository.listarInsumos(empresaId);

const registrarAvulso = (dados, usuarioId, empresaId) =>
    consumosRepository.registrarAvulso({ ...dados, usuario_id: usuarioId, empresa_id: empresaId });

async function listarAvulsos(filtros, paginacao, empresaId) {
    const { page, pageSize } = paginacao;
    const resultado = await consumosRepository.listarAvulsos({
        empresa_id: empresaId, ...filtros, limit: pageSize, offset: (page - 1) * pageSize
    });

    return { ...resultado, page, pageSize };
}

const linhasDaVenda = (vendaId, empresaId) => consumosRepository.linhasDaVenda(vendaId, empresaId);

const acrescentarNaVenda = (vendaId, dados, usuarioId, empresaId) =>
    consumosRepository.acrescentarNaVenda({ venda_id: vendaId, ...dados, usuario_id: usuarioId, empresa_id: empresaId });

const retirarLinha = (vendaId, consumoId, usuarioId, empresaId) =>
    consumosRepository.retirarLinha({ venda_id: vendaId, consumo_id: consumoId, usuario_id: usuarioId, empresa_id: empresaId });

const regularizarLinha = (vendaId, consumoId, usuarioId, empresaId) =>
    consumosRepository.regularizarLinha({ venda_id: vendaId, consumo_id: consumoId, usuario_id: usuarioId, empresa_id: empresaId });

const previaSubstituicao = (deInsumoId, empresaId) => fichasVendaRepository.previaSubstituicao(deInsumoId, empresaId);

const substituirInsumo = (dados, usuarioId, empresaId) =>
    fichasVendaRepository.substituirInsumoEmLote({ ...dados, usuario_id: usuarioId, empresa_id: empresaId });

// Soma em centavos inteiros (sem erro de ponto flutuante) por motivo e no total.
function totalizar(linhas) {
    const porMotivo = new Map();
    let totalCentavos = 0;

    for (const linha of linhas) {
        const centavos = Math.round(Number(linha.custo_total) * 100);
        totalCentavos += centavos;
        const atual = porMotivo.get(linha.motivo) ?? { motivo: linha.motivo, quantidade: 0, centavos: 0 };
        atual.quantidade += linha.quantidade;
        atual.centavos += centavos;
        porMotivo.set(linha.motivo, atual);
    }

    return {
        por_motivo: [...porMotivo.values()].map((m) => ({ motivo: m.motivo, quantidade: m.quantidade, custo_total: m.centavos / 100 })),
        custo_total: totalCentavos / 100
    };
}

async function relatorio(filtros, empresaId) {
    const linhas = await consumosRepository.relatorio({ empresa_id: empresaId, ...filtros });

    return {
        itens: linhas.map((l) => ({ ...l, custo_total: Number(l.custo_total) })),
        totais: totalizar(linhas)
    };
}

module.exports = {
    listarInsumos, registrarAvulso, listarAvulsos, linhasDaVenda, acrescentarNaVenda, retirarLinha,
    regularizarLinha, previaSubstituicao, substituirInsumo, relatorio, totalizar
};

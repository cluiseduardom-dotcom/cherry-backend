// Regras PURAS dos avisos de produção no sino (sem banco). (1) Uma linha por insumo com baixa pendente em ordens de produção
// concluídas (a regra do PO: produzir mesmo sem o insumo ter dado entrada; a baixa fica pendente até "Regularizar insumos").
// Só para quem repõe estoque (administrador e estoquista) e só com a funcionalidade `pcp`. Nunca traz custo.

const TIPO_INSUMO_PENDENTE_PRODUCAO = 'insumo_pendente_producao';

const num = (v) => Number(v);

// Quantidade na unidade-base inteira (g, ml) em linguagem de gente: 250 g, 1,25 kg, 2 L; as demais unidades seguem como número.
function quantidadeLegivel(quantidade, unidade) {
    const n = num(quantidade);
    const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

    if (unidade === 'G') return n >= 1000 ? `${fmt(n / 1000)} kg` : `${fmt(n)} g`;
    if (unidade === 'ML') return n >= 1000 ? `${fmt(n / 1000)} L` : `${fmt(n)} ml`;

    return `${fmt(n)} un.`;
}

// pendencias: { produto_id, sku, nome, unidade, quantidade_pendente, ordens } por insumo.
function montarNotificacoesProducao(pendencias, perfil) {
    if (!perfil.administrador && !perfil.estoquista) return [];

    return pendencias.map((p) => {
        const ordens = num(p.ordens);
        const nome = p.sku ? `${p.nome} (SKU ${p.sku})` : p.nome;

        return {
            id: `${TIPO_INSUMO_PENDENTE_PRODUCAO}:${p.produto_id}`,
            tipo: TIPO_INSUMO_PENDENTE_PRODUCAO,
            prioridade: 'alta',
            produto_id: p.produto_id,
            sku: p.sku || null,
            nome: p.nome,
            titulo: 'Insumo pendente na produção',
            mensagem: `${nome} ficou sem baixa em ${ordens} ordem(ns) de produção: ${quantidadeLegivel(p.quantidade_pendente, p.unidade)}.`,
            acao: 'Dar entrada do insumo e usar "Regularizar insumos" na ordem, em Produção.',
            dados: { quantidade_pendente: num(p.quantidade_pendente), ordens }
        };
    });
}

// (2) Ordens de produção ainda não concluídas depois do prazo (planejada ou em produção). O "dia" é o de São Paulo (a consulta calcula
// `dias_atraso`). Mais de uma semana de atraso sobe para prioridade alta.
const TIPO_ORDEM_ATRASADA = 'ordem_producao_atrasada';
const LIMITE_ATRASO_ALTA_DIAS = 7;

const dataCurta = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : String(iso));

// ordens: { id, produto_id, sku, nome, quantidade_planejada, status, prazo (AAAA-MM-DD), dias_atraso }
function montarNotificacoesOrdensAtrasadas(ordens, perfil) {
    if (!perfil.administrador && !perfil.estoquista) return [];

    return ordens.map((o) => {
        const dias = num(o.dias_atraso);
        const situacao = o.status === 'em_producao' ? 'está em produção' : 'ainda não foi iniciada';

        return {
            id: `${TIPO_ORDEM_ATRASADA}:${o.id}`,
            tipo: TIPO_ORDEM_ATRASADA,
            prioridade: dias > LIMITE_ATRASO_ALTA_DIAS ? 'alta' : 'media',
            produto_id: o.produto_id,
            sku: o.sku || null,
            nome: o.nome,
            titulo: 'Ordem de produção atrasada',
            mensagem: `A ordem #${o.id} (${o.nome}, ${num(o.quantidade_planejada)} un.) ${situacao} e está ${dias} dia(s) atrasada: o prazo era ${dataCurta(o.prazo)}.`,
            acao: 'Abrir a ordem em Produção: concluir, ajustar o planejamento ou cancelar.',
            dados: { ordem_id: num(o.id), dias_atraso: dias, prazo: o.prazo, status: o.status }
        };
    });
}

module.exports = {
    montarNotificacoesProducao, montarNotificacoesOrdensAtrasadas, quantidadeLegivel,
    TIPO_INSUMO_PENDENTE_PRODUCAO, TIPO_ORDEM_ATRASADA, LIMITE_ATRASO_ALTA_DIAS
};

const comissoesRepository = require('../repositories/comissoesRepository');
const pagamentosRepository = require('../repositories/comissaoPagamentosRepository');
const { temCapacidade } = require('./permissoesService');
const { CAPACIDADES } = require('../constants/cargos');

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

const veTodos = (usuario) => temCapacidade(usuario, CAPACIDADES.VER_VENDAS_DE_TODOS);
// Repasses e pagamentos: o financeiro vê os da empresa mesmo se o cargo dele não vê as vendas de todos.
const veDinheiroDeTodos = (usuario) => veTodos(usuario) || temCapacidade(usuario, CAPACIDADES.GERIR_FINANCEIRO);

// Quem tem `ver_vendas_de_todos` ou `gerir_financeiro` vê os repasses da empresa; os demais,
// só os próprios (usuário do JWT).
async function repasses({ page, pageSize, status }, usuario) {
    const { items, total, totais } = await comissoesRepository.listarRepasses({
        empresa_id: usuario.empresa_id,
        vendedor_id: veDinheiroDeTodos(usuario) ? undefined : usuario.id,
        status,
        limit: pageSize,
        offset: (page - 1) * pageSize
    });

    return { items, totais, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function confirmarRepasse(id, { observacao }, usuario) {
    return comissoesRepository.confirmarRepasse({
        id,
        empresa_id: usuario.empresa_id,
        confirmado_por: usuario.id,
        observacao
    });
}

async function historico(comissaoId, usuario) {
    return comissoesRepository.historicoDaComissao({
        empresa_id: usuario.empresa_id,
        comissao_id: comissaoId,
        usuario_id: veTodos(usuario) ? undefined : usuario.id
    });
}

// Só quem tem gerir_financeiro chama (rota); empresa_id e quem paga vêm do JWT.
async function aPagar(empresaId) {
    const items = await pagamentosRepository.resumoAPagar(empresaId);
    const totalCentavos = items.reduce((soma, i) => soma + Math.round(Number(i.a_pagar) * 100), 0);

    return { items, totais: { a_pagar: (totalCentavos / 100).toFixed(2) } };
}

async function registrarPagamento(dados, usuario) {
    return pagamentosRepository.registrarPagamento({
        empresa_id: usuario.empresa_id,
        vendedor_id: dados.vendedor_id,
        criado_por: usuario.id,
        valor_esperado: dados.valor_esperado,
        forma: dados.forma,
        pago_em: dados.pago_em,
        observacao: dados.observacao
    });
}

// Quem tem `ver_vendas_de_todos` ou `gerir_financeiro` vê os pagamentos da empresa (ou de um vendedor, com filtro);
// os demais, só os próprios (usuário do JWT) — o filtro do cliente é ignorado para eles.
async function pagamentos({ page, pageSize, vendedor_id }, usuario) {
    const { items, total, totais } = await pagamentosRepository.listarPagamentos({
        empresa_id: usuario.empresa_id,
        vendedor_id: veDinheiroDeTodos(usuario) ? vendedor_id : usuario.id,
        limit: pageSize,
        offset: (page - 1) * pageSize
    });

    return { items, totais, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = {
    minhas, equipe, listarPercentuais, definirPercentual, repasses, confirmarRepasse, historico,
    aPagar, registrarPagamento, pagamentos
};

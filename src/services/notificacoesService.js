const notificacoesRepository = require('../repositories/notificacoesRepository');
const { montarNotificacoes } = require('../utils/notificacoes');
const { temCapacidade } = require('./permissoesService');
const { CAPACIDADES } = require('../constants/cargos');

// Calculadas na hora (sem tabela): o sino sempre reflete o estoque e as vendas atuais.
// empresa_id vem do JWT; o perfil decide quais tipos de aviso a pessoa recebe.
async function listar(usuario) {
    const perfil = {
        administrador: temCapacidade(usuario, CAPACIDADES.ADMINISTRADOR),
        estoquista: usuario.role === 'estoquista'
    };

    const produtos = await notificacoesRepository.listarBaseDeProdutos(usuario.empresa_id);
    // Só quem recebe esse tipo de aviso (admin/estoquista) paga a consulta de pendências.
    const pendencias = perfil.administrador || perfil.estoquista
        ? await notificacoesRepository.listarPendenciasDeInsumo(usuario.empresa_id)
        : [];
    const itens = montarNotificacoes(produtos, perfil, pendencias);

    return { total: itens.length, itens };
}

module.exports = { listar };

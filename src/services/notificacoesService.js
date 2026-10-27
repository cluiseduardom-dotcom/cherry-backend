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
    const itens = montarNotificacoes(produtos, perfil);

    return { total: itens.length, itens };
}

module.exports = { listar };

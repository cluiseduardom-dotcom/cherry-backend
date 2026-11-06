const notificacoesRepository = require('../repositories/notificacoesRepository');
const { montarNotificacoes } = require('../utils/notificacoes');
const { montarNotificacoesMaleta } = require('../utils/notificacoesMaleta');
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
    // Avisos de maleta só para empresas com a funcionalidade `maletas` ligada (lista vem da sessão).
    const comMaletas = Array.isArray(usuario.funcionalidades) && usuario.funcionalidades.includes('maletas');
    let extras = [];
    if (comMaletas) {
        const [maletas, pendentes] = await Promise.all([
            notificacoesRepository.listarBaseDeMaletas(usuario.empresa_id),
            notificacoesRepository.listarTransferenciasPendentes(usuario.empresa_id)
        ]);
        extras = montarNotificacoesMaleta({ maletas, pendentes }, perfil, usuario.id);
    }
    const itens = montarNotificacoes(produtos, perfil, pendencias, extras);

    return { total: itens.length, itens };
}

module.exports = { listar };

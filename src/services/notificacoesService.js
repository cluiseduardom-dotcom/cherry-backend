const notificacoesRepository = require('../repositories/notificacoesRepository');
const { montarNotificacoes } = require('../utils/notificacoes');
const { montarNotificacoesMaleta } = require('../utils/notificacoesMaleta');
const empresaRepository = require('../repositories/empresaRepository');
const { vocabularioEstoque } = require('../constants/vocabularioEstoque');
const { montarNotificacoesProducao, montarNotificacoesOrdensAtrasadas } = require('../utils/notificacoesProducao');
const { montarNotificacoesLoja } = require('../utils/notificacoesLoja');
const lojaGestaoRepository = require('../repositories/lojaGestaoRepository');
const { temCapacidade } = require('./permissoesService');
const suspensaoPixService = require('./suspensaoPixService');
const { montarNotificacoesCobranca } = require('../utils/notificacoesCobranca');
const { CAPACIDADES } = require('../constants/cargos');

// Calculadas na hora (sem tabela): o sino sempre reflete o estoque e as vendas atuais.
// empresa_id vem do JWT; o perfil decide quais tipos de aviso a pessoa recebe.
async function listar(usuario) {
    const perfil = {
        administrador: temCapacidade(usuario, CAPACIDADES.ADMINISTRADOR),
        estoquista: usuario.role === 'estoquista',
        vendedor: usuario.role === 'vendedor'
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
        const [maletas, pendentes, rotulo] = await Promise.all([
            notificacoesRepository.listarBaseDeMaletas(usuario.empresa_id),
            notificacoesRepository.listarTransferenciasPendentes(usuario.empresa_id),
            empresaRepository.obterRotuloEstoqueVendedor(usuario.empresa_id)
        ]);
        extras = montarNotificacoesMaleta({ maletas, pendentes }, perfil, usuario.id, vocabularioEstoque(rotulo));
    }
    // Avisos de produção (insumo pendente e ordem atrasada): só com a funcionalidade `pcp` e só para quem repõe estoque (admin e estoquista).
    const comPcp = Array.isArray(usuario.funcionalidades) && usuario.funcionalidades.includes('pcp');
    if (comPcp && (perfil.administrador || perfil.estoquista)) {
        const [pendentesProducao, ordensAtrasadas] = await Promise.all([
            notificacoesRepository.listarPendenciasDeProducao(usuario.empresa_id),
            notificacoesRepository.listarOrdensAtrasadas(usuario.empresa_id)
        ]);
        extras = [...extras, ...montarNotificacoesProducao(pendentesProducao, perfil), ...montarNotificacoesOrdensAtrasadas(ordensAtrasadas, perfil)];
    }
    // Avisos da loja online só para empresas com a funcionalidade `loja_online` ligada, e só para quem fala com a cliente
    // (administrador e vendedor): trazem nome e telefone dela.
    const comLoja = Array.isArray(usuario.funcionalidades) && usuario.funcionalidades.includes('loja_online');
    if (comLoja && (perfil.administrador || perfil.vendedor)) {
        extras = [...extras, ...montarNotificacoesLoja(await lojaGestaoRepository.listarParaAvisos(usuario.empresa_id), perfil)];
    }
    const itens = montarNotificacoes(produtos, perfil, pendencias, extras);

    // Cobrança da plataforma: só o administrador, só com a suspensão do Pix ligada. Vem ANTES e FORA do teto de 50 itens: um
    // aviso de suspensão do Pix nunca pode ser cortado por alertas de estoque. Opcional: se a conta falhar, o sino segue
    // sem ele (estoque e giro não dependem disto).
    const cobranca = await avisosDeCobranca(usuario, perfil);

    return { total: cobranca.length + itens.length, itens: [...cobranca, ...itens] };
}

async function avisosDeCobranca(usuario, perfil) {
    if (!perfil.administrador) return [];

    try {
        return montarNotificacoesCobranca(await suspensaoPixService.situacao(usuario.empresa_id), perfil);
    } catch (erro) {
        console.error(`Sino: não foi possível montar o aviso de cobrança da empresa ${usuario.empresa_id}: ${erro.message}`);
        return [];
    }
}

module.exports = { listar };

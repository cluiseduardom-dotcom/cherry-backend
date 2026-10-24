const AppError = require('../errors/AppError');
const repo = require('../repositories/locaisEstoqueRepository');
const { ehEquipe, podeVerLocal } = require('./shared/locaisEstoquePermissao');

// Equipe: todos os locais ativos (menos o Em trânsito, que é interno). Demais: o Central (só
// identificação, para devolver e vender; o saldo dele segue restrito à equipe) e a própria maleta.
async function listar(usuario) {
    return repo.listarVisiveis({
        empresa_id: usuario.empresa_id,
        usuario_id: ehEquipe(usuario) ? undefined : usuario.id
    });
}

async function saldos(local_id, { busca, page, pageSize }, usuario) {
    const local = await repo.obterLocal(usuario.empresa_id, local_id);

    if (!podeVerLocal(local, usuario) || local.tipo === 'transito') {
        throw new AppError('Local de estoque não encontrado', 404);
    }

    const { items, total } = await repo.saldosDoLocal({
        empresa_id: usuario.empresa_id,
        local_id,
        busca,
        limit: pageSize,
        offset: (page - 1) * pageSize
    });

    return {
        local: { id: local.id, tipo: local.tipo, nome: local.nome, usuario_id: local.usuario_id },
        items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

module.exports = { listar, saldos };

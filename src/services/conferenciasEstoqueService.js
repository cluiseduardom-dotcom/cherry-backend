const AppError = require('../errors/AppError');
const repo = require('../repositories/conferenciasEstoqueRepository');

const { ehEquipe, podeVerLocal } = require('./shared/locaisEstoquePermissao');

// Fora da regra de visibilidade, 404 (não confirma que o local existe).
async function localVisivel(local_id, usuario) {
    const local = await repo.obterLocal(usuario.empresa_id, local_id);

    if (!podeVerLocal(local, usuario)) throw new AppError('Local de estoque não encontrado', 404);

    return local;
}

async function acerto(local_id, { desde }, usuario) {
    const local = await localVisivel(local_id, usuario);
    const resultado = await repo.acerto({ empresa_id: usuario.empresa_id, local_id, desde });

    return {
        local: { id: local.id, tipo: local.tipo, nome: local.nome, usuario_id: local.usuario_id },
        desde: desde ?? null,
        ...resultado
    };
}

async function criarConferencia(local_id, dados, usuario) {
    if (!ehEquipe(usuario)) throw new AppError('Apenas a equipe de estoque pode registrar conferências', 403);
    if (dados.aplicar_ajuste && usuario.role !== 'admin') {
        throw new AppError('Apenas o administrador pode aplicar o ajuste de uma conferência', 403);
    }

    return repo.criarConferencia({
        empresa_id: usuario.empresa_id,
        local_id,
        usuario_id: usuario.id,
        itens: dados.itens,
        observacao: dados.observacao,
        aplicar_ajuste: dados.aplicar_ajuste
    });
}

async function listarConferencias(local_id, { page, pageSize }, usuario) {
    await localVisivel(local_id, usuario);

    const { items, total } = await repo.listarConferencias({
        empresa_id: usuario.empresa_id,
        local_id,
        limit: pageSize,
        offset: (page - 1) * pageSize
    });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { acerto, criarConferencia, listarConferencias };

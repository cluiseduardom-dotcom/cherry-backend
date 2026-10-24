const AppError = require('../errors/AppError');
const repo = require('../repositories/transferenciasEstoqueRepository');

// Equipe de estoque: administra o Central, os consignados e as transferências de qualquer local.
const ehEquipe = (usuario) => usuario.role === 'admin' || usuario.role === 'estoquista';
const ehDono = (local, usuario) => local?.tipo === 'maleta' && local.usuario_id === usuario.id;

async function criar(dados, usuario) {
    const id = await repo.criar({
        empresa_id: usuario.empresa_id,
        usuario_id: usuario.id,
        origem_local_id: dados.origem_local_id,
        destino_local_id: dados.destino_local_id,
        itens: dados.itens,
        observacao: dados.observacao,
        // Equipe: qualquer rota. Os demais: só devolver da PRÓPRIA maleta ao Central.
        autorizar: (origem, destino) => {
            if (ehEquipe(usuario)) return;
            if (ehDono(origem, usuario) && destino.tipo === 'central') return;
            throw new AppError('Você só pode devolver mercadoria da sua própria maleta para o Central', 403);
        }
    });

    return repo.obter(usuario.empresa_id, id);
}

// Quem recebe decide: dono da maleta, quando o destino é maleta; equipe nos demais destinos.
function podeResponder(t, usuario) {
    return t.destino?.tipo === 'maleta' ? ehDono(t.destino, usuario) : ehEquipe(usuario);
}

async function resolver(acao, id, motivo, usuario) {
    await repo.resolver({
        empresa_id: usuario.empresa_id,
        id,
        acao,
        usuario_id: usuario.id,
        motivo,
        autorizar: (t) => {
            if (acao === 'cancelar') {
                if (t.criado_por === usuario.id || usuario.role === 'admin') return;
                throw new AppError('Só quem criou a transferência (ou o administrador) pode cancelá-la', 403);
            }
            if (!podeResponder(t, usuario)) {
                throw new AppError('Você não pode responder a esta transferência', 403);
            }
        }
    });

    return repo.obter(usuario.empresa_id, id);
}

async function obter(id, usuario) {
    const t = await repo.obter(usuario.empresa_id, id);
    const visivel = t && (ehEquipe(usuario) || t.criado_por === usuario.id
        || t.origem_usuario_id === usuario.id || t.destino_usuario_id === usuario.id);

    if (!visivel) throw new AppError('Transferência não encontrada', 404);

    return t;
}

async function listar({ status, page, pageSize }, usuario) {
    const { items, total } = await repo.listar({
        empresa_id: usuario.empresa_id,
        status,
        usuario_id: ehEquipe(usuario) ? undefined : usuario.id,
        limit: pageSize,
        offset: (page - 1) * pageSize
    });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function criarLocal(dados, usuario) {
    return repo.criarLocal({ ...dados, empresa_id: usuario.empresa_id });
}

module.exports = { criar, resolver, obter, listar, criarLocal };

const categoriasRepository = require('../repositories/categoriasRepository');
const AppError = require('../errors/AppError');

async function listar({ page, pageSize }, empresaId, escopo = 'produto') {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await categoriasRepository.listarPaginado({ limit, offset, empresa_id: empresaId, escopo });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function criar(dados, empresaId) {
    const escopo = dados.escopo ?? 'produto';
    const codigo = dados.codigo.toUpperCase();
    const existente = await categoriasRepository.buscarPorCodigoNivel(dados.nivel, codigo, empresaId, escopo);

    if (existente) {
        throw new AppError('Já existe uma categoria com esse código neste nível', 409);
    }

    if (dados.configuracao_sku_id != null) {
        const configuracao = await require('../repositories/configuracoesSkuRepository').listar(empresaId, undefined, escopo);
        if (!configuracao.some((item) => item.id === dados.configuracao_sku_id)) {
            throw new AppError('Padrão de SKU inválido para esta empresa', 400);
        }
    }

    try {
        return await categoriasRepository.criar({ nivel: dados.nivel, codigo, nome: dados.nome, configuracao_sku_id: dados.configuracao_sku_id, empresa_id: empresaId, escopo });
    } catch (error) {
        if (error.code === '23505') {
            throw new AppError('Já existe uma categoria com esse código neste nível', 409);
        }
        throw error;
    }
}

async function atualizar(id, dados, empresaId) {
    if (dados.configuracao_sku_id != null) {
        const categoria = await categoriasRepository.buscarPorId(id, empresaId);
        if (!categoria) {
            throw new AppError('Categoria não encontrada', 404);
        }
        const configuracoes = await require('../repositories/configuracoesSkuRepository').listar(empresaId, undefined, categoria.escopo);
        if (!configuracoes.some((item) => item.id === dados.configuracao_sku_id)) {
            throw new AppError('Padrão de SKU inválido para esta empresa', 400);
        }
    }

    const atualizado = await categoriasRepository.atualizar(id, dados, empresaId);

    if (!atualizado) {
        throw new AppError('Categoria não encontrada', 404);
    }

    return atualizado;
}

async function remover(id, empresaId) {
    const removido = await categoriasRepository.softDelete(id, empresaId);

    if (!removido) {
        throw new AppError('Categoria não encontrada', 404);
    }

    return removido;
}

module.exports = { listar, criar, atualizar, remover };

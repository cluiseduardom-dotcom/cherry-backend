const crypto = require('node:crypto');
const produtosRepository = require('../repositories/produtosRepository');
const produtoImagensRepository = require('../repositories/produtoImagensRepository');
const storage = require('./storage/imagensStorage');
const AppError = require('../errors/AppError');
const { MAX_BYTES, MAX_IMAGENS_POR_PRODUTO, detectarTipo, extensaoDoTipo } = require('../utils/imagemProduto');

function paraResposta(linha) {
    return {
        id: linha.id,
        url: storage.urlPublica(linha.chave),
        ordem: linha.ordem,
        principal: linha.ordem === 0,
        content_type: linha.content_type,
        tamanho_bytes: linha.tamanho_bytes
    };
}

async function garantirProduto(produtoId, empresaId) {
    const produto = await produtosRepository.buscarPorId(produtoId, empresaId);
    if (!produto) throw new AppError('Produto não encontrado', 404);
}

async function listar(produtoId, empresaId) {
    await garantirProduto(produtoId, empresaId);
    return (await produtoImagensRepository.listarPorProduto(produtoId, empresaId)).map(paraResposta);
}

// `arquivo` vem do multer (memória): { buffer, size }. A chave é gerada aqui e leva o empresa_id do JWT,
// nunca algo vindo do cliente (nem o nome do arquivo).
async function adicionar(produtoId, arquivo, empresaId, usuarioId) {
    if (!storage.configurado()) {
        throw new AppError('Armazenamento de fotos não configurado neste ambiente', 412);
    }

    if (!arquivo || !arquivo.buffer || !arquivo.buffer.length) {
        throw new AppError('Envie a foto no campo "arquivo"', 400);
    }

    if (arquivo.buffer.length > MAX_BYTES) {
        throw new AppError(`A foto deve ter no máximo ${MAX_BYTES / (1024 * 1024)} MB`, 413);
    }

    const contentType = detectarTipo(arquivo.buffer);
    if (!contentType) {
        throw new AppError('Formato inválido: envie uma foto JPEG, PNG ou WebP', 400);
    }

    await garantirProduto(produtoId, empresaId);

    const chave = `${empresaId}/produtos/${produtoId}/${crypto.randomUUID()}.${extensaoDoTipo(contentType)}`;

    await storage.enviar({ chave, buffer: arquivo.buffer, contentType });

    try {
        const linha = await produtoImagensRepository.inserir({
            produto_id: produtoId,
            empresa_id: empresaId,
            chave,
            content_type: contentType,
            tamanho_bytes: arquivo.buffer.length,
            criado_por: usuarioId,
            limite: MAX_IMAGENS_POR_PRODUTO
        });

        return paraResposta(linha);
    } catch (erro) {
        // O objeto já foi enviado, mas a linha não entrou (galeria cheia, produto sumiu...): não deixa lixo no bucket.
        await storage.remover(chave).catch(() => {});
        throw erro;
    }
}

async function remover(produtoId, imagemId, empresaId) {
    const removida = await produtoImagensRepository.remover(imagemId, produtoId, empresaId);

    // A linha já saiu do banco; se o bucket falhar, sobra um objeto órfão (sem link, inofensivo) e não a foto quebrada.
    if (storage.configurado()) {
        await storage.remover(removida.chave).catch(() => {});
    }

    return { id: removida.id };
}

async function reordenar(produtoId, ids, empresaId) {
    const linhas = await produtoImagensRepository.reordenar(produtoId, empresaId, ids);
    return linhas.map(paraResposta);
}

module.exports = { listar, adicionar, remover, reordenar, paraResposta };

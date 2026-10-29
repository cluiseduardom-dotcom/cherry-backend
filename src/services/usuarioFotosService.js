const crypto = require('node:crypto');
const AppError = require('../errors/AppError');
const usuariosRepository = require('../repositories/usuariosRepository');
const usuariosFotosRepository = require('../repositories/usuariosFotosRepository');
const usuariosService = require('./usuariosService');
const storage = require('./storage/imagensStorage');
const { MAX_BYTES, detectarTipo, extensaoDoTipo } = require('../utils/imagemProduto');

// Foto de perfil. O ator (JWT) escolhe o alvo: a própria foto (qualquer cargo) ou a de quem ele pode
// gerenciar (mesma hierarquia da edição de dados: nunca Admin por aqui, só cargo abaixo do seu nível).
// empresa_id vem sempre do JWT; a chave no bucket é gerada aqui e nunca depende do nome enviado.

function urlDaChave(chave) {
    return chave ? storage.urlPublica(chave) : null;
}

function autorizador(ator) {
    return (alvo) => {
        if (alvo.id === ator.id) return;

        usuariosService.garantirPodeGerenciar(ator, alvo);
    };
}

async function carregarAlvoAutorizado(alvoId, ator) {
    const alvo = await usuariosRepository.obterDetalhe(ator.empresa_id, alvoId);

    if (!alvo) {
        throw new AppError('Usuário não encontrado', 404);
    }

    autorizador(ator)(alvo);
}

// `arquivo` vem do multer (memória): { buffer }.
async function definir(alvoId, arquivo, ator) {
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

    // Autoriza ANTES de enviar ao bucket (não deixa objeto órfão por pedido negado); o repository
    // reavalia sob o lock da linha do usuário.
    await carregarAlvoAutorizado(alvoId, ator);

    const chave = `${ator.empresa_id}/usuarios/${alvoId}/${crypto.randomUUID()}.${extensaoDoTipo(contentType)}`;

    await storage.enviar({ chave, buffer: arquivo.buffer, contentType });

    let resultado;

    try {
        resultado = await usuariosFotosRepository.definir({
            empresa_id: ator.empresa_id,
            usuario_id: alvoId,
            chave,
            content_type: contentType,
            tamanho_bytes: arquivo.buffer.length,
            executado_por: ator.id,
            autorizar: autorizador(ator)
        });
    } catch (erro) {
        await storage.remover(chave).catch(() => {});
        throw erro;
    }

    // A linha já aponta para a foto nova; se o bucket falhar, sobra um objeto órfão sem link (inofensivo).
    if (resultado.chave_anterior) {
        await storage.remover(resultado.chave_anterior).catch(() => {});
    }

    return { foto_url: urlDaChave(chave) };
}

async function remover(alvoId, ator) {
    const { chave } = await usuariosFotosRepository.remover({
        empresa_id: ator.empresa_id,
        usuario_id: alvoId,
        executado_por: ator.id,
        autorizar: autorizador(ator)
    });

    if (chave && storage.configurado()) {
        await storage.remover(chave).catch(() => {});
    }

    return { foto_url: null };
}

module.exports = { definir, remover, urlDaChave };

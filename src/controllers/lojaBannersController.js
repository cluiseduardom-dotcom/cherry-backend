const crypto = require('node:crypto');
const repository = require('../repositories/lojaBannersRepository');
const storage = require('../services/storage/imagensStorage');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { detectarTipo, extensaoDoTipo } = require('../utils/imagemProduto');
const { bannerSchema } = require('../validations/lojaValidation');

const ID = /^[1-9]\d{0,9}$/;

function parseId(valor) {
    if (!ID.test(String(valor))) throw new AppError('Faixa não encontrada', 404);
    return Number(valor);
}

function parseLado(valor) {
    if (!(valor in repository.LADOS)) throw new AppError('Lado inválido (esquerda ou direita)', 400);
    return valor;
}

function paraResposta(b) {
    return {
        id: b.id, ordem: b.ordem, ativo: b.ativo, usa_retrato: b.usa_retrato, fundo: b.fundo,
        rotulo: b.rotulo, titulo: b.titulo, destaque: b.destaque, subtitulo: b.subtitulo, botao_texto: b.botao_texto, link: b.link,
        rodape_texto: b.rodape_texto, inicio_em: b.inicio_em, fim_em: b.fim_em,
        imagem_esquerda: b.imagem_esquerda_chave ? storage.urlPublica(b.imagem_esquerda_chave) : null,
        imagem_direita: b.imagem_direita_chave ? storage.urlPublica(b.imagem_direita_chave) : null
    };
}

// Gestão (admin + loja_online; ver app.js). Nunca em cache: o admin precisa ver o estado atual.
async function listar(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, (await repository.listar(req.usuario.empresa_id)).map(paraResposta));
    } catch (error) { next(error); }
}

async function criar(req, res, next) {
    try {
        const corpo = bannerSchema.safeParse(req.body ?? {});

        if (!corpo.success) throw new AppError(corpo.error.issues[0].message, 400);
        if (corpo.data.ativo) throw new AppError('A faixa nasce desligada: preencha e ative depois', 400);

        const { ordem, ativo, ...resto } = corpo.data; // ordem e ativo não se definem na criação
        return response.success(res, paraResposta(await repository.criar(req.usuario.empresa_id, req.usuario.id, resto)), 201);
    } catch (error) { next(error); }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const corpo = bannerSchema.safeParse(req.body ?? {});

        if (!corpo.success) throw new AppError(corpo.error.issues[0].message, 400);

        return response.success(res, paraResposta(await repository.atualizar(id, req.usuario.empresa_id, corpo.data)));
    } catch (error) { next(error); }
}

// Envia (ou troca) a imagem de um lado. A chave leva o empresa_id do JWT; o nome do arquivo do cliente nunca é usado.
async function enviarImagem(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const lado = parseLado(req.params.lado);

        if (!storage.configurado()) throw new AppError('Armazenamento de fotos não configurado neste ambiente', 412);

        const arquivo = req.file;

        if (!arquivo || !arquivo.buffer || !arquivo.buffer.length) throw new AppError('Envie a imagem no campo "arquivo"', 400);

        const tipo = detectarTipo(arquivo.buffer);

        if (!tipo) throw new AppError('Formato inválido: envie uma imagem JPEG, PNG ou WebP', 400);

        const empresa_id = req.usuario.empresa_id;

        if (!(await repository.buscar(id, empresa_id))) throw new AppError('Faixa não encontrada', 404);

        const chave = `${empresa_id}/banners/${crypto.randomUUID()}.${extensaoDoTipo(tipo)}`;
        await storage.enviar({ chave, buffer: arquivo.buffer, contentType: tipo });

        try {
            const antiga = await repository.definirImagem(id, empresa_id, lado, chave);
            if (antiga) await storage.remover(antiga).catch(() => {});
        } catch (erro) {
            await storage.remover(chave).catch(() => {});
            throw erro;
        }

        return response.success(res, paraResposta(await repository.buscar(id, empresa_id)));
    } catch (error) { next(error); }
}

async function removerImagem(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const lado = parseLado(req.params.lado);
        const empresa_id = req.usuario.empresa_id;
        const antiga = await repository.definirImagem(id, empresa_id, lado, null);

        if (antiga && storage.configurado()) await storage.remover(antiga).catch(() => {});

        return response.success(res, paraResposta(await repository.buscar(id, empresa_id)));
    } catch (error) { next(error); }
}

async function remover(req, res, next) {
    try {
        const chaves = await repository.remover(parseId(req.params.id), req.usuario.empresa_id);

        // A linha já saiu da loja; se o bucket falhar, sobra um objeto órfão sem link (inofensivo).
        if (storage.configurado()) await Promise.all(chaves.map((c) => storage.remover(c).catch(() => {})));

        return response.success(res, { removido: true });
    } catch (error) { next(error); }
}

module.exports = { listar, criar, atualizar, enviarImagem, removerImagem, remover, paraResposta };

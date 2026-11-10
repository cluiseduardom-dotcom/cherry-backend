const crypto = require('node:crypto');
const repository = require('../repositories/lojaRetratosRepository');
const storage = require('../services/storage/imagensStorage');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { detectarTipo, extensaoDoTipo } = require('../utils/imagemProduto');
const { retratoCriarSchema, retratoAtualizarSchema } = require('../validations/lojaValidation');

const ID = /^[1-9]\d{0,9}$/;

function parseId(valor) {
    if (!ID.test(String(valor))) throw new AppError('Retrato não encontrado', 404);
    return Number(valor);
}

function paraResposta(r) {
    return {
        id: r.id,
        url: storage.urlPublica(r.chave),
        alt: r.alt,
        nome: r.nome,
        ordem: r.ordem,
        ativo: r.ativo,
        autorizacao_assinada: r.autorizacao_assinada,
        autorizado_por: r.autorizado_por_nome ?? null,
        autorizado_em: r.autorizado_em,
        criado_em: r.criado_em
    };
}

// Gestão (admin + loja_online; ver app.js). Nunca em cache: o admin precisa ver o estado atual.
async function listar(req, res, next) {
    try {
        res.set('Cache-Control', 'no-store');
        return response.success(res, (await repository.listar(req.usuario.empresa_id)).map(paraResposta));
    } catch (error) { next(error); }
}

// Envia a foto. Nasce inativa e sem autorização: nada vai ao ar até o admin confirmar o termo assinado.
async function criar(req, res, next) {
    try {
        if (!storage.configurado()) throw new AppError('Armazenamento de fotos não configurado neste ambiente', 412);

        const arquivo = req.file;

        if (!arquivo || !arquivo.buffer || !arquivo.buffer.length) throw new AppError('Envie a foto no campo "arquivo"', 400);

        const tipo = detectarTipo(arquivo.buffer);

        if (!tipo) throw new AppError('Formato inválido: envie uma foto JPEG, PNG ou WebP', 400);

        const campos = retratoCriarSchema.safeParse(req.body ?? {});

        if (!campos.success) throw new AppError(campos.error.issues[0].message, 400);

        const empresa_id = req.usuario.empresa_id;
        // A chave leva o empresa_id do JWT; o nome do arquivo do cliente nunca é usado.
        const chave = `${empresa_id}/retratos/${crypto.randomUUID()}.${extensaoDoTipo(tipo)}`;

        await storage.enviar({ chave, buffer: arquivo.buffer, contentType: tipo });

        try {
            const id = await repository.inserir({
                empresa_id, chave, content_type: tipo, tamanho_bytes: arquivo.buffer.length,
                alt: campos.data.alt, nome: campos.data.nome, criado_por: req.usuario.id
            });
            return response.success(res, paraResposta(await repository.buscar(id, empresa_id)), 201);
        } catch (erro) {
            await storage.remover(chave).catch(() => {});
            throw erro;
        }
    } catch (error) { next(error); }
}

async function atualizar(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const corpo = retratoAtualizarSchema.safeParse(req.body ?? {});

        if (!corpo.success) throw new AppError(corpo.error.issues[0].message, 400);

        const r = await repository.atualizar(id, req.usuario.empresa_id, req.usuario.id, corpo.data);
        return response.success(res, paraResposta(r));
    } catch (error) { next(error); }
}

async function remover(req, res, next) {
    try {
        const chave = await repository.remover(parseId(req.params.id), req.usuario.empresa_id);

        // A linha já saiu da loja; se o bucket falhar, sobra um objeto órfão sem link (inofensivo).
        if (storage.configurado()) await storage.remover(chave).catch(() => {});

        return response.success(res, { removido: true });
    } catch (error) { next(error); }
}

module.exports = { listar, criar, atualizar, remover };

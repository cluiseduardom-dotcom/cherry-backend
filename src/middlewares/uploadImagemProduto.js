const multer = require('multer');
const AppError = require('../errors/AppError');
const { MAX_BYTES } = require('../utils/imagemProduto');

// Arquivo em memória (no máximo 2 MB, um só, campo "arquivo"). O conteúdo é conferido no service pela
// assinatura real do arquivo; o content-type/extensão que o cliente manda não é confiado.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 0 }
}).single('arquivo');

module.exports = (req, res, next) => {
    upload(req, res, (erro) => {
        if (!erro) return next();

        if (erro.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(`A foto deve ter no máximo ${MAX_BYTES / (1024 * 1024)} MB`, 413));
        }

        return next(new AppError('Upload inválido: envie um único arquivo no campo "arquivo"', 400));
    });
};

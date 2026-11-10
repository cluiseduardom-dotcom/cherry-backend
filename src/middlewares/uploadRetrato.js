const multer = require('multer');
const AppError = require('../errors/AppError');
const { MAX_BYTES } = require('../utils/imagemProduto');

// Retrato da Home: um arquivo em memória (campo "arquivo") e até 2 campos de texto (alt, nome). O conteúdo real do
// arquivo é conferido no controller (assinatura), nunca o content-type que o cliente mandou.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 2, fieldSize: 1024 }
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

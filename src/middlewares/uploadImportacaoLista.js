const multer = require('multer');
const AppError = require('../errors/AppError');
const { LIMITES } = require('../constants/importacaoLista');

// Arquivo em memória (um só, campo "arquivo") e só os campos de texto da prévia. O conteúdo é conferido no service
// pelos bytes reais; extensão e content-type que o cliente manda não são confiados. Nada vai para disco.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITES.MAX_BYTES, files: 1, fields: 4, fieldSize: 1024, parts: 6 }
}).single('arquivo');

module.exports = (req, res, next) => {
    upload(req, res, (erro) => {
        if (!erro) return next();

        if (erro.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(`O arquivo deve ter no máximo ${LIMITES.MAX_BYTES / (1024 * 1024)} MB`, 413));
        }

        return next(new AppError('Upload inválido: envie um único arquivo CSV no campo "arquivo"', 400));
    });
};

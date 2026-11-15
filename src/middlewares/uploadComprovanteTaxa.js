const multer = require('multer');
const AppError = require('../errors/AppError');
const { MAX_BYTES } = require('../utils/comprovanteTaxa');

// Comprovante de pagamento da taxa: um arquivo em memória (até 5 MB) no campo "arquivo". O tipo real é
// conferido pela assinatura do conteúdo no controller; o content-type/extensão do cliente não é confiado.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 0 }
}).single('arquivo');

module.exports = (req, res, next) => {
    upload(req, res, (erro) => {
        if (!erro) return next();

        if (erro.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(`O comprovante deve ter no máximo ${MAX_BYTES / (1024 * 1024)} MB`, 413));
        }

        return next(new AppError('Upload inválido: envie um único arquivo no campo "arquivo"', 400));
    });
};

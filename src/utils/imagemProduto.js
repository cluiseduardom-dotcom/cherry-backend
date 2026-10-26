// Regras puras da foto de produto: tipos aceitos, limites e conferência do conteúdo real do arquivo
// (assinatura/"magic bytes"), sem confiar no content-type nem na extensão que o cliente mandou.

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_IMAGENS_POR_PRODUTO = 5;

const TIPOS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
});

// Devolve o content-type verdadeiro pelo conteúdo, ou null se não for JPEG, PNG ou WebP.
function detectarTipo(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';

    if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';

    return null;
}

function extensaoDoTipo(contentType) {
    return TIPOS[contentType] || null;
}

module.exports = { MAX_BYTES, MAX_IMAGENS_POR_PRODUTO, TIPOS, detectarTipo, extensaoDoTipo };

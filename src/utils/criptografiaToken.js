const crypto = require('node:crypto');

// AES-256-GCM. Formato: "v1.<iv>.<tag>.<texto cifrado>" (base64url). O IV é aleatório por
// mensagem; qualquer adulteração falha na verificação do tag. A chave (32 bytes) vem do
// ambiente e nunca é gravada no banco nem logada.
const VERSAO = 'v1';

function cifrar(texto, chave) {
    if (typeof texto !== 'string' || texto === '') {
        throw new Error('cifrar exige texto não vazio');
    }

    const iv = crypto.randomBytes(12);
    const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv);
    const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
    const tag = cifra.getAuthTag();

    return [VERSAO, iv.toString('base64url'), tag.toString('base64url'), cifrado.toString('base64url')].join('.');
}

function decifrar(valor, chave) {
    const partes = String(valor).split('.');

    if (partes.length !== 4 || partes[0] !== VERSAO) {
        throw new Error('Formato de token cifrado inválido');
    }

    const [, iv, tag, cifrado] = partes;
    const decifra = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'));
    decifra.setAuthTag(Buffer.from(tag, 'base64url'));

    return Buffer.concat([decifra.update(Buffer.from(cifrado, 'base64url')), decifra.final()]).toString('utf8');
}

module.exports = { cifrar, decifrar };

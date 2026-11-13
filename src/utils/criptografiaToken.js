const crypto = require('node:crypto');

// AES-256-GCM. Formato: "v1.<iv>.<tag>.<texto cifrado>" (base64url). O IV é aleatório por
// mensagem; qualquer adulteração falha na verificação do tag. A chave (32 bytes) vem do
// ambiente e nunca é gravada no banco nem logada.
const VERSAO = 'v1';
// Tamanhos fixos: sem fixar o tamanho da tag, o GCM aceita tags TRUNCADAS (basta o prefixo bater), o que enfraquece
// a autenticação. IV de 12 bytes é o padrão do GCM.
const TAMANHO_TAG = 16;
const TAMANHO_IV = 12;

function cifrar(texto, chave) {
    if (typeof texto !== 'string' || texto === '') {
        throw new Error('cifrar exige texto não vazio');
    }

    const iv = crypto.randomBytes(12);
    const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv, { authTagLength: TAMANHO_TAG });
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
    const ivBytes = Buffer.from(iv, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');

    if (ivBytes.length !== TAMANHO_IV || tagBytes.length !== TAMANHO_TAG) {
        throw new Error('Formato de token cifrado inválido');
    }

    const decifra = crypto.createDecipheriv('aes-256-gcm', chave, ivBytes, { authTagLength: TAMANHO_TAG });
    decifra.setAuthTag(tagBytes);

    return Buffer.concat([decifra.update(Buffer.from(cifrado, 'base64url')), decifra.final()]).toString('utf8');
}

module.exports = { cifrar, decifrar };

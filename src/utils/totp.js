const crypto = require('node:crypto');

// TOTP (RFC 6238) com HMAC-SHA1, 6 dígitos e passo de 30 s: o formato que Google Authenticator, Microsoft
// Authenticator, Authy e 1Password usam. Sem dependência: é HMAC + truncamento dinâmico (RFC 4226).

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO_S = 30;
const DIGITOS = 6;

function base32Codificar(buf) {
    let bits = 0;
    let valor = 0;
    let saida = '';

    for (const byte of buf) {
        valor = (valor << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            saida += ALFABETO[(valor >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];

    return saida;
}

function base32Decodificar(texto) {
    const limpo = String(texto).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let valor = 0;
    const bytes = [];

    for (const ch of limpo) {
        const i = ALFABETO.indexOf(ch);
        if (i < 0) throw new Error('Segredo TOTP inválido');
        valor = (valor << 5) | i;
        bits += 5;
        if (bits >= 8) {
            bytes.push((valor >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

// 20 bytes aleatórios (160 bits), o tamanho recomendado para HMAC-SHA1.
function gerarSegredo() {
    return base32Codificar(crypto.randomBytes(20));
}

function codigoNoPasso(segredoBuf, passo, digitos = DIGITOS) {
    const contador = Buffer.alloc(8);
    contador.writeBigUInt64BE(BigInt(passo));
    const hmac = crypto.createHmac('sha1', segredoBuf).update(contador).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binario = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];

    return String(binario % 10 ** digitos).padStart(digitos, '0');
}

function gerarCodigo(segredoBase32, agoraMs = Date.now()) {
    return codigoNoPasso(base32Decodificar(segredoBase32), Math.floor(agoraMs / 1000 / PASSO_S));
}

// Aceita o passo atual e um vizinho de cada lado (±30 s de diferença de relógio). Comparação em tempo
// constante. Devolve o passo aceito (para impedir reúso do mesmo código) ou null.
function verificarCodigo(segredoBase32, codigo, agoraMs = Date.now(), janela = 1) {
    const texto = String(codigo ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(texto)) return null;

    const segredo = base32Decodificar(segredoBase32);
    const atual = Math.floor(agoraMs / 1000 / PASSO_S);

    for (let d = -janela; d <= janela; d += 1) {
        const esperado = codigoNoPasso(segredo, atual + d);
        if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(texto))) return atual + d;
    }

    return null;
}

function uriOtpauth({ emissor = 'GiroNex', conta, segredo }) {
    const rotulo = encodeURIComponent(`${emissor}:${conta}`);
    const params = new URLSearchParams({ secret: segredo, issuer: emissor, algorithm: 'SHA1', digits: String(DIGITOS), period: String(PASSO_S) });

    return `otpauth://totp/${rotulo}?${params.toString()}`;
}

module.exports = { gerarSegredo, gerarCodigo, verificarCodigo, uriOtpauth, base32Codificar, base32Decodificar, codigoNoPasso };

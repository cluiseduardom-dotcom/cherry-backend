'use strict';

// Identificador de uma unidade rastreada (ADR-008, R2): IMEI (15 dígitos, dígito verificador de Luhn) ou número de série.
// Normaliza o que veio do leitor/digitação (maiúsculo, sem espaço, hífen ou barra) e devolve { identificador, tipo }.
// Todo valor só de dígitos precisa ser um IMEI válido: 14 ou 16 dígitos, ou 15 com dígito verificador errado, são quase
// sempre digitação errada e não podem virar "série" em silêncio. Série tem letra, de 5 a 40 caracteres A–Z/0–9.

const TAMANHO_IMEI = 15;
const SERIE_RE = /^[A-Z0-9]{5,40}$/;

function luhnValido(digitos) {
    let soma = 0;

    for (let i = 0; i < digitos.length; i += 1) {
        let n = Number(digitos[digitos.length - 1 - i]);

        if (i % 2 === 1) {
            n *= 2;
            if (n > 9) n -= 9;
        }

        soma += n;
    }

    return soma % 10 === 0;
}

function normalizarIdentificador(bruto) {
    return String(bruto ?? '').toUpperCase().replace(/[\s\-/.]/g, '');
}

// Lança Error com a mensagem para o usuário; quem chama transforma em AppError 400.
function classificarIdentificador(bruto) {
    const identificador = normalizarIdentificador(bruto);

    if (!identificador) {
        throw new Error('Identificador vazio');
    }

    if (/^\d+$/.test(identificador)) {
        if (identificador.length !== TAMANHO_IMEI) {
            throw new Error(`IMEI "${identificador}" deve ter ${TAMANHO_IMEI} dígitos`);
        }
        if (!luhnValido(identificador)) {
            throw new Error(`IMEI "${identificador}" inválido (dígito verificador não confere)`);
        }
        return { identificador, tipo: 'imei' };
    }

    if (!SERIE_RE.test(identificador)) {
        throw new Error(`Número de série "${identificador}" inválido (use de 5 a 40 letras e números)`);
    }

    return { identificador, tipo: 'serie' };
}

module.exports = { classificarIdentificador, normalizarIdentificador, luhnValido, TAMANHO_IMEI };

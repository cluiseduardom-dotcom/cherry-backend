const crypto = require('node:crypto');

// Sem caracteres ambíguos (0/O, 1/l/I) para ser ditada ou digitada sem erro.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function gerarSenhaTemporaria(tamanho = 12) {
    let senha = '';

    for (let i = 0; i < tamanho; i += 1) {
        senha += ALFABETO[crypto.randomInt(ALFABETO.length)];
    }

    return senha;
}

module.exports = { gerarSenhaTemporaria };

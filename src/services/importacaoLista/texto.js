'use strict';

const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function semAcento(texto) {
    return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Texto exibível: sem caractere de controle, espaços colapsados, sem as pontas em branco.
function limparTexto(texto) {
    return String(texto ?? '').replace(CONTROLE, '').replace(/\s+/g, ' ').trim();
}

// Base da regra de duplicidade de produto: minúsculas, sem acento, espaços colapsados.
function normalizarParaComparar(texto) {
    return semAcento(limparTexto(texto)).toLowerCase();
}

// Chave de coluna: "Observações", "observacoes" e "OBSERVAÇÕES " viram a mesma.
function chaveDeCabecalho(texto) {
    return semAcento(String(texto ?? '')).toLowerCase().replace(/[^a-z0-9]/g, '');
}

module.exports = { semAcento, limparTexto, normalizarParaComparar, chaveDeCabecalho };

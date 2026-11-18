'use strict';

const COLUNAS = Object.freeze({
    produtos: ['linha', 'resultado', 'id', 'nome', 'sku', 'saldo', 'detalhe'],
    clientes: ['linha', 'resultado', 'id', 'detalhe']
});

// Injeção de fórmula: o relatório será aberto no Excel/Sheets, e nome ou motivo vem de arquivo de terceiros.
// Célula que começa com = + - @ (ou tabulação/CR) ganha um apóstrofo na frente e deixa de ser fórmula.
function protegerFormula(texto) {
    return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

function celula(valor) {
    const texto = protegerFormula(String(valor ?? ''));
    return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// BOM + ponto e vírgula: abre certo no Excel em português, com o mesmo padrão da planilha-modelo.
function montarCsv(tipo, linhas) {
    const colunas = COLUNAS[tipo];
    const corpo = linhas.map((l) => colunas.map((c) => celula(l[c])).join(';'));
    return `﻿${[colunas.join(';'), ...corpo].join('\r\n')}\r\n`;
}

module.exports = { montarCsv, protegerFormula };

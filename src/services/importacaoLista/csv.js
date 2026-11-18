'use strict';

const AppError = require('../../errors/AppError');
const { LIMITES } = require('../../constants/importacaoLista');

const MSG_EXCEL = 'Planilhas do Excel (.xlsx, .xlsm, .xls) ainda não são aceitas. Salve a planilha como CSV e envie novamente';

// O tipo é conferido pelo CONTEÚDO, não pela extensão nem pelo content-type que o cliente manda.
// Nada aqui interpreta fórmula: o CSV é lido como texto puro.
function decodificar(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new AppError('O arquivo está vazio', 400);
    }

    if (buffer.length > LIMITES.MAX_BYTES) {
        throw new AppError(`O arquivo deve ter no máximo ${LIMITES.MAX_BYTES / (1024 * 1024)} MB`, 413);
    }

    const cabecalho = buffer.subarray(0, 8);
    const comeca = (...bytes) => bytes.every((b, i) => cabecalho[i] === b);

    if (comeca(0x50, 0x4b, 0x03, 0x04) || comeca(0xd0, 0xcf, 0x11, 0xe0)) {
        throw new AppError(MSG_EXCEL, 400);
    }

    if (comeca(0x25, 0x50, 0x44, 0x46)) {
        throw new AppError('O arquivo enviado é um PDF, não um CSV', 400);
    }

    if (buffer.includes(0x00)) {
        throw new AppError('O arquivo não parece ser um CSV de texto. Salve como "CSV UTF-8" e envie novamente', 400);
    }

    const semBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(semBom);
    } catch {
        // CSV exportado pelo Excel em português costuma vir em Windows-1252.
        return new TextDecoder('windows-1252').decode(semBom);
    }
}

function detectarDelimitador(texto) {
    const primeira = texto.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
    const contar = (c) => {
        let n = 0;
        let dentro = false;
        for (const ch of primeira) {
            if (ch === '"') dentro = !dentro;
            else if (ch === c && !dentro) n += 1;
        }
        return n;
    };
    const candidatos = [';', ',', '\t'].map((c) => ({ c, n: contar(c) })).sort((a, b) => b.n - a.n);

    return candidatos[0].n > 0 ? candidatos[0].c : ',';
}

// CSV (RFC 4180): aspas duplas, "" dentro de aspas, quebra de linha dentro de aspas, CRLF/LF/CR.
// Devolve só os registros não vazios; `linha` é a linha física do arquivo onde o registro começa.
function lerRegistros(texto, delimitador = detectarDelimitador(texto)) {
    const registros = [];
    let celulas = [];
    let celula = '';
    let dentroDeAspas = false;
    let linhaFisica = 1;
    let linhaDoRegistro = 1;
    let abriuAspasNaLinha = 1;

    const fecharCelula = () => {
        celulas.push(celula);
        celula = '';
    };
    const fecharRegistro = () => {
        fecharCelula();
        if (celulas.some((c) => c.trim() !== '')) {
            registros.push({ linha: linhaDoRegistro, celulas });
        }
        celulas = [];
    };

    for (let i = 0; i < texto.length; i += 1) {
        const ch = texto[i];

        if (dentroDeAspas) {
            if (ch === '"') {
                if (texto[i + 1] === '"') {
                    celula += '"';
                    i += 1;
                } else {
                    dentroDeAspas = false;
                }
            } else {
                if (ch === '\n') linhaFisica += 1;
                celula += ch;
            }
            continue;
        }

        if (ch === '"' && celula === '') {
            dentroDeAspas = true;
            abriuAspasNaLinha = linhaFisica;
        } else if (ch === delimitador) {
            fecharCelula();
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && texto[i + 1] === '\n') i += 1;
            fecharRegistro();
            linhaFisica += 1;
            linhaDoRegistro = linhaFisica;
        } else {
            celula += ch;
        }

        if (registros.length > LIMITES.MAX_LINHAS + 1) {
            throw new AppError(`O arquivo tem mais de ${LIMITES.MAX_LINHAS} linhas. Divida em arquivos menores`, 400);
        }
    }

    if (dentroDeAspas) {
        throw new AppError(`CSV malformado: aspas abertas na linha ${abriuAspasNaLinha} e nunca fechadas`, 400);
    }

    if (celula !== '' || celulas.length > 0) fecharRegistro();

    if (registros.length > LIMITES.MAX_LINHAS + 1) {
        throw new AppError(`O arquivo tem mais de ${LIMITES.MAX_LINHAS} linhas. Divida em arquivos menores`, 400);
    }

    return { delimitador, registros };
}

module.exports = { decodificar, detectarDelimitador, lerRegistros };

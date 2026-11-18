'use strict';

const AppError = require('../../errors/AppError');
const { LIMITES, COLUNAS, SINONIMOS_COLUNA, COLUNAS_NAO_IMPORTADAS } = require('../../constants/importacaoLista');
const { limparTexto, chaveDeCabecalho } = require('./texto');

// Cabeçalho em qualquer ordem, com variação de caixa, acento e espaço. Erro de cabeçalho derruba o arquivo inteiro
// (não há linha a apontar); o resto vira problema por linha.
function mapearCabecalho(celulas, tipo) {
    const { obrigatorias, opcionais } = COLUNAS[tipo];
    const conhecidas = new Set([...obrigatorias, ...opcionais]);

    if (celulas.length > LIMITES.MAX_COLUNAS) {
        throw new AppError(`O arquivo tem mais de ${LIMITES.MAX_COLUNAS} colunas`, 400);
    }

    const indices = {};
    const ignoradas = [];
    const avisos = [];

    celulas.forEach((bruto, indice) => {
        const original = limparTexto(bruto);
        if (original === '') return;

        const chave = chaveDeCabecalho(original);
        const coluna = SINONIMOS_COLUNA[chave] ?? chave;

        if (conhecidas.has(coluna)) {
            if (coluna in indices) {
                throw new AppError(`Cabeçalho inválido: a coluna "${coluna}" aparece mais de uma vez`, 400);
            }
            indices[coluna] = indice;
        } else {
            ignoradas.push(original);
            avisos.push(COLUNAS_NAO_IMPORTADAS[chave] ?? `A coluna "${original}" não faz parte do modelo e foi ignorada`);
        }
    });

    const faltando = obrigatorias.filter((c) => !(c in indices));
    if (faltando.length) {
        throw new AppError(
            `Cabeçalho inválido: faltam as colunas obrigatórias (${faltando.join(', ')}). Use a planilha-modelo de ${tipo}`,
            400
        );
    }

    return { indices, ignoradas, avisos };
}

// Transforma os registros do CSV em linhas { linha, valores } por nome de coluna. Células além do cabeçalho
// (típico de nome com vírgula sem aspas) viram `colunasAMais` para a linha ser recusada, não gravada torta.
function extrairLinhas(registros, tipo) {
    if (!registros.length) throw new AppError('O arquivo não tem nenhuma linha de dados', 400);

    const [cabecalho, ...dados] = registros;
    const { indices, ignoradas, avisos } = mapearCabecalho(cabecalho.celulas, tipo);
    const totalColunas = cabecalho.celulas.length;

    if (!dados.length) throw new AppError('O arquivo tem só o cabeçalho e nenhuma linha de dados', 400);

    const linhas = dados.map(({ linha, celulas }) => {
        const valores = {};
        for (const [coluna, indice] of Object.entries(indices)) {
            valores[coluna] = celulas[indice] ?? '';
        }
        const colunasAMais = celulas.slice(totalColunas).some((c) => c.trim() !== '');
        return { linha, valores, colunasAMais };
    });

    return { linhas, ignoradas, avisosDeArquivo: avisos };
}

module.exports = { mapearCabecalho, extrairLinhas };

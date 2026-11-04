const crypto = require('node:crypto');

// Leitura de extrato bancário (OFX e CSV) em linhas normalizadas:
// { indice, data: 'YYYY-MM-DD', tipo: 'ENTRADA'|'SAIDA', valor (número, 2 casas, positivo), descricao, referencia_externa }
// Função pura, sem banco e sem rede. A data é lida como texto (YYYY-MM-DD) e nunca passa por Date/UTC.
// Linha que não dá para entender vai em `erros` (com o número da linha de origem): nunca é adivinhada.

const MAX_LINHAS = 5000;
const MAX_DESCRICAO = 255;

const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizarTexto = (t) => semAcento(t).toLowerCase().replace(/\s+/g, ' ').trim();
const centavos = (n) => Math.round(n * 100);

function dataReal(ano, mes, dia) {
    const a = Number(ano); const m = Number(mes); const d = Number(dia);
    const teste = new Date(Date.UTC(a, m - 1, d));
    if (teste.getUTCFullYear() !== a || teste.getUTCMonth() !== m - 1 || teste.getUTCDate() !== d) return null;
    if (a < 1990) return null;
    return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "1.234,56", "1234.56", "R$ -10,00", "(10,00)" → número; inválido → NaN.
function lerValor(texto) {
    let t = String(texto ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
    let negativo = false;
    if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
    if (!t) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    if (!/^[+-]?\d+(\.\d{1,2})?$/.test(t)) return NaN;
    const n = Number(t);
    return negativo ? -n : n;
}

function montarLinha(indice, data, valorComSinal, descricao, referenciaBase) {
    const valor = Math.abs(centavos(valorComSinal)) / 100;
    return {
        indice,
        data,
        tipo: valorComSinal > 0 ? 'ENTRADA' : 'SAIDA',
        valor,
        descricao: String(descricao ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRICAO) || 'Lançamento do extrato',
        referencia_base: referenciaBase
    };
}

function tag(bloco, nome) {
    const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco);
    return m ? m[1].trim() : '';
}

function lerOfx(texto) {
    const linhas = []; const erros = [];
    const blocos = texto.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi) ?? [];
    if (blocos.length === 0) return { linhas, erros: [{ linha: 0, erro: 'Nenhum lançamento encontrado no arquivo OFX.' }] };

    blocos.forEach((bloco, i) => {
        const n = i + 1;
        const dt = /^(\d{4})(\d{2})(\d{2})/.exec(tag(bloco, 'DTPOSTED'));
        const data = dt ? dataReal(dt[1], dt[2], dt[3]) : null;
        const valor = lerValor(tag(bloco, 'TRNAMT'));
        if (!data) { erros.push({ linha: n, erro: 'Data inválida' }); return; }
        if (!Number.isFinite(valor) || valor === 0) { erros.push({ linha: n, erro: 'Valor inválido' }); return; }
        const fitid = tag(bloco, 'FITID');
        const descricao = tag(bloco, 'MEMO') || tag(bloco, 'NAME') || tag(bloco, 'TRNTYPE');
        const l = montarLinha(n, data, valor, descricao, fitid ? { tipo: 'ofx', id: fitid.slice(0, 120) } : null);
        linhas.push(l);
    });
    return { linhas, erros };
}

// Divide uma linha CSV respeitando aspas.
function dividirCsv(linha, sep) {
    const out = []; let atual = ''; let aspas = false;
    for (let i = 0; i < linha.length; i += 1) {
        const c = linha[i];
        if (aspas) {
            if (c === '"' && linha[i + 1] === '"') { atual += '"'; i += 1; } else if (c === '"') aspas = false; else atual += c;
        } else if (c === '"') aspas = true;
        else if (c === sep) { out.push(atual); atual = ''; } else atual += c;
    }
    out.push(atual);
    return out.map((c) => c.trim());
}

function lerData(texto) {
    const t = String(texto ?? '').trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
    if (m) return dataReal(m[3], m[2], m[1]);
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return dataReal(m[1], m[2], m[3]);
    return null;
}

// Separa o texto em registros (linhas de dados) respeitando aspas: uma célula entre aspas pode ter quebra de
// linha (descrição em várias linhas). Devolve a linha física onde cada registro começa, para mensagens de erro.
function dividirRegistrosCsv(texto) {
    const registros = []; let atual = ''; let aspas = false; let linhaFisica = 1; let inicio = 1;
    const fechar = () => { if (atual.trim() !== '') registros.push({ texto: atual, linha: inicio }); atual = ''; };
    for (let i = 0; i < texto.length; i += 1) {
        const c = texto[i];
        if (c === '"') { aspas = !aspas; atual += c; continue; }
        if (!aspas && (c === '\n' || c === '\r')) {
            if (c === '\r' && texto[i + 1] === '\n') i += 1;
            fechar(); linhaFisica += 1; inicio = linhaFisica;
            continue;
        }
        if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i += 1; atual += '\n'; linhaFisica += 1; continue; }
        atual += c;
    }
    fechar();
    return registros;
}

function colunasDoCabecalho(registro) {
    const sep = (registro.match(/;/g) ?? []).length >= (registro.match(/,/g) ?? []).length ? ';' : ',';
    const nomes = dividirCsv(registro, sep).map(normalizarTexto);
    const achar = (re) => nomes.findIndex((n) => re.test(n));
    const col = {
        sep,
        iData: achar(/^data/),
        iDesc: achar(/descri|historic|lancamento|memo|estabelecimento|detalhe/),
        iValor: achar(/^valor/),
        iCred: achar(/^(credito|entrada)/),
        iDeb: achar(/^(debito|saida)/)
    };
    col.valido = col.iData >= 0 && (col.iValor >= 0 || (col.iCred >= 0 && col.iDeb >= 0));
    return col;
}

// Alguns bancos (ex.: Santander) põem várias linhas de identificação da conta antes da tabela: procura o
// cabeçalho nas primeiras linhas em vez de assumir que é a primeira.
const MAX_LINHAS_ANTES_DO_CABECALHO = 30;

function lerCsv(texto) {
    const registros = dividirRegistrosCsv(texto);
    if (registros.length < 2) return { linhas: [], erros: [{ linha: 0, erro: 'O CSV precisa de cabeçalho e ao menos um lançamento.' }] };

    let posCab = -1; let col = null;
    for (let k = 0; k < Math.min(registros.length, MAX_LINHAS_ANTES_DO_CABECALHO); k += 1) {
        const candidato = colunasDoCabecalho(registros[k].texto);
        if (candidato.valido) { posCab = k; col = candidato; break; }
    }
    if (!col) {
        return { linhas: [], erros: [{ linha: 1, erro: 'Cabeçalho não reconhecido: são necessárias as colunas Data e Valor (ou Crédito e Débito).' }] };
    }
    const { sep, iData, iDesc, iValor, iCred, iDeb } = col;

    const linhas = []; const erros = [];
    const vistos = new Map();
    for (let i = posCab + 1; i < registros.length; i += 1) {
        const numero = registros[i].linha;
        const c = dividirCsv(registros[i].texto, sep);
        const data = lerData(c[iData]);
        if (!data) { erros.push({ linha: numero, erro: 'Data inválida' }); continue; }
        let valor;
        if (iValor >= 0) valor = lerValor(c[iValor]);
        else {
            const cred = c[iCred] ? lerValor(c[iCred]) : 0; const deb = c[iDeb] ? lerValor(c[iDeb]) : 0;
            valor = Number.isFinite(cred) && Number.isFinite(deb) ? Math.abs(cred) - Math.abs(deb) : NaN;
        }
        if (!Number.isFinite(valor) || valor === 0) { erros.push({ linha: numero, erro: 'Valor inválido' }); continue; }
        const descricao = iDesc >= 0 ? c[iDesc] : '';
        const chave = `${data}|${centavos(valor)}|${normalizarTexto(descricao)}`;
        const ocorrencia = (vistos.get(chave) ?? 0) + 1;
        vistos.set(chave, ocorrencia);
        linhas.push(montarLinha(numero, data, valor, descricao, { tipo: 'csv', chave, ocorrencia }));
    }
    return { linhas, erros };
}

function detectarFormato(texto) {
    return /<OFX>|<STMTTRN>|OFXHEADER/i.test(texto) ? 'OFX' : 'CSV';
}

// Referência estável para deduplicar. OFX: o FITID do banco (único por conta). CSV (não tem id): hash de
// data+valor+descrição+nº da ocorrência igual no mesmo arquivo. Reimportar o MESMO arquivo nunca duplica; um
// arquivo que cubra o mesmo período por outro recorte pode contar diferente uma linha repetida no mesmo dia.
function referencia(base, indice) {
    if (!base) return `idx:${crypto.createHash('sha256').update(String(indice)).digest('hex').slice(0, 16)}`;
    if (base.tipo === 'ofx') return `ofx:${base.id}`;
    return `csv:${crypto.createHash('sha256').update(`${base.chave}|${base.ocorrencia}`).digest('hex').slice(0, 24)}`;
}

function lerExtrato(conteudo, formato) {
    const texto = String(conteudo ?? '').replace(/^﻿/, '');
    const fmt = formato ?? detectarFormato(texto);
    const { linhas, erros } = fmt === 'OFX' ? lerOfx(texto) : lerCsv(texto);
    if (linhas.length > MAX_LINHAS) {
        return { formato: fmt, linhas: [], erros: [{ linha: 0, erro: `O arquivo tem mais de ${MAX_LINHAS} lançamentos. Divida por período.` }] };
    }
    const finais = linhas.map((l) => {
        const { referencia_base: base, ...resto } = l;
        return { ...resto, referencia_externa: referencia(base, l.indice) };
    });
    // FITID repetido no mesmo arquivo seria perda silenciosa de lançamento: vira erro explícito.
    const vistas = new Set(); const unicas = [];
    for (const l of finais) {
        if (vistas.has(l.referencia_externa)) { erros.push({ linha: l.indice, erro: 'Identificador repetido no arquivo' }); continue; }
        vistas.add(l.referencia_externa); unicas.push(l);
    }
    return { formato: fmt, linhas: unicas, erros };
}

module.exports = { lerExtrato, lerValor, detectarFormato, MAX_LINHAS };

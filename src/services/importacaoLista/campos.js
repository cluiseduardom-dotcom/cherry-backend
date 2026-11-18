'use strict';

const { LIMITES } = require('../../constants/importacaoLista');
const { hojeSP } = require('../../utils/dataSaoPaulo');
const { limparTexto } = require('./texto');

// Cada parser devolve { valor } ou { erro }, e { aviso } quando corrigiu algo sem perder informação.
// Quem chama decide o que é obrigatório: aqui "vazio" nunca é aceito como valor.

function parseNome(bruto) {
    const nome = limparTexto(bruto);
    if (nome.length < 2 || nome.length > 120) return { erro: 'o nome deve ter de 2 a 120 caracteres' };
    return { valor: nome };
}

function agruparMilhares(inteiro, separador) {
    const grupos = inteiro.split(separador);
    const ok = grupos[0].length >= 1 && grupos[0].length <= 3 && grupos.slice(1).every((g) => g.length === 3);
    return ok ? grupos.join('') : null;
}

// Aceita "12,50", "12.50", "1.234,56", "R$ 1.234,56" e "1234". Trabalha em texto, sem float.
// Um único ponto seguido de 3 dígitos ("1.234") é milhar, como se escreve no Brasil.
function parseCusto(bruto) {
    const texto = String(bruto ?? '').replace(/^\s*R\$\s*/i, '').replace(/\s+/g, '');
    const FORMATO = 'valor inválido: use apenas números, como 12,50';

    if (texto.startsWith('-')) return { erro: 'o custo não pode ser negativo' };
    if (!/^\d[\d.,]*$/.test(texto)) return { erro: FORMATO };

    const virgula = texto.lastIndexOf(',');
    const ponto = texto.lastIndexOf('.');
    let inteiro;
    let decimal = '';

    if (virgula >= 0 && ponto >= 0) {
        const decimalSep = virgula > ponto ? ',' : '.';
        const milharSep = decimalSep === ',' ? '.' : ',';
        const corte = texto.lastIndexOf(decimalSep);
        const parteInteira = texto.slice(0, corte);
        if (parteInteira.includes(decimalSep)) return { erro: FORMATO };
        inteiro = agruparMilhares(parteInteira, milharSep);
        decimal = texto.slice(corte + 1);
    } else if (virgula >= 0) {
        const partes = texto.split(',');
        if (partes.length > 2) return { erro: FORMATO };
        [inteiro, decimal] = partes;
    } else if (ponto >= 0) {
        const partes = texto.split('.');
        const soMilhar = partes.length > 2 || partes[1].length === 3;
        if (soMilhar) {
            inteiro = agruparMilhares(texto, '.');
        } else {
            [inteiro, decimal] = partes;
        }
    } else {
        inteiro = texto;
    }

    if (inteiro === null || inteiro === undefined || !/^\d+$/.test(inteiro) || (decimal !== '' && !/^\d+$/.test(decimal))) {
        return { erro: FORMATO };
    }

    if (decimal.length > 2) return { erro: 'o custo aceita no máximo 2 casas decimais' };

    inteiro = inteiro.replace(/^0+(?=\d)/, '');
    if (inteiro.length > 8) return { erro: 'o custo está acima do limite permitido' };

    const centavos = decimal.padEnd(2, '0');
    if (Number(inteiro) === 0 && Number(centavos) === 0) return { erro: 'o custo deve ser maior que zero' };

    return { valor: `${inteiro}.${centavos}` };
}

function parseSaldo(bruto) {
    const texto = String(bruto ?? '').trim();
    if (texto === '') return { valor: 0 };
    if (!/^\d+$/.test(texto)) return { erro: 'o saldo deve ser um número inteiro maior ou igual a 0' };

    const saldo = Number(texto);
    if (saldo > LIMITES.MAX_SALDO) return { erro: `o saldo está acima do limite de ${LIMITES.MAX_SALDO} unidades` };
    return { valor: saldo };
}

// SKU informado pelo lojista: maiúsculo, sem espaço, no padrão que o gerador também produz.
function parseSku(bruto) {
    const sku = String(bruto ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._\-/]{0,49}$/.test(sku)) {
        return { erro: 'SKU inválido: use até 50 letras, números, ponto, hífen, barra ou sublinhado, sem espaços' };
    }
    return { valor: sku };
}

// Só dígitos, com DDD (10 ou 11 dígitos). Telefone com DDI 55 ou 0 na frente é corrigido com aviso:
// planilha de lojista chega assim, e recusar tudo travaria a importação.
function parseTelefone(bruto) {
    let digitos = String(bruto ?? '').replace(/\D/g, '');
    const avisos = [];

    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
        digitos = digitos.slice(2);
        avisos.push('DDI 55 removido do telefone');
    } else if (digitos.length > 10 && digitos.startsWith('0')) {
        digitos = digitos.replace(/^0+/, '');
        avisos.push('zero inicial removido do telefone');
    }

    if (digitos.length < 10 || digitos.length > 11) {
        return { erro: 'o telefone deve ter 10 ou 11 dígitos, com DDD (ex.: 11 91234-5678)' };
    }
    if (Number(digitos.slice(0, 2)) < 11) return { erro: 'DDD do telefone inválido' };
    if (digitos.length === 11 && digitos[2] !== '9') return { erro: 'celular com 11 dígitos deve começar com 9 depois do DDD' };

    return { valor: digitos, avisos };
}

function dataValida(ano, mes, dia) {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

// DD/MM/AAAA ou AAAA-MM-DD, devolvida como 'YYYY-MM-DD' (texto, sem passar por Date/UTC no valor final).
function parseNascimento(bruto, hoje = hojeSP()) {
    const texto = String(bruto ?? '').trim();
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    const [ano, mes, dia] = br ? [Number(br[3]), Number(br[2]), Number(br[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [];

    if (!ano || !dataValida(ano, mes, dia) || ano < 1900) {
        return { erro: 'data inválida: use DD/MM/AAAA' };
    }

    const resultado = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    if (resultado > hoje) return { erro: 'a data de nascimento não pode ser futura' };

    return { valor: resultado };
}

function parseObservacoes(bruto) {
    const texto = limparTexto(bruto);
    if (texto.length > 500) return { erro: 'as observações devem ter até 500 caracteres' };
    return { valor: texto };
}

module.exports = { parseNome, parseCusto, parseSaldo, parseSku, parseTelefone, parseNascimento, parseObservacoes };

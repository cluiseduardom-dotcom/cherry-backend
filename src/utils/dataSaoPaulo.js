'use strict';

// Datas de negócio no fuso de São Paulo (America/Sao_Paulo).
//
// Por que existe: o servidor (Render) e o banco (Neon) rodam em UTC. "Hoje" calculado pela data do servidor vira o dia
// SEGUINTE entre 21h e 23h59 de Brasília: conta que vence hoje aparecia atrasada, recebimento e parcela saíam com a data de
// amanhã, e na virada do mês o movimento das 22h caía no mês seguinte. Toda regra de negócio que depende de "que dia é hoje",
// "início do mês" ou "em que dia aconteceu" usa estas funções, nunca `new Date().getDate()`/`toISOString()`/`CURRENT_DATE`.
//
// Não se muda o fuso do processo (process.env.TZ): isso deslocaria em 3 horas as colunas TIMESTAMP sem fuso, que guardam UTC.
//
// Colunas DATE continuam sendo texto 'YYYY-MM-DD' de ponta a ponta (sem passar por Date/UTC).

const FUSO = 'America/Sao_Paulo';

const formatadorDeData = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Data de hoje em São Paulo, 'YYYY-MM-DD'. `agora` é injetável para teste. */
function hojeSP(agora = new Date()) {
    return formatadorDeData.format(agora);
}

/** Primeiro dia do mês corrente em São Paulo, 'YYYY-MM-DD'. */
function inicioDoMesSP(agora = new Date()) {
    return `${hojeSP(agora).slice(0, 7)}-01`;
}

function partes(dataIso) {
    const [ano, mes, dia] = String(dataIso).split('-').map(Number);

    return { ano, mes, dia };
}

const doisDigitos = (n) => String(n).padStart(2, '0');
const diasNoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/**
 * Soma meses de calendário a uma data 'YYYY-MM-DD', mantendo o dia (ou o último dia do mês de destino, se ele não existir:
 * 31/01 + 1 mês = 28/02). Aritmética pura sobre ano/mês/dia: nenhum fuso entra.
 */
function somarMeses(dataIso, meses) {
    const { ano, mes, dia } = partes(dataIso);
    const indice = (mes - 1) + Number(meses);
    const anoAlvo = ano + Math.floor(indice / 12);
    const mesAlvo = ((indice % 12) + 12) % 12 + 1;
    const diaAlvo = Math.min(dia, diasNoMes(anoAlvo, mesAlvo));

    return `${anoAlvo}-${doisDigitos(mesAlvo)}-${doisDigitos(diaAlvo)}`;
}

/** Soma dias de calendário a uma data 'YYYY-MM-DD' (aritmética em UTC puro, sem fuso). */
function somarDias(dataIso, dias) {
    const { ano, mes, dia } = partes(dataIso);
    const d = new Date(Date.UTC(ano, mes - 1, dia + Number(dias)));

    return `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
}

/**
 * Coluna DATE lida do banco -> 'YYYY-MM-DD'. O driver pg devolve DATE como Date à meia-noite LOCAL do processo; os getters
 * locais devolvem exatamente o dia gravado, em qualquer fuso do servidor (nunca toISOString, que usa UTC). Texto passa direto.
 */
function dataDoBanco(valor) {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'string') return valor.slice(0, 10);

    return `${valor.getFullYear()}-${doisDigitos(valor.getMonth() + 1)}-${doisDigitos(valor.getDate())}`;
}

// ---- SQL ----

/** Data de hoje em São Paulo, como expressão SQL (substitui CURRENT_DATE). */
const SQL_HOJE_SP = `(NOW() AT TIME ZONE '${FUSO}')::date`;

/**
 * Dia de São Paulo de uma coluna TIMESTAMP SEM fuso que guarda UTC (vendas.data, criado_em...). `coluna::date` devolveria o dia
 * em UTC, e uma venda das 22h de Brasília cairia no dia seguinte. Só o nome da coluna entra no texto: nunca dado do usuário.
 */
function sqlDiaSP(coluna) {
    if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(coluna)) throw new Error(`coluna inválida para sqlDiaSP: ${coluna}`);

    return `((${coluna} AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO}')::date`;
}

module.exports = { FUSO, hojeSP, inicioDoMesSP, somarMeses, somarDias, dataDoBanco, SQL_HOJE_SP, sqlDiaSP };

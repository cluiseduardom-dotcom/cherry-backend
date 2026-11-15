'use strict';

// Regras do ciclo de cobrança da taxa da plataforma (Taxas a receber, SPEC §4 e T8). Função pura: sem banco, sem
// Date. `hoje` é o dia de São Paulo ('YYYY-MM-DD') e vem de quem chama. Dinheiro em centavos inteiros.
//
// Recebe os períodos FECHADOS da loja que ainda têm saldo a receber e diz em que ponto do ciclo a loja está.
// NÃO aplica nada: só calcula. Bloquear o Pix é outra camada (e outra PR).
//
// Interpretação do T8 (a SPEC deixa em aberto; conferir com o PO):
//  - "saldo vencido" = soma dos saldos dos períodos cujo vencimento já passou (acumula de um mês para o outro);
//  - cobrável (lembrete, aviso, cobrança) = saldo vencido >= piso, OU saldo vencido > 0 e abaixo do piso há 3 ou mais
//    períodos consecutivos (aí cobra mesmo assim, mas NUNCA suspende);
//  - suspensão devida = o que já passou da carência (período a período) soma pelo menos o piso. Assim um resíduo
//    abaixo do piso jamais suspende, e um mês novo vencido, ainda em carência, não suspende pelo mês antigo.

const { somarDias } = require('./dataSaoPaulo');

const centavos = (valor) => Math.round(Number(valor) * 100);
const reais = (c) => c / 100;
const soma = (itens, campo) => itens.reduce((acc, i) => acc + i[campo], 0);

function indiceDoMes(competencia) {
    const [ano, mes] = competencia.split('-').map(Number);
    return ano * 12 + (mes - 1);
}

// Tamanho da sequência de meses consecutivos que termina no período vencido mais recente.
function sequenciaFinalConsecutiva(vencidos) {
    const meses = [...new Set(vencidos.map((i) => indiceDoMes(i.competencia)))].sort((a, b) => b - a);
    if (meses.length === 0) return 0;

    let n = 1;
    while (n < meses.length && meses[n - 1] - meses[n] === 1) n += 1;
    return n;
}

/**
 * @param {{ periodos: { competencia: string, vencimento: string, saldo: number|string }[], hoje: string, config: object }} entrada
 */
function avaliarCiclo({ periodos, hoje, config }) {
    const itens = periodos
        .map((p) => ({
            competencia: p.competencia,
            vencimento: p.vencimento,
            c: centavos(p.saldo),
            fimCarencia: somarDias(p.vencimento, config.carenciaDias)
        }))
        .filter((i) => i.c > 0)
        .map((i) => ({ ...i, vencido: hoje > i.vencimento, carenciaEsgotada: hoje > i.fimCarencia }));

    const vencidos = itens.filter((i) => i.vencido);
    const aVencer = itens.filter((i) => !i.vencido);

    const saldoVencido = soma(vencidos, 'c');
    const saldoAVencer = soma(aVencer, 'c');
    const saldoAposCarencia = soma(itens.filter((i) => i.carenciaEsgotada), 'c');
    const sequencia = sequenciaFinalConsecutiva(vencidos);

    const porPiso = saldoVencido >= config.pisoCentavos;
    const porSequencia = saldoVencido > 0 && saldoVencido < config.pisoCentavos && sequencia >= config.periodosAbaixoDoPiso;
    const cobravel = porPiso || porSequencia;
    const suspender = saldoAposCarencia >= config.pisoCentavos;

    // Próximo fim de carência ainda por vir e o que já terá passado da carência até lá: se der o piso, a suspensão vem.
    const porVir = vencidos.filter((i) => !i.carenciaEsgotada).sort((a, b) => (a.fimCarencia < b.fimCarencia ? -1 : 1));
    const proximoFim = porVir[0]?.fimCarencia ?? null;
    const ateProximoFim = proximoFim ? soma(vencidos.filter((i) => i.fimCarencia <= proximoFim), 'c') : 0;
    const aviso = !suspender && porPiso && proximoFim !== null
        && ateProximoFim >= config.pisoCentavos
        && hoje >= somarDias(proximoFim, -config.antecedenciaAvisoDias);

    // Dia em que a suspensão começa (ou começou) se nada for pago: o dia seguinte ao fim da carência que fecha o piso.
    // Equivale a `suspender` (hoje >= suspensao_em); fica preenchido também depois que a suspensão já vale.
    let suspensaoEm = null;
    if (porPiso) {
        let acumulado = 0;
        for (const i of [...vencidos].sort((a, b) => (a.fimCarencia < b.fimCarencia ? -1 : 1))) {
            acumulado += i.c;
            if (acumulado >= config.pisoCentavos) { suspensaoEm = somarDias(i.fimCarencia, 1); break; }
        }
    }

    const venceHoje = aVencer.some((i) => hoje >= somarDias(i.vencimento, -config.antecedenciaLembreteDias));
    const lembrete = venceHoje && (saldoVencido + saldoAVencer >= config.pisoCentavos || porSequencia);

    let estagio;
    if (itens.length === 0) estagio = 'em_dia';
    else if (suspender) estagio = 'suspensao_devida';
    else if (vencidos.length > 0 && !cobravel) estagio = 'abaixo_do_piso';
    else if (vencidos.length > 0) estagio = aviso ? 'aviso_suspensao' : 'vencido';
    else estagio = 'a_vencer';

    const maisAntigo = [...itens].sort((a, b) => (a.competencia < b.competencia ? -1 : 1))[0] ?? null;

    return {
        estagio,
        cobravel,
        motivo_cobranca: porPiso ? 'piso' : porSequencia ? 'tres_periodos' : null,
        lembrete,
        aviso,
        suspender,
        suspensao_em: suspensaoEm,
        saldo_vencido: reais(saldoVencido),
        saldo_a_vencer: reais(saldoAVencer),
        saldo_apos_carencia: reais(saldoAposCarencia),
        periodos_vencidos: sequencia,
        competencia_mais_antiga: maisAntigo?.competencia ?? null,
        vencimento_mais_antigo: maisAntigo?.vencimento ?? null,
        fim_carencia_mais_antiga: maisAntigo?.fimCarencia ?? null
    };
}

module.exports = { avaliarCiclo, sequenciaFinalConsecutiva };

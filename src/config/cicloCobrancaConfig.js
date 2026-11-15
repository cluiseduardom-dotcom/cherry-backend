// Ciclo de cobrança da taxa da plataforma (Taxas a receber, SPEC §4 e T8). ÚNICO lugar dos parâmetros do ciclo:
// a futura mensalidade usa o mesmo valor de carência (D-T3), em vez de ter um segundo número.
//   COBRANCA_CARENCIA_DIAS  dias de carência depois do vencimento (padrão 15: vence dia 05, carência até o dia 20)
//   COBRANCA_PISO           piso de cobrança em reais (padrão 10,00): saldo vencido abaixo disso não aciona lembrete,
//                           aviso nem suspensão (T8)
// Valor inválido volta ao padrão (nunca derruba a API nem zera a carência por engano).
// Os demais marcos (lembrete 1 dia antes do vencimento, aviso 5 dias antes do fim da carência, 3 períodos abaixo do
// piso) são sugestões da SPEC e ficam fixos aqui.

const PADRAO = Object.freeze({
    carenciaDias: 15,
    pisoReais: 10,
    antecedenciaLembreteDias: 1,
    antecedenciaAvisoDias: 5,
    periodosAbaixoDoPiso: 3
});

const MAX_CARENCIA_DIAS = 90;
const MAX_PISO_REAIS = 1000;

function inteiroNoIntervalo(texto, min, max) {
    if (typeof texto !== 'string' || !/^\d{1,4}$/.test(texto.trim())) return null;
    const n = Number(texto);
    return n >= min && n <= max ? n : null;
}

// '10', '10,50' ou '10.5' -> reais com até 2 casas; fora de 0..1000 ou inválido -> null.
function reaisValidos(texto, max) {
    if (typeof texto !== 'string') return null;
    const limpo = texto.trim().replace(',', '.');
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(limpo)) return null;
    const n = Number(limpo);
    return n >= 0 && n <= max ? n : null;
}

function obterCicloCobranca(env = process.env) {
    const carenciaDias = inteiroNoIntervalo(env.COBRANCA_CARENCIA_DIAS, 0, MAX_CARENCIA_DIAS) ?? PADRAO.carenciaDias;
    const pisoReais = reaisValidos(env.COBRANCA_PISO, MAX_PISO_REAIS) ?? PADRAO.pisoReais;

    return {
        carenciaDias,
        pisoReais,
        pisoCentavos: Math.round(pisoReais * 100),
        antecedenciaLembreteDias: PADRAO.antecedenciaLembreteDias,
        antecedenciaAvisoDias: PADRAO.antecedenciaAvisoDias,
        periodosAbaixoDoPiso: PADRAO.periodosAbaixoDoPiso
    };
}

module.exports = { obterCicloCobranca, PADRAO };

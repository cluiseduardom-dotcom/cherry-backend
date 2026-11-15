const cobrancaTaxaRepository = require('../repositories/cobrancaTaxaRepository');
const { obterCicloCobranca } = require('../config/cicloCobrancaConfig');
const { avaliarCiclo } = require('../utils/cicloCobranca');
const { hojeSP } = require('../utils/dataSaoPaulo');

// Ordem de atenção do operador: o que exige ação primeiro.
const PRIORIDADE = { suspensao_devida: 0, aviso_suspensao: 1, vencido: 2, abaixo_do_piso: 3, a_vencer: 4, em_dia: 5 };

// Situação de cobrança de cada loja com saldo a receber, ao dia `hoje` (dia de São Paulo; injetável para teste).
// Só LEITURA: nada é suspenso nem avisado por aqui.
async function avaliarEmpresas({ hoje = hojeSP(), env = process.env } = {}) {
    const config = obterCicloCobranca(env);
    const linhas = await cobrancaTaxaRepository.periodosComSaldo();

    const porEmpresa = new Map();
    for (const l of linhas) {
        if (!porEmpresa.has(l.empresa_id)) porEmpresa.set(l.empresa_id, { empresa_id: l.empresa_id, empresa_nome: l.empresa_nome, periodos: [] });
        porEmpresa.get(l.empresa_id).periodos.push({
            periodo_id: l.periodo_id, competencia: l.competencia, vencimento: l.vencimento, saldo: Number(l.saldo)
        });
    }

    const items = [...porEmpresa.values()]
        .map((e) => ({ ...e, ...avaliarCiclo({ periodos: e.periodos, hoje, config }) }))
        .sort((a, b) => PRIORIDADE[a.estagio] - PRIORIDADE[b.estagio] || b.saldo_vencido - a.saldo_vencido || a.empresa_nome.localeCompare(b.empresa_nome));

    const contar = (estagio) => items.filter((i) => i.estagio === estagio).length;
    const centavos = items.reduce((acc, i) => acc + Math.round(i.saldo_vencido * 100), 0);

    return {
        hoje,
        config: {
            carencia_dias: config.carenciaDias,
            piso: config.pisoReais,
            antecedencia_lembrete_dias: config.antecedenciaLembreteDias,
            antecedencia_aviso_dias: config.antecedenciaAvisoDias,
            periodos_abaixo_do_piso: config.periodosAbaixoDoPiso
        },
        items,
        totais: {
            lojas: items.length,
            saldo_vencido: centavos / 100,
            suspensao_devida: contar('suspensao_devida'),
            aviso_suspensao: contar('aviso_suspensao'),
            vencido: contar('vencido'),
            abaixo_do_piso: contar('abaixo_do_piso'),
            a_vencer: contar('a_vencer')
        }
    };
}

module.exports = { avaliarEmpresas };

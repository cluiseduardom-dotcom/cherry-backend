const resultadoVendasRepository = require('../repositories/resultadoVendasRepository');
const despesasFixasRepository = require('../repositories/despesasFixasRepository');
const { calcularResultado, arredondar, percentual } = require('../utils/resultadoVenda');
const { ratearCustoFixo } = require('../utils/rateioCustoFixo');
const { somarDias } = require('../utils/dataSaoPaulo');
const { PERFIL_ADMIN } = require('../constants/cargos');

// Despesas fixas são dado do admin (rota /despesas-fixas é requireAdmin) e da funcionalidade
// `analise_financeira`: só nesse caso entram no resultado do período.
function podeVerDespesasFixas(usuario) {
    return usuario?.role === PERFIL_ADMIN
        && Array.isArray(usuario.funcionalidades)
        && usuario.funcionalidades.includes('analise_financeira');
}

// Resultado de cada venda de uma lista (ou de uma só). Devolve Map<venda_id, resultado>.
// Venda cancelada não tem resultado (null): não entrou em receita nenhuma.
async function resultadoDasVendas(vendas, empresaId) {
    const ativas = vendas.filter((v) => v.status !== 'cancelada');
    const [aliquota, base] = await Promise.all([
        resultadoVendasRepository.obterAliquota(empresaId),
        resultadoVendasRepository.porVendas(empresaId, ativas.map((v) => v.id))
    ]);
    const mapa = new Map();

    for (const venda of vendas) {
        const linha = base.get(venda.id);

        mapa.set(
            venda.id,
            venda.status === 'cancelada' || !linha
                ? null
                : { ...calcularResultado({ ...linha, aliquota }), inclui_despesas_fixas: false }
        );
    }

    return mapa;
}

function ultimoDiaDoMes(ano, mes) {
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

// Baldes do período: cada dia, ou cada mês do calendário recortado pelo período.
function baldes(dataDe, dataAte, agrupar) {
    const lista = [];

    if (agrupar === 'dia') {
        for (let dia = dataDe; dia <= dataAte; dia = somarDias(dia, 1)) {
            lista.push({ chave: dia, de: dia, ate: dia });
        }

        return lista;
    }

    let [ano, mes] = dataDe.split('-').map(Number);
    const [anoFim, mesFim] = dataAte.split('-').map(Number);

    while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
        const chave = `${ano}-${String(mes).padStart(2, '0')}`;
        const primeiro = `${chave}-01`;
        const ultimo = `${chave}-${String(ultimoDiaDoMes(ano, mes)).padStart(2, '0')}`;

        lista.push({ chave, de: primeiro < dataDe ? dataDe : primeiro, ate: ultimo > dataAte ? dataAte : ultimo });
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
    }

    return lista;
}

function montarLinha(soma, aliquota, despesasFixas) {
    const resultado = calcularResultado({ ...soma, aliquota });

    if (despesasFixas === null) {
        return { ...resultado, vendas: soma.vendas, despesas_fixas: null, lucro_apos_despesas_fixas: null, margem_apos_despesas_fixas_pct: null };
    }

    const lucroApos = arredondar(resultado.lucro_liquido - despesasFixas);

    return {
        ...resultado,
        vendas: soma.vendas,
        despesas_fixas: arredondar(despesasFixas),
        lucro_apos_despesas_fixas: lucroApos,
        margem_apos_despesas_fixas_pct: percentual(lucroApos, resultado.receita)
    };
}

const SOMA_ZERADA = { vendas: 0, receita: 0, custo: 0, comissao: 0 };

async function resultadoPeriodo({ data_de, data_ate, agrupar }, usuario) {
    const empresaId = usuario.empresa_id;
    const comFixas = podeVerDespesasFixas(usuario);

    const [aliquota, totalRows, serieRows, despesas] = await Promise.all([
        resultadoVendasRepository.obterAliquota(empresaId),
        resultadoVendasRepository.somarPeriodo(empresaId, data_de, data_ate, 'total'),
        agrupar ? resultadoVendasRepository.somarPeriodo(empresaId, data_de, data_ate, agrupar) : Promise.resolve([]),
        comFixas ? despesasFixasRepository.listarVigentesNoPeriodo(empresaId, data_de, data_ate) : Promise.resolve([])
    ]);

    const fixasDe = (de, ate) => (comFixas ? ratearCustoFixo(despesas, de, ate) : null);

    const resposta = {
        periodo: { data_de, data_ate },
        totais: montarLinha(totalRows[0] ?? SOMA_ZERADA, aliquota, fixasDe(data_de, data_ate)),
        // Sem despesas fixas cadastradas o resultado final é igual ao líquido: a tela avisa em vez de sugerir "meta batida".
        sem_despesas_fixas: comFixas ? despesas.length === 0 : null
    };

    if (agrupar) {
        const porChave = new Map(serieRows.map((r) => [r.balde, r]));

        resposta.serie = baldes(data_de, data_ate, agrupar).map(({ chave, de, ate }) => ({
            [agrupar]: chave,
            ...montarLinha(porChave.get(chave) ?? SOMA_ZERADA, aliquota, fixasDe(de, ate))
        }));
    }

    return resposta;
}

module.exports = { resultadoDasVendas, resultadoPeriodo, podeVerDespesasFixas, baldes };

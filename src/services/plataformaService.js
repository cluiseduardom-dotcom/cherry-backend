const plataformaRepository = require('../repositories/plataformaRepository');
const { reaisParaCentavos, centavosParaReais } = require('../utils/taxaPlataforma');

// Valores monetários sempre com 2 casas (o banco devolve "0" para soma vazia).
function dinheiro(valor) {
    return centavosParaReais(reaisParaCentavos(valor));
}

// Soma em centavos (inteiros) para o total geral não carregar erro de ponto flutuante.
function somar(items, campo) {
    return centavosParaReais(items.reduce((acc, item) => acc + reaisParaCentavos(item[campo]), 0));
}

async function taxasPorEmpresa(mesInformado) {
    const mes = mesInformado ?? await plataformaRepository.mesCorrente();
    const linhas = await plataformaRepository.taxasPorEmpresa(mes);

    const items = linhas.map((linha) => ({
        empresa_id: linha.empresa_id,
        empresa_nome: linha.empresa_nome,
        qtd_vendas: Number(linha.qtd_vendas),
        total_base: dinheiro(linha.total_base),
        total_taxa: dinheiro(linha.total_taxa),
        qtd_estornadas: Number(linha.qtd_estornadas),
        total_estornado: dinheiro(linha.total_estornado),
        percentuais: (linha.percentuais ?? []).map(Number)
    }));

    return {
        mes,
        items,
        totais: {
            qtd_vendas: items.reduce((acc, item) => acc + item.qtd_vendas, 0),
            total_base: somar(items, 'total_base'),
            total_taxa: somar(items, 'total_taxa')
        }
    };
}

module.exports = { taxasPorEmpresa };

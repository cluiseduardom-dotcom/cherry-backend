const vendasRepository = require('../repositories/vendasRepository');

async function resumo() {
    return vendasRepository.getResumo();
}

async function porDia() {
    return vendasRepository.getPorDia();
}

async function porMes() {
    return vendasRepository.getPorMes();
}

async function maisVendidos() {
    return vendasRepository.getMaisVendidosPeriodo();
}

async function criar(cliente_id, itens) {
    const total = itens.reduce((soma, item) => soma + item.quantidade * item.preco_unitario, 0);

    return vendasRepository.criar({ cliente_id, itens, total });
}

module.exports = {
    resumo,
    porDia,
    porMes,
    maisVendidos,
    criar
};

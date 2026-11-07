const AppError = require('../errors/AppError');

// Categorias, níveis e padrões de SKU existem em dois escopos: produtos acabados e insumos.
const ESCOPOS = Object.freeze(['produto', 'insumo']);
const ESCOPO_PADRAO = 'produto';

// Valor ausente = 'produto' (contrato antigo preservado). Valor inválido = 400.
function parseEscopo(valor) {
    if (valor === undefined || valor === null || valor === '') return ESCOPO_PADRAO;
    if (!ESCOPOS.includes(valor)) throw new AppError('Escopo inválido (use produto ou insumo)', 400);
    return valor;
}

const escopoDoTipo = (tipo) => (tipo === 'insumo' ? 'insumo' : 'produto');

module.exports = { ESCOPOS, ESCOPO_PADRAO, parseEscopo, escopoDoTipo };

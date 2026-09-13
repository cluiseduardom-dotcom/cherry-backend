const sequenciasSkuRepository = require('../repositories/sequenciasSkuRepository');

function contemLetra(codigo) {
    return /[A-Z]/.test(codigo.toUpperCase());
}

// Letras sempre na frente, números depois — cada bloco ordenado por nível
// ascendente entre si. Regra fechada no CLAUDE.md (ver Task 12).
function ordenarPorGrupo(categorias) {
    const ordenadasPorNivel = [...categorias].sort((a, b) => a.nivel - b.nivel);
    const letras = ordenadasPorNivel.filter((c) => contemLetra(c.codigo));
    const numeros = ordenadasPorNivel.filter((c) => !contemLetra(c.codigo));
    return [...letras, ...numeros];
}

function montarChaveCombinacao(categorias) {
    return ordenarPorGrupo(categorias).map((c) => c.codigo.toUpperCase()).join('-');
}

function formatarSku(categorias, contador) {
    const sequencia = String(contador).padStart(3, '0');
    return ordenarPorGrupo(categorias).map((c) => c.codigo.toUpperCase()).join('') + sequencia;
}

async function gerar(categorias, empresaId, client) {
    const chave = montarChaveCombinacao(categorias);
    const contador = await sequenciasSkuRepository.incrementarContador(chave, empresaId, client);
    return formatarSku(categorias, contador);
}

module.exports = { montarChaveCombinacao, formatarSku, gerar };

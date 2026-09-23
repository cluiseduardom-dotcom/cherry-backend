const configuracoesSkuRepository = require('../repositories/configuracoesSkuRepository');
const sequenciasSkuRepository = require('../repositories/sequenciasSkuRepository');
const AppError = require('../errors/AppError');

const SEPARADORES_PERMITIDOS = new Set(['-', '_', '/', 'x', '*', '+']);

function validarSeparador(separador) {
    const valor = String(separador ?? '');
    if (valor.length > 1) {
        throw new AppError('O separador do SKU deve ter no máximo um caractere', 400);
    }
    if (valor && !SEPARADORES_PERMITIDOS.has(valor)) {
        throw new AppError('Separador de SKU não permitido', 400);
    }
    return valor;
}

function normalizarCodigo(codigo) {
    const valor = String(codigo ?? '').trim().toUpperCase();

    if (!valor || !/^[A-Z0-9]+$/.test(valor)) {
        throw new AppError('Código de segmento deve conter apenas letras e números', 400);
    }

    return valor;
}

async function obterConfiguracao(categorias, empresaId, client) {
    const categoriaIds = categorias.map((categoria) => Number(categoria.id)).filter(Number.isInteger);
    const resolver = configuracoesSkuRepository.buscarParaCategorias || configuracoesSkuRepository.buscarAtiva;
    const config = categoriaIds.length
        ? await resolver(categoriaIds, empresaId, client)
        : await configuracoesSkuRepository.buscarAtiva(empresaId, client);

    if (!config) {
        throw new AppError('Configuração de SKU não encontrada para esta empresa', 409);
    }

    validarSeparador(config.separador);
    return config;
}

function montarSegmentos(categorias, configuracao) {
    const categoriasPorNivel = new Map(
        categorias.map((categoria) => [Number(categoria.nivel), categoria])
    );

    return configuracao.segmentos
        .filter((segmento) => segmento.participa_sku)
        .sort((a, b) => a.ordem - b.ordem)
        .map((segmento) => {
            const categoria = categoriasPorNivel.get(Number(segmento.nivel));

            if (!categoria) {
                if (segmento.obrigatorio) {
                    throw new AppError(
                        `O nível ${segmento.nivel} é obrigatório para gerar o SKU`,
                        400
                    );
                }
                return null;
            }

            return normalizarCodigo(categoria.codigo);
        })
        .filter(Boolean);
}

function montarChaveCombinacao(codigos) {
    return codigos.join('-');
}

function formatarSequencia(contador, configuracao) {
    const numero = BigInt(contador);

    if (configuracao.tipo_sku === 'alfabetico') {
        let n = numero < 1n ? 1n : numero;
        let resultado = '';

        while (n > 0n) {
            n -= 1n;
            resultado = String.fromCharCode(65 + Number(n % 26n)) + resultado;
            n = n / 26n;
        }

        return resultado.padStart(Number(configuracao.tamanho_sequencia), 'A');
    }

    const texto = numero.toString();
    return texto.padStart(Number(configuracao.tamanho_sequencia), '0');
}

function formatarSku(codigos, contador, configuracao) {
    const separador = validarSeparador(configuracao.separador);
    const sequencia = formatarSequencia(contador, configuracao);

    return [
        configuracao.prefixo,
        ...codigos,
        sequencia,
        configuracao.sufixo
    ].filter(Boolean).join(separador);
}

async function gerar(categorias, empresaId, client) {
    const configuracao = await obterConfiguracao(categorias, empresaId, client);
    const codigos = montarSegmentos(categorias, configuracao);

    if (!codigos.length && !configuracao.prefixo && !configuracao.sufixo) {
        // A sequência sozinha continua sendo um SKU válido quando a empresa
        // deliberadamente configurou zero segmentos.
    }

    const chave = montarChaveCombinacao(codigos);
    const contador = await sequenciasSkuRepository.incrementarContador(
        chave,
        empresaId,
        configuracao.id,
        configuracao.inicio_sequencia,
        client
    );

    return {
        sku: formatarSku(codigos, contador, configuracao),
        configuracao
    };
}

module.exports = {
    SEPARADORES_PERMITIDOS,
    validarSeparador,
    normalizarCodigo,
    montarChaveCombinacao,
    formatarSku,
    formatarSequencia,
    montarSegmentos,
    gerar
};

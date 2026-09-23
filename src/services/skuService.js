const configuracoesSkuRepository = require('../repositories/configuracoesSkuRepository');
const sequenciasSkuRepository = require('../repositories/sequenciasSkuRepository');
const AppError = require('../errors/AppError');

function validarCodigo(codigo, tipo) {
    const valor = String(codigo).toUpperCase();

    if (tipo === 'numerico' && !/^\\d+$/.test(valor)) {
        throw new AppError(`O código ${valor} não é compatível com SKU numérico`, 400);
    }

    if (tipo === 'alfabetico' && !/^[A-Z]+$/.test(valor)) {
        throw new AppError(`O código ${valor} não é compatível com SKU alfabético`, 400);
    }

    if (tipo === 'alfanumerico' && !/^[A-Z0-9]+$/.test(valor)) {
        throw new AppError(`O código ${valor} contém caracteres incompatíveis com SKU alfanumérico`, 400);
    }

    return valor;
}

async function obterConfiguracao(empresaId, client) {
    const config = await configuracoesSkuRepository.buscarAtiva(empresaId, client);

    if (!config) {
        throw new AppError('Configuração de SKU não encontrada para esta empresa', 409);
    }

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

            return validarCodigo(categoria.codigo, configuracao.tipo_sku);
        })
        .filter(Boolean);
}

function montarChaveCombinacao(codigos) {
    return codigos.join('-');
}

function formatarSku(codigos, contador, configuracao) {
    const sequencia = String(contador).padStart(configuracao.tamanho_sequencia, '0');

    return [
        configuracao.prefixo,
        ...codigos,
        sequencia,
        configuracao.sufixo
    ].filter(Boolean).join(configuracao.separador);
}

async function gerar(categorias, empresaId, client) {
    const configuracao = await obterConfiguracao(empresaId, client);
    const codigos = montarSegmentos(categorias, configuracao);

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
    montarChaveCombinacao,
    formatarSku,
    montarSegmentos,
    gerar
};

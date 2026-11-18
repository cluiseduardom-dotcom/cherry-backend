'use strict';

// Importação de lista (produtos com custo e saldo inicial, clientes). Contrato em docs/IMPORTACAO_LISTA_API.md.
const LIMITES = Object.freeze({
    MAX_BYTES: 5 * 1024 * 1024,
    MAX_LINHAS: 2000,
    MAX_COLUNAS: 30,
    MAX_SALDO: 1000000,
    TTL_PREVIA_MINUTOS: 30,
    MAX_PROBLEMAS_NA_RESPOSTA: 1000,
    PREVIAS_POR_HORA: 10
});

const TIPOS_IMPORTACAO = Object.freeze(['produtos', 'clientes']);

// Chave de coluna = cabeçalho sem acento, minúsculo e sem espaço, hífen ou sublinhado.
const COLUNAS = Object.freeze({
    produtos: Object.freeze({
        obrigatorias: Object.freeze(['nome', 'custo']),
        opcionais: Object.freeze(['saldo', 'sku', 'categoria', 'local'])
    }),
    clientes: Object.freeze({
        obrigatorias: Object.freeze(['nome', 'telefone']),
        opcionais: Object.freeze(['nascimento', 'observacoes'])
    })
});

const SINONIMOS_COLUNA = Object.freeze({
    observacao: 'observacoes',
    datanascimento: 'nascimento',
    datadenascimento: 'nascimento',
    celular: 'telefone',
    whatsapp: 'telefone'
});

// Colunas conhecidas que a v1 deliberadamente não importa: viram aviso, não erro.
const COLUNAS_NAO_IMPORTADAS = Object.freeze({
    preco: 'Preço de venda não é importado: depois da importação, defina em "Precificar por canal"',
    precovenda: 'Preço de venda não é importado: depois da importação, defina em "Precificar por canal"',
    precodevenda: 'Preço de venda não é importado: depois da importação, defina em "Precificar por canal"'
});

module.exports = { LIMITES, TIPOS_IMPORTACAO, COLUNAS, SINONIMOS_COLUNA, COLUNAS_NAO_IMPORTADAS };

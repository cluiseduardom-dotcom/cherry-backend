'use strict';

const { parseNome, parseCusto, parseSaldo, parseSku } = require('./campos');
const { limparTexto, normalizarParaComparar } = require('./texto');

const ERRO = 'erro';
const AVISO = 'aviso';

// contexto (tudo da empresa do JWT, carregado em consultas únicas pelo service):
//   skusExistentes   Set de SKUs (maiúsculos) já cadastrados
//   nomesExistentes  Set de nomes normalizados dos produtos vendáveis já cadastrados
//   categorias       Map nome normalizado -> [{ id, nome, nivel }]
//   skuGeravel       Map categoria_id -> { ok, motivo }  (se o padrão de SKU consegue gerar com ESSA categoria sozinha)
//   locais           Map nome normalizado -> [{ id, nome }]
//   localPadraoId    id do local do estoque inicial quando a linha não informa (null = Central ainda a criar)
//   saldoTravado     true quando a empresa já lançou o estoque inicial
//
// Devolve, por linha: acao 'criar' | 'ignorar' | 'erro', problemas e, quando 'criar', os dados normalizados.
function validarProdutos(linhas, contexto) {
    const skusVistos = new Map();
    const nomesVistos = new Map();

    return linhas.map(({ linha, valores, colunasAMais }) => {
        const problemas = [];
        const erro = (coluna, motivo) => problemas.push({ coluna, nivel: ERRO, motivo });
        const aviso = (coluna, motivo) => problemas.push({ coluna, nivel: AVISO, motivo });

        if (colunasAMais) {
            erro(null, 'a linha tem mais colunas que o cabeçalho; se o nome tem ";" ou ",", coloque o texto entre aspas');
        }

        const nome = parseNome(valores.nome);
        if (nome.erro) erro('nome', nome.erro);

        const custo = limparTexto(valores.custo) === '' ? { erro: 'o custo é obrigatório' } : parseCusto(valores.custo);
        if (custo.erro) erro('custo', custo.erro);

        const saldo = parseSaldo(valores.saldo);
        if (saldo.erro) erro('saldo', saldo.erro);
        else if (saldo.valor > 0 && contexto.saldoTravado) erro('saldo', 'saldo inicial já lançado para esta empresa; deixe o saldo vazio');

        const skuTexto = limparTexto(valores.sku);
        const sku = skuTexto === '' ? null : parseSku(skuTexto);
        if (sku?.erro) erro('sku', sku.erro);

        let categoria = null;
        const categoriaTexto = limparTexto(valores.categoria);
        if (categoriaTexto !== '') {
            const achadas = contexto.categorias.get(normalizarParaComparar(categoriaTexto)) ?? [];
            if (achadas.length > 1) {
                erro('categoria', `há mais de uma categoria chamada "${categoriaTexto}"; renomeie ou informe o SKU`);
            } else if (achadas.length === 1) {
                categoria = achadas[0];
            } else if (skuTexto !== '') {
                aviso('categoria', `categoria "${categoriaTexto}" não encontrada; o produto será criado sem categoria`);
            } else {
                erro('categoria', `categoria "${categoriaTexto}" não encontrada e SKU não informado; cadastre a categoria ou informe o SKU`);
            }
        }

        const precisaGerarSku = skuTexto === '';
        if (precisaGerarSku && !categoria && categoriaTexto === '') {
            erro('sku', 'informe o SKU ou uma categoria existente para o sistema gerar o SKU');
        }
        if (precisaGerarSku && categoria) {
            const geravel = contexto.skuGeravel.get(categoria.id);
            if (geravel && !geravel.ok) erro('categoria', geravel.motivo);
        }

        let localId = contexto.localPadraoId;
        const localTexto = limparTexto(valores.local);
        if (localTexto !== '') {
            const achados = contexto.locais.get(normalizarParaComparar(localTexto)) ?? [];
            if (achados.length === 0) erro('local', `local "${localTexto}" não encontrado`);
            else if (achados.length > 1) erro('local', `há mais de um local chamado "${localTexto}"; renomeie um deles`);
            else localId = achados[0].id;
        }

        if (problemas.some((p) => p.nivel === ERRO)) {
            return { linha, acao: 'erro', problemas };
        }

        const nomeNormalizado = normalizarParaComparar(nome.valor);
        const duplicado = [];

        if (sku && contexto.skusExistentes.has(sku.valor)) duplicado.push(`já existe produto com o SKU ${sku.valor}`);
        else if (sku && skusVistos.has(sku.valor)) duplicado.push(`SKU ${sku.valor} repetido no arquivo (linha ${skusVistos.get(sku.valor)})`);

        if (contexto.nomesExistentes.has(nomeNormalizado)) duplicado.push('já existe produto com este nome');
        else if (nomesVistos.has(nomeNormalizado)) duplicado.push(`nome repetido no arquivo (linha ${nomesVistos.get(nomeNormalizado)})`);

        if (duplicado.length) {
            aviso(null, `${duplicado.join('; ')}; a linha foi ignorada`);
            return { linha, acao: 'ignorar', problemas };
        }

        if (sku) skusVistos.set(sku.valor, linha);
        nomesVistos.set(nomeNormalizado, linha);

        return {
            linha,
            acao: 'criar',
            problemas,
            dados: {
                nome: nome.valor,
                custo: custo.valor,
                saldo: saldo.valor,
                sku: sku ? sku.valor : null,
                categoria_id: categoria ? categoria.id : null,
                local_id: localId
            }
        };
    });
}

module.exports = { validarProdutos };

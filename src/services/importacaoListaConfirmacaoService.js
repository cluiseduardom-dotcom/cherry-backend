const crypto = require('node:crypto');
const AppError = require('../errors/AppError');
const gravacao = require('../repositories/importacaoListaGravacaoRepository');
const importacaoListaRepository = require('../repositories/importacaoListaRepository');
const estoqueRepository = require('../repositories/estoqueRepository');
const skuService = require('./skuService');
const { candidatosCodigoInterno } = require('./produtosCodigosService');
const { telefoneParaComparar } = require('./importacaoLista/campos');
const { normalizarParaComparar } = require('./importacaoLista/texto');
const { montarCsv } = require('./importacaoLista/relatorioCsv');

const MENSAGEM_PREVIA = 'Prévia não encontrada, já confirmada ou expirada. Envie o arquivo novamente';

function resumoVazio() {
    return { criados: 0, ignorados: 0, nao_importados: 0, skus_gerados: 0, com_estoque_inicial: 0, unidades_estoque_inicial: 0, codigos_gerados: 0 };
}

// Produtos: cria tudo ou nada. O estoque inicial vai por estoqueRepository.criarEntradasIniciaisEmLote (entrada, origem
// 'estoque_inicial', só em produto sem histórico), então a soma dos locais continua fechando com estoque_atual.
async function gravarProdutos(client, { importacao, registros, usuario, lancadoEm }) {
    const empresaId = usuario.empresa_id;
    const resumo = resumoVazio();
    const linhas = [];

    if (registros.some((r) => r.saldo > 0) && lancadoEm) {
        throw new AppError('O saldo inicial já foi lançado para esta empresa. Refaça a prévia sem a coluna de saldo', 409);
    }

    // Outra operação pode ter cadastrado o mesmo SKU ou nome depois da prévia: vira "ignorado", não erro.
    const existentes = await importacaoListaRepository.buscarProdutosExistentes(empresaId, client);
    const skus = new Set(existentes.filter((p) => p.sku).map((p) => String(p.sku).toUpperCase()));
    const nomes = new Set(existentes.filter((p) => p.tipo !== 'insumo').map((p) => normalizarParaComparar(p.nome)));

    const aCriar = [];
    for (const r of registros) {
        const motivo = (r.sku && skus.has(r.sku) && 'já existe produto com este SKU')
            || (nomes.has(normalizarParaComparar(r.nome)) && 'já existe produto com este nome');
        if (motivo) {
            resumo.ignorados += 1;
            linhas.push({ linha: r.linha, resultado: 'ignorado', nome: r.nome, detalhe: `${motivo} (cadastrado depois da prévia)` });
        } else {
            aCriar.push({ ...r });
        }
    }

    const categoriaIds = [...new Set(aCriar.map((r) => r.categoria_id).filter(Boolean))];
    const categorias = new Map((await gravacao.buscarCategoriasPorIds(client, categoriaIds, empresaId)).map((c) => [c.id, c]));
    if (categorias.size !== categoriaIds.length) {
        throw new AppError('Uma categoria do arquivo foi removida depois da prévia. Refaça a prévia', 409);
    }

    const base = { empresa_id: empresaId, importacao_id: importacao.id };
    const idPorSku = await gravacao.inserirProdutos(client, { ...base, produtos: aCriar.filter((r) => r.sku) });

    // SKU gerado só depois dos informados já estarem gravados: o gerador pula número ocupado.
    let totalGeradas = 0;
    const configuracaoPorCategoria = new Map();
    for (const r of aCriar.filter((p) => !p.sku)) {
        const gerado = await skuService.gerar([categorias.get(r.categoria_id)], empresaId, client, 'produto', configuracaoPorCategoria.get(r.categoria_id));
        configuracaoPorCategoria.set(r.categoria_id, gerado.configuracao);
        r.sku = gerado.sku;
        r.sku_gerado = true;
        r.configuracao_id = gerado.configuracao.id;
        totalGeradas += 1;
    }
    for (const [sku, id] of await gravacao.inserirProdutos(client, { ...base, produtos: aCriar.filter((p) => p.sku_gerado) })) {
        idPorSku.set(sku, id);
    }

    for (const r of aCriar) r.produto_id = idPorSku.get(r.sku);

    await gravacao.vincularCategorias(client, {
        empresa_id: empresaId,
        vinculos: aCriar.filter((r) => r.categoria_id).map((r) => ({ produto_id: r.produto_id, categoria_id: r.categoria_id }))
    });
    await gravacao.registrarSkusGerados(client, {
        empresa_id: empresaId,
        usuario_id: usuario.id,
        itens: aCriar.filter((r) => r.sku_gerado).map((r) => ({ produto_id: r.produto_id, sku: r.sku, configuracao_id: r.configuracao_id }))
    });

    // Estoque inicial em bloco: o produto é novo (saldo 0, sem histórico), então a entrada é uma só instrução por etapa.
    const comSaldoLinhas = aCriar.filter((p) => p.saldo > 0);
    const entrada = await estoqueRepository.criarEntradasIniciaisEmLote({
        itens: comSaldoLinhas.map((r) => ({ produto_id: r.produto_id, quantidade: r.saldo, local_id: r.local_id })),
        usuario_id: usuario.id,
        empresa_id: empresaId
    }, client);

    if (entrada.erro === 'LOCAL_NAO_ENCONTRADO') {
        const linha = comSaldoLinhas.find((r) => r.local_id === entrada.local_id)?.linha;
        throw new AppError(`O local${linha ? ` da linha ${linha}` : ''} não está mais disponível. Refaça a prévia`, 409);
    }
    if (entrada.erro) {
        throw new AppError(`Não foi possível lançar o estoque inicial (${entrada.erro}). Refaça a prévia`, 409);
    }

    resumo.com_estoque_inicial = entrada.movimentacoes;
    resumo.unidades_estoque_inicial = entrada.unidades;

    // Quem entra com saldo ganha código interno para a etiqueta (a regra do código de barras é "nasce com a entrada").
    const comSaldo = aCriar.filter((r) => r.saldo > 0).map((r) => r.produto_id);
    const codigos = await gravacao.inserirCodigosInternos(client, {
        empresa_id: empresaId,
        usuario_id: usuario.id,
        produto_ids: comSaldo,
        candidatos: [0, 1].map((i) => (id) => candidatosCodigoInterno(id)[i])
    });
    if (codigos.sem_codigo.length) {
        throw new AppError('Não foi possível gerar o código de barras de todos os produtos. Tente novamente', 409);
    }
    resumo.codigos_gerados = codigos.criados;

    if (resumo.com_estoque_inicial > 0) await gravacao.gravarTravaEstoqueInicial(client, empresaId);

    resumo.criados = aCriar.length;
    resumo.skus_gerados = totalGeradas;

    for (const r of aCriar) {
        linhas.push({ linha: r.linha, resultado: 'criado', id: r.produto_id, nome: r.nome, sku: r.sku, saldo: r.saldo, detalhe: r.sku_gerado ? 'SKU gerado' : '' });
    }

    return { resumo, linhas, sem_preco: aCriar.length };
}

async function gravarClientes(client, { importacao, registros, usuario }) {
    const empresaId = usuario.empresa_id;
    const resumo = resumoVazio();
    const linhas = [];

    const telefones = new Set((await importacaoListaRepository.buscarTelefonesDeClientes(empresaId, client)).map(telefoneParaComparar));
    const aCriar = [];
    for (const r of registros) {
        if (telefones.has(r.telefone)) {
            resumo.ignorados += 1;
            linhas.push({ linha: r.linha, resultado: 'ignorado', detalhe: 'já existe cliente com este telefone (cadastrado depois da prévia)' });
        } else {
            aCriar.push(r);
        }
    }

    const idPorTelefone = await gravacao.inserirClientes(client, {
        empresa_id: empresaId, importacao_id: importacao.id, usuario_id: usuario.id, clientes: aCriar
    });

    resumo.criados = aCriar.length;
    for (const r of aCriar) linhas.push({ linha: r.linha, resultado: 'criado', id: idPorTelefone.get(r.telefone), detalhe: '' });

    return { resumo, linhas };
}

// Confirma uma prévia: consome o token (uso único) e grava tudo numa única transação, sob lock da importação e da
// empresa (duas importações da mesma empresa nunca correm juntas). Qualquer falha desfaz tudo, inclusive o consumo do token.
async function confirmar({ token, somenteValidas }, usuario) {
    const empresaId = usuario.empresa_id;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const previa = await gravacao.buscarPreviaPorToken(tokenHash, empresaId);
    if (!previa) throw new AppError(MENSAGEM_PREVIA, 404);
    if (previa.expirada) throw new AppError('A prévia expirou. Envie o arquivo novamente', 410);

    return gravacao.comImportacaoTravada(previa.importacao_id, empresaId, async (importacao, client) => {
        if (!importacao) throw new AppError(MENSAGEM_PREVIA, 404);
        if (importacao.status !== 'previa') throw new AppError('Esta importação já foi confirmada', 409);

        if (importacao.total_com_erro > 0 && !somenteValidas) {
            throw new AppError(
                `A prévia tem ${importacao.total_com_erro} linha(s) com erro. Corrija o arquivo e reenvie, ou confirme somente as linhas válidas`,
                409
            );
        }

        const dados = await gravacao.consumirPrevia(client, { importacao_id: importacao.id, token_hash: tokenHash, empresa_id: empresaId });
        if (!dados) throw new AppError('A prévia expirou. Envie o arquivo novamente', 410);

        const lancadoEm = await gravacao.travarEmpresa(client, empresaId);
        const gravar = dados.tipo === 'produtos' ? gravarProdutos : gravarClientes;
        const { resumo, linhas, sem_preco: semPreco } = await gravar(client, { importacao, registros: dados.registros, usuario, lancadoEm });

        resumo.ignorados += dados.ignoradas.length;
        resumo.nao_importados = dados.erros.length ? new Set(dados.erros.map((e) => e.linha)).size : 0;

        for (const i of dados.ignoradas) linhas.push({ linha: i.linha, resultado: 'ignorado', detalhe: i.motivo });
        for (const e of dados.erros) {
            linhas.push({ linha: e.linha, resultado: 'nao_importado', detalhe: e.coluna ? `${e.coluna}: ${e.motivo}` : e.motivo });
        }
        linhas.sort((a, b) => a.linha - b.linha);

        await gravacao.marcarConfirmada(client, {
            importacao_id: importacao.id,
            empresa_id: empresaId,
            usuario_id: usuario.id,
            relatorio: { versao: 1, resumo, linhas }
        });

        return {
            importacao_id: importacao.id,
            tipo: dados.tipo,
            ...resumo,
            ...(semPreco !== undefined ? { sem_preco: semPreco } : {}),
            relatorio_url: `/importacao/${importacao.id}/relatorio`
        };
    });
}

async function relatorioCsv(importacaoId, usuario) {
    const importacao = await gravacao.buscarRelatorio(importacaoId, usuario.empresa_id);

    if (!importacao) throw new AppError('Importação não encontrada', 404);
    if (importacao.status !== 'confirmada' || !importacao.relatorio) {
        throw new AppError('O relatório só existe depois da confirmação da importação', 409);
    }

    return { nome: `relatorio-importacao-${importacao.id}.csv`, conteudo: montarCsv(importacao.tipo, importacao.relatorio.linhas) };
}

module.exports = { confirmar, relatorioCsv };

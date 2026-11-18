const crypto = require('node:crypto');
const path = require('node:path');
const AppError = require('../errors/AppError');
const importacaoListaRepository = require('../repositories/importacaoListaRepository');
const configuracoesSkuRepository = require('../repositories/configuracoesSkuRepository');
const { LIMITES, COLUNAS } = require('../constants/importacaoLista');
const { hojeSP } = require('../utils/dataSaoPaulo');
const { decodificar, lerRegistros } = require('./importacaoLista/csv');
const { extrairLinhas } = require('./importacaoLista/planilha');
const { validarProdutos } = require('./importacaoLista/validadorProdutos');
const { validarClientes } = require('./importacaoLista/validadorClientes');
const { limparTexto, normalizarParaComparar } = require('./importacaoLista/texto');

// Planilha-modelo: só o cabeçalho, em português. Sem linha de exemplo, para ninguém importar "Produto exemplo" sem querer.
function gerarModelo(tipo, formato) {
    if (formato !== 'csv') {
        throw new AppError('Por enquanto só o formato CSV está disponível', 400);
    }

    const { obrigatorias, opcionais } = COLUNAS[tipo];
    const colunas = [...obrigatorias, ...opcionais];
    // BOM + ponto e vírgula: o Excel em português abre com acento e colunas certas.
    return { nome: `modelo-${tipo}.csv`, conteudo: `﻿${colunas.join(';')}\r\n` };
}

function nomeSeguroDoArquivo(nome) {
    const base = path.basename(String(nome ?? 'arquivo.csv').replace(/\\/g, '/'));
    return limparTexto(base).slice(0, 255) || 'arquivo.csv';
}

// Telefone já cadastrado, no mesmo formato do que a importação normaliza (só dígitos, sem DDI nem zero inicial).
function telefoneParaComparar(telefone) {
    let digitos = String(telefone ?? '').replace(/\D/g, '');
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
    else if (digitos.length > 10 && digitos.startsWith('0')) digitos = digitos.replace(/^0+/, '');
    return digitos;
}

function indexarPorNome(itens) {
    const mapa = new Map();
    for (const item of itens) {
        const chave = normalizarParaComparar(item.nome);
        if (!mapa.has(chave)) mapa.set(chave, []);
        mapa.get(chave).push(item);
    }
    return mapa;
}

// Dry-run do gerador de SKU (não consome a sequência): com UMA categoria, o padrão só gera se todo nível obrigatório
// que entra no SKU for o dessa categoria. Senão a gravação falharia no meio, e a prévia precisa avisar antes.
async function verificarSkuGeravel(categoria, empresaId) {
    try {
        const configuracao = await configuracoesSkuRepository.buscarParaCategorias([categoria.id], empresaId, undefined, 'produto');
        if (!configuracao) {
            return { ok: false, motivo: 'a empresa não tem padrão de SKU configurado para gerar o SKU desta categoria; informe o SKU' };
        }

        const faltando = (configuracao.segmentos ?? []).filter(
            (s) => s.participa_sku && s.obrigatorio && Number(s.nivel) !== Number(categoria.nivel)
        );

        if (faltando.length) {
            return {
                ok: false,
                motivo: `o padrão de SKU exige também o nível "${faltando[0].nome}"; com só esta categoria o SKU não pode ser gerado. Informe o SKU`
            };
        }
        return { ok: true };
    } catch (error) {
        if (error instanceof AppError) {
            return { ok: false, motivo: 'a empresa não tem padrão de SKU configurado para gerar o SKU desta categoria; informe o SKU' };
        }
        throw error;
    }
}

async function prepararContextoProdutos(linhas, empresaId, localPadraoId) {
    const [produtos, categorias, locais, lancadoEm] = await Promise.all([
        importacaoListaRepository.buscarProdutosExistentes(empresaId),
        importacaoListaRepository.buscarCategoriasDeProduto(empresaId),
        importacaoListaRepository.buscarLocaisImportaveis(empresaId),
        importacaoListaRepository.buscarEstoqueInicialLancadoEm(empresaId)
    ]);

    let localPadrao = null;
    if (localPadraoId === undefined) {
        localPadrao = locais.find((l) => l.tipo === 'central') ?? null;
    } else {
        localPadrao = locais.find((l) => l.id === localPadraoId);
        if (!localPadrao) throw new AppError('Local padrão do estoque inicial não encontrado', 404);
    }

    const categoriasPorNome = indexarPorNome(categorias);
    const usadas = new Map();
    for (const { valores } of linhas) {
        const achadas = categoriasPorNome.get(normalizarParaComparar(valores.categoria)) ?? [];
        if (achadas.length === 1) usadas.set(achadas[0].id, achadas[0]);
    }

    const skuGeravel = new Map();
    for (const categoria of usadas.values()) {
        skuGeravel.set(categoria.id, await verificarSkuGeravel(categoria, empresaId));
    }

    return {
        skusExistentes: new Set(produtos.filter((p) => p.sku).map((p) => String(p.sku).toUpperCase())),
        // Insumo tem tela própria e não conflita com produto vendável.
        nomesExistentes: new Set(produtos.filter((p) => p.tipo !== 'insumo').map((p) => normalizarParaComparar(p.nome))),
        categorias: categoriasPorNome,
        skuGeravel,
        locais: indexarPorNome(locais),
        localPadraoId: localPadrao ? localPadrao.id : null,
        saldoTravado: lancadoEm !== null
    };
}

function consolidar(resultados, avisosDeArquivo, ignoradas) {
    const totais = { linhas: resultados.length, a_criar: 0, ignoradas: 0, com_aviso: 0, com_erro: 0, validas: 0 };
    const problemas = [];

    for (const r of resultados) {
        if (r.acao === 'criar') totais.a_criar += 1;
        else if (r.acao === 'ignorar') totais.ignoradas += 1;
        else totais.com_erro += 1;

        const temAviso = r.problemas.some((p) => p.nivel === 'aviso');
        if (temAviso) totais.com_aviso += 1;
        if (r.acao === 'criar' && !temAviso) totais.validas += 1;

        for (const p of r.problemas) problemas.push({ linha: r.linha, coluna: p.coluna, nivel: p.nivel, motivo: p.motivo });
    }

    const truncados = problemas.length > LIMITES.MAX_PROBLEMAS_NA_RESPOSTA;

    return {
        totais,
        problemas: truncados ? problemas.slice(0, LIMITES.MAX_PROBLEMAS_NA_RESPOSTA) : problemas,
        problemas_truncados: truncados,
        avisos_do_arquivo: avisosDeArquivo,
        colunas_ignoradas: ignoradas
    };
}

// Lê, normaliza e valida o arquivo SEM gravar dado de negócio. Só registra a trilha (`importacoes`) e a prévia pendente.
// `usuario` é o req.usuario: empresa_id e id vêm sempre do JWT.
async function previa({ tipo, arquivo, localPadraoId }, usuario) {
    const empresaId = usuario.empresa_id;

    if (!arquivo || !Buffer.isBuffer(arquivo.buffer)) {
        throw new AppError('Envie o arquivo CSV no campo "arquivo"', 400);
    }

    const texto = decodificar(arquivo.buffer);
    const { registros } = lerRegistros(texto);
    const { linhas, ignoradas, avisosDeArquivo } = extrairLinhas(registros, tipo);

    await importacaoListaRepository.expirarPreviasVencidas(empresaId);

    let resultados;
    let localResolvidoId;
    if (tipo === 'produtos') {
        const contexto = await prepararContextoProdutos(linhas, empresaId, localPadraoId);
        localResolvidoId = contexto.localPadraoId;
        resultados = validarProdutos(linhas, contexto);
    } else {
        const telefones = await importacaoListaRepository.buscarTelefonesDeClientes(empresaId);
        resultados = validarClientes(linhas, {
            telefonesExistentes: new Set(telefones.map(telefoneParaComparar)),
            hoje: hojeSP()
        });
    }

    const { totais, ...resumo } = consolidar(resultados, avisosDeArquivo, ignoradas);
    const aCriar = resultados.filter((r) => r.acao === 'criar').map((r) => ({ linha: r.linha, ...r.dados }));

    const token = aCriar.length ? crypto.randomBytes(32).toString('base64url') : null;

    const registro = await importacaoListaRepository.registrarPrevia({
        empresa_id: empresaId,
        usuario_id: usuario.id,
        tipo,
        nome_arquivo: nomeSeguroDoArquivo(arquivo.originalname),
        hash_sha256: crypto.createHash('sha256').update(arquivo.buffer).digest('hex'),
        local_padrao_id: localResolvidoId,
        totais,
        previa: token
            ? {
                token_hash: crypto.createHash('sha256').update(token).digest('hex'),
                dados: { tipo, registros: aCriar },
                ttl_minutos: LIMITES.TTL_PREVIA_MINUTOS
            }
            : null
    });

    return {
        importacao_id: registro.id,
        tipo,
        token,
        expira_em: registro.expira_em,
        totais: {
            linhas: totais.linhas,
            validas: totais.validas,
            com_aviso: totais.com_aviso,
            com_erro: totais.com_erro,
            a_criar: totais.a_criar,
            ignoradas: totais.ignoradas
        },
        pode_confirmar: totais.com_erro === 0 && totais.a_criar > 0,
        pode_confirmar_somente_validas: totais.com_erro > 0 && totais.a_criar > 0,
        ...resumo
    };
}

module.exports = { gerarModelo, previa };

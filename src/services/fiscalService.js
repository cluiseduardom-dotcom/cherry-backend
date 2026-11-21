const AppError = require('../errors/AppError');
const fiscalRepository = require('../repositories/fiscalRepository');
const { cnpjValido, normalizarCnpj, UFS } = require('../utils/documentos');
const { municipioCombinaComUf, REGIMES_TRIBUTARIOS } = require('../utils/fiscal');

// Preparo fiscal: só cadastro e diagnóstico. Não valida regra tributária (é do contador) nem emite nota.

const AVISOS = [
    'Esta etapa só prepara o cadastro: nenhuma nota fiscal é emitida.',
    'Regime, CST/CSOSN, CFOP, alíquotas e os campos de IBS/CBS da reforma tributária dependem do seu contador e das notas técnicas vigentes; o sistema ainda não os modela.',
    'Certificado digital, CSC e série da NFC-e ainda não são cadastrados aqui.',
    'NCM e CEST são conferidos só pelo formato, não contra a tabela oficial.'
];

const COLUNAS_FISCAIS = ['regime_tributario', 'inscricao_estadual', 'inscricao_municipal', 'cnae_principal', 'codigo_municipio_ibge', 'ambiente'];

function apresentarEmpresa(linha) {
    return {
        empresa: {
            razao_social: linha.razao_social ?? null, cnpj: linha.cnpj ?? null, cep: linha.cep ?? null, logradouro: linha.logradouro ?? null,
            numero: linha.numero ?? null, complemento: linha.complemento ?? null, bairro: linha.bairro ?? null, cidade: linha.cidade ?? null, uf: linha.uf ?? null
        },
        fiscal: Object.fromEntries(COLUNAS_FISCAIS.map((c) => [c, linha[c] ?? (c === 'ambiente' ? 'homologacao' : null)]))
    };
}

async function obterEmpresa(usuario) {
    const linha = await fiscalRepository.buscarEmpresa(usuario.empresa_id);

    if (!linha) throw new AppError('Empresa não encontrada', 404);

    return apresentarEmpresa(linha);
}

async function salvarEmpresa(dados, usuario) {
    const atual = await fiscalRepository.buscarEmpresa(usuario.empresa_id);

    if (!atual) throw new AppError('Empresa não encontrada', 404);

    // O município precisa ser da UF cadastrada da empresa (pega código de outro estado). Sem UF cadastrada, não há o que conferir.
    const ibge = dados.codigo_municipio_ibge;

    if (ibge && atual.uf && !municipioCombinaComUf(ibge, atual.uf)) {
        throw new AppError(`O código do município não pertence à UF da empresa (${atual.uf})`, 400);
    }

    await fiscalRepository.salvarFiscalEmpresa(usuario.empresa_id, usuario.id, dados);

    return obterEmpresa(usuario);
}

async function listarProdutos({ filtro, q, page, pageSize }, usuario) {
    const { items, total } = await fiscalRepository.listarProdutos({ empresaId: usuario.empresa_id, filtro, q, limit: pageSize, offset: (page - 1) * pageSize });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function atualizarProduto(id, dados, usuario) {
    const produto = await fiscalRepository.atualizarProduto(id, usuario.empresa_id, dados);

    if (!produto) throw new AppError('Produto não encontrado', 404);

    return produto;
}

async function aplicarEmLote({ produto_ids: ids, ...dados }, usuario) {
    return { atualizados: await fiscalRepository.atualizarLote(ids, usuario.empresa_id, dados) };
}

const preenchido = (valor) => typeof valor === 'string' ? valor.trim() !== '' : valor !== null && valor !== undefined;

function itemEmpresa(id, rotulo, ok, detalhe, obrigatorio = true) {
    return { id, rotulo, obrigatorio, ok, detalhe };
}

async function prontidao(usuario) {
    const linha = await fiscalRepository.buscarEmpresa(usuario.empresa_id);

    if (!linha) throw new AppError('Empresa não encontrada', 404);

    const cnpj = normalizarCnpj(linha.cnpj);
    const faltamEndereco = [['cep', 'CEP'], ['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'], ['cidade', 'cidade']]
        .filter(([campo]) => !preenchido(linha[campo]))
        .map(([, rotulo]) => rotulo);

    if (!UFS.includes(String(linha.uf ?? '').toUpperCase())) faltamEndereco.push('UF');

    const ibgeOk = preenchido(linha.codigo_municipio_ibge) && (!linha.uf || municipioCombinaComUf(linha.codigo_municipio_ibge, linha.uf));
    const regimeOk = REGIMES_TRIBUTARIOS.includes(linha.regime_tributario);

    const empresa = [
        itemEmpresa('cnpj', 'CNPJ', cnpjValido(cnpj), !cnpj ? 'Não informado (Configurações > Dados da empresa)' : cnpjValido(cnpj) ? '' : 'CNPJ inválido (confira os dígitos)'),
        itemEmpresa('razao_social', 'Razão social', preenchido(linha.razao_social), preenchido(linha.razao_social) ? '' : 'Não informada (Dados da empresa)'),
        itemEmpresa('endereco', 'Endereço completo', faltamEndereco.length === 0, faltamEndereco.length ? `Falta: ${faltamEndereco.join(', ')} (Dados da empresa)` : ''),
        itemEmpresa('regime_tributario', 'Regime tributário', regimeOk, regimeOk ? '' : 'Não definido (pergunte ao seu contador)'),
        itemEmpresa('inscricao_estadual', 'Inscrição estadual', preenchido(linha.inscricao_estadual), preenchido(linha.inscricao_estadual) ? '' : 'Não informada (use ISENTO se for o caso)'),
        itemEmpresa('codigo_municipio_ibge', 'Código IBGE do município', ibgeOk, ibgeOk ? '' : preenchido(linha.codigo_municipio_ibge) ? 'O código não pertence à UF da empresa' : 'Não informado'),
        itemEmpresa('cnae_principal', 'CNAE principal', preenchido(linha.cnae_principal), preenchido(linha.cnae_principal) ? '' : 'Recomendado', false),
        itemEmpresa('inscricao_municipal', 'Inscrição municipal', preenchido(linha.inscricao_municipal), preenchido(linha.inscricao_municipal) ? '' : 'Recomendado (necessária para nota de serviço)', false),
        itemEmpresa('ambiente', 'Ambiente', true, linha.ambiente === 'producao' ? 'Produção' : 'Homologação (testes)', false)
    ];

    const [contagem, pendentes] = await Promise.all([
        fiscalRepository.contagemProdutos(usuario.empresa_id),
        fiscalRepository.produtosPendentes(usuario.empresa_id, 10)
    ]);

    const itemProduto = (id, rotulo, preenchidos, obrigatorio) => ({
        id,
        rotulo,
        obrigatorio,
        ok: preenchidos === contagem.total,
        total: contagem.total,
        preenchidos,
        faltando: contagem.total - preenchidos
    });

    const produtos = [
        itemProduto('ncm', 'NCM dos produtos', contagem.com_ncm, true),
        itemProduto('origem_mercadoria', 'Origem da mercadoria', contagem.com_origem, true),
        itemProduto('unidade_fiscal', 'Unidade fiscal (padrão: a unidade do produto)', contagem.com_unidade_fiscal, false)
    ];

    const obrigatorios = [...empresa, ...produtos].filter((i) => i.obrigatorio);

    return {
        pronto: obrigatorios.every((i) => i.ok),
        resumo: { obrigatorios: obrigatorios.length, ok: obrigatorios.filter((i) => i.ok).length },
        grupos: [{ id: 'empresa', titulo: 'Dados da empresa', itens: empresa }, { id: 'produtos', titulo: 'Produtos', itens: produtos }],
        produtos_pendentes: pendentes.map((p) => ({ id: p.id, sku: p.sku, nome: p.nome, falta: [...(p.sem_ncm ? ['ncm'] : []), ...(p.sem_origem ? ['origem_mercadoria'] : [])] })),
        avisos: AVISOS
    };
}

module.exports = { obterEmpresa, salvarEmpresa, listarProdutos, atualizarProduto, aplicarEmLote, prontidao };

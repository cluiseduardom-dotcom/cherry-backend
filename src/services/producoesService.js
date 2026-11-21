const producoesRepository = require('../repositories/producoesRepository');
const AppError = require('../errors/AppError');
const { podeVerCustos } = require('./permissoesService');

async function criar(dados, usuarioId, empresaId) {
    return producoesRepository.criar({ ...dados, usuario_id: usuarioId, empresa_id: empresaId });
}

async function listar({ page, pageSize, produto_id, dataDe, dataAte }, empresaId) {
    const limit = pageSize;
    const offset = (page - 1) * pageSize;

    const { items, total } = await producoesRepository.listarPaginado({
        limit, offset, produto_id, dataDe, dataAte, empresa_id: empresaId
    });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, empresaId) {
    const producao = await producoesRepository.buscarPorId(id, empresaId);

    if (!producao) {
        throw new AppError('Produção não encontrada', 404);
    }

    return producao;
}

async function cancelar(id, usuarioId, empresaId) {
    return producoesRepository.cancelar(id, usuarioId, empresaId);
}

// Necessidade de material (somente leitura): o que `quantidade` unidades do produto consumiriam, o que falta e o
// máximo que dá para produzir com o estoque atual. Mesma conta da produção (`producoesRepository.criar`):
// a ficha informa o consumo POR UNIDADE e o máximo por insumo é floor(saldo / por_unidade).
// O custo (do insumo, hoje) só sai para quem pode ver custos; para os demais o campo é omitido.
async function necessidade({ produto_id: produtoId, quantidade }, usuario) {
    const { produto, ficha, insumos } = await producoesRepository.lerNecessidade(produtoId, usuario.empresa_id);

    if (!produto) throw new AppError('Produto não encontrado', 404);
    if (produto.tipo !== 'acabado') throw new AppError("Produto deve ser do tipo 'acabado' para ser produzido", 400);
    if (!ficha) throw new AppError('Produto não possui ficha técnica cadastrada', 400);

    const verCustos = podeVerCustos(usuario);

    const linhas = insumos.map((i) => {
        const porUnidade = Number(i.por_unidade);
        const disponivel = Number(i.estoque_atual);
        const necessario = porUnidade * quantidade;
        const maximo = Math.floor(disponivel / porUnidade);
        const ativo = Boolean(i.ativo);

        return {
            insumo_produto_id: i.insumo_produto_id,
            sku: i.sku,
            nome: i.nome,
            ativo,
            por_unidade: porUnidade,
            necessario,
            disponivel,
            faltante: Math.max(0, necessario - disponivel),
            suficiente: ativo && disponivel >= necessario,
            maximo_produzivel: maximo,
            custo: Number(i.custo)
        };
    });

    const maximoProduzivel = linhas.length ? Math.min(...linhas.map((l) => l.maximo_produzivel)) : 0;
    const gargalo = linhas.find((l) => l.maximo_produzivel === maximoProduzivel) ?? null;
    const custoUnitario = linhas.reduce((soma, l) => soma + l.por_unidade * l.custo, 0);
    const arred = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    return {
        produto: { id: produto.id, nome: produto.nome, sku: produto.sku },
        ficha_tecnica_id: ficha.id,
        quantidade_solicitada: quantidade,
        pode_produzir_tudo: linhas.length > 0 && linhas.every((l) => l.suficiente),
        // Máximo que o estoque atual permite (não é limitado pela quantidade pedida).
        maximo_produzivel: maximoProduzivel,
        gargalo: gargalo ? { insumo_produto_id: gargalo.insumo_produto_id, nome: gargalo.nome } : null,
        insumos: linhas.map(({ custo, ...resto }) => (verCustos
            ? { ...resto, custo_unitario: arred(custo), custo_necessario: arred(custo * resto.necessario) }
            : resto)),
        ...(verCustos ? { custo_estimado: { unitario: arred(custoUnitario), total: arred(custoUnitario * quantidade) } } : {})
    };
}

module.exports = { criar, listar, buscarPorId, cancelar, necessidade };

const AppError = require('../errors/AppError');
const repo = require('../repositories/ordensProducaoRepository');
const { podeVerCustos } = require('./permissoesService');

// Ordem de produção (PCP). Custo (do insumo e da ordem) só sai para quem pode ver custos; para os demais
// os campos são omitidos, nunca zerados.

const arred = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function apresentar(ordem, usuario) {
    const verCustos = podeVerCustos(usuario);
    const { insumos, custo_insumos: custoInsumos, ...resto } = ordem;
    const produzida = resto.quantidade_produzida;
    const perdida = Number(resto.quantidade_perdida);
    const concluida = resto.status === 'concluida';
    const totalFeito = concluida ? produzida + perdida : 0;

    const final = {
        ...resto,
        perda_pct: concluida && totalFeito > 0 ? arred((perdida / totalFeito) * 100) : null
    };

    if (insumos) {
        final.insumos = insumos.map((i) => {
            const porUnidade = Number(i.por_unidade);
            const base = {
                insumo_produto_id: i.insumo_produto_id,
                sku: i.sku,
                nome: i.nome,
                ativo: i.ativo,
                por_unidade: porUnidade,
                necessario_planejado: porUnidade * resto.quantidade_planejada,
                disponivel: Number(i.estoque_atual)
            };

            return verCustos ? { ...base, custo_unitario: Number(i.custo) } : base;
        });
    }

    if (verCustos) {
        final.custo_insumos = custoInsumos === null ? null : Number(custoInsumos);
        final.custo_unitario_real = concluida && produzida > 0 && custoInsumos !== null ? arred(Number(custoInsumos) / produzida) : null;
    }

    return final;
}

async function criar(dados, usuario) {
    const ordem = await repo.criar({ ...dados, usuario_id: usuario.id, empresa_id: usuario.empresa_id });

    return apresentar(ordem, usuario);
}

async function listar({ page, pageSize, status, produto_id: produtoId }, usuario) {
    const { items, total } = await repo.listarPaginado({
        status,
        produto_id: produtoId,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        empresa_id: usuario.empresa_id
    });

    return {
        items: items.map((o) => apresentar(o, usuario)),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function buscarPorId(id, usuario) {
    const ordem = await repo.buscarPorId(id, usuario.empresa_id);

    if (!ordem) throw new AppError('Ordem de produção não encontrada', 404);

    return apresentar(ordem, usuario);
}

async function iniciar(id, usuario) {
    return apresentar(await repo.iniciar(id, usuario.id, usuario.empresa_id), usuario);
}

async function concluir(id, dados, usuario) {
    return apresentar(await repo.concluir(id, dados, usuario.id, usuario.empresa_id), usuario);
}

async function cancelar(id, dados, usuario) {
    return apresentar(await repo.cancelar(id, dados, usuario.id, usuario.empresa_id), usuario);
}

module.exports = { criar, listar, buscarPorId, iniciar, concluir, cancelar };

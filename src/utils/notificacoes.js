// Regras PURAS (sem banco) das notificações de decisão do sino. Recebem uma linha por produto
// com os números já agregados e devolvem as mensagens. Os limites são constantes aqui para
// poderem virar configuração da empresa depois, sem mexer nas regras.
const { calcularGiro, calcularCobertura } = require('./agregacaoGiroCobertura');

const LIMITES = Object.freeze({
    COBERTURA_PERTO_DE_ACABAR_DIAS: 7,
    DIAS_PRODUTO_PARADO: 90,
    TOP_GIRO_QUANTIDADE: 3,
    GIRO_MINIMO_DESTAQUE: 1,
    JANELA_COBERTURA_DIAS: 30,
    JANELA_GIRO_DIAS: 90,
    MAXIMO_ITENS: 50
});

const TIPOS = Object.freeze({
    FALTA: 'falta',
    ABAIXO_MINIMO: 'abaixo_minimo',
    PERTO_DE_ACABAR: 'perto_de_acabar',
    PARADO: 'parado',
    ALTO_GIRO: 'alto_giro'
});

const PRIORIDADE = Object.freeze({ alta: 0, media: 1, baixa: 2 });

// Quais tipos cada perfil recebe. Giro e "parado" derivam de vendas: só quem já vê o
// dashboard (admin). Estoquista recebe reposição; os demais, só falta/abaixo do mínimo.
// Insumo só aparece em falta / abaixo do mínimo / perto de acabar.
function tiposPermitidos({ administrador, estoquista }) {
    if (administrador) return new Set(Object.values(TIPOS));
    if (estoquista) return new Set([TIPOS.FALTA, TIPOS.ABAIXO_MINIMO, TIPOS.PERTO_DE_ACABAR]);
    return new Set([TIPOS.FALTA, TIPOS.ABAIXO_MINIMO]);
}

function rotulo(p) {
    return p.sku ? `${p.nome} (SKU ${p.sku})` : p.nome;
}

function base(p, tipo, prioridade, titulo, mensagem, acao, dados) {
    return {
        id: `${tipo}:${p.id}`,
        tipo,
        prioridade,
        produto_id: p.id,
        sku: p.sku || null,
        nome: p.nome,
        item: p.tipo === 'insumo' ? 'insumo' : 'produto',
        titulo,
        mensagem,
        acao,
        dados
    };
}

function montarNotificacoes(produtos, perfil) {
    const permitidos = tiposPermitidos(perfil);
    const veInsumo = Boolean(perfil.administrador || perfil.estoquista);
    const itens = [];
    const candidatosGiro = [];

    for (const p of produtos) {
        const insumo = p.tipo === 'insumo';
        if (insumo && !veInsumo) continue;

        const estoque = Number(p.estoque_atual);
        const minimo = Number(p.estoque_minimo);
        const vendido30 = Number(p.vendido_30d) || 0;
        const vendido90 = Number(p.vendido_90d) || 0;
        let abaixoMinimo = false;

        if (estoque <= 0) {
            if ((minimo > 0 || vendido90 > 0) && permitidos.has(TIPOS.FALTA)) {
                itens.push(base(p, TIPOS.FALTA, 'alta',
                    'Item em falta',
                    `${rotulo(p)} está sem estoque.`,
                    insumo ? 'Comprar o insumo para repor o estoque Central.' : 'Repor o estoque ou comprar com o fornecedor.',
                    { estoque_atual: estoque, estoque_minimo: minimo }));
            }
            continue;
        }

        if (minimo > 0 && estoque <= minimo) {
            abaixoMinimo = true;
            if (permitidos.has(TIPOS.ABAIXO_MINIMO)) {
                itens.push(base(p, TIPOS.ABAIXO_MINIMO, 'alta',
                    'Abaixo do estoque mínimo',
                    `${rotulo(p)} tem ${estoque} em estoque (mínimo ${minimo}).`,
                    'Programar a compra ou a reposição.',
                    { estoque_atual: estoque, estoque_minimo: minimo }));
            }
        }

        if (!abaixoMinimo && permitidos.has(TIPOS.PERTO_DE_ACABAR)) {
            const cobertura = calcularCobertura(vendido30, estoque, LIMITES.JANELA_COBERTURA_DIAS);
            if (cobertura !== null && cobertura <= LIMITES.COBERTURA_PERTO_DE_ACABAR_DIAS) {
                itens.push(base(p, TIPOS.PERTO_DE_ACABAR, 'media',
                    'Perto de acabar',
                    `${rotulo(p)} deve acabar em cerca de ${cobertura} dia(s) no ritmo atual (${estoque} em estoque).`,
                    'Antecipar a reposição.',
                    { estoque_atual: estoque, cobertura_dias: cobertura }));
            }
        }

        if (insumo) continue;

        const semVenda = p.dias_sem_venda === null || p.dias_sem_venda === undefined ? null : Number(p.dias_sem_venda);
        const diasCadastro = Number(p.dias_cadastro) || 0;
        const parado = vendido90 === 0
            && (semVenda === null || semVenda >= LIMITES.DIAS_PRODUTO_PARADO)
            && diasCadastro >= LIMITES.DIAS_PRODUTO_PARADO;

        if (parado && permitidos.has(TIPOS.PARADO)) {
            itens.push(base(p, TIPOS.PARADO, 'baixa',
                'Item parado no estoque',
                semVenda === null
                    ? `${rotulo(p)} tem ${estoque} em estoque e nunca foi vendido.`
                    : `${rotulo(p)} tem ${estoque} em estoque e está há ${semVenda} dias sem vender.`,
                'Avaliar promoção, kit ou redução de compras.',
                { estoque_atual: estoque, dias_sem_venda: semVenda }));
        }

        const giro = calcularGiro(vendido90, estoque);
        if (giro !== null && giro >= LIMITES.GIRO_MINIMO_DESTAQUE) {
            candidatosGiro.push({ p, estoque, giro, vendido90 });
        }
    }

    if (permitidos.has(TIPOS.ALTO_GIRO)) {
        candidatosGiro
            .sort((a, b) => b.giro - a.giro || a.p.id - b.p.id)
            .slice(0, LIMITES.TOP_GIRO_QUANTIDADE)
            .forEach(({ p, estoque, giro, vendido90 }) => {
                itens.push(base(p, TIPOS.ALTO_GIRO, 'baixa',
                    'Alto giro',
                    `${rotulo(p)} vendeu ${vendido90} un. em ${LIMITES.JANELA_GIRO_DIAS} dias (giro ${giro}).`,
                    'Garantir estoque e considerar comprar mais.',
                    { estoque_atual: estoque, giro, vendido_periodo: vendido90 }));
            });
    }

    itens.sort((a, b) => PRIORIDADE[a.prioridade] - PRIORIDADE[b.prioridade] || a.produto_id - b.produto_id);

    return itens.slice(0, LIMITES.MAXIMO_ITENS);
}

module.exports = { montarNotificacoes, tiposPermitidos, LIMITES, TIPOS };

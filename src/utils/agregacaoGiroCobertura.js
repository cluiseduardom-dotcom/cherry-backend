// Giro e cobertura de um GRUPO de produtos (total da empresa, ou uma
// categoria dentro de um nível) nunca são a média dos giros/coberturas
// individuais dos produtos — média de razões distorce o resultado. Sempre:
//   giro_do_grupo      = SOMA(vendido no período) / SOMA(estoque atual)
//   cobertura_do_grupo = SOMA(estoque atual) / (SOMA(vendido) / dias)
// Por isso a agregação vive aqui, em JS puro, reusando a mesma fórmula
// (calcularGiro/calcularCobertura) tanto pra um produto isolado quanto pra
// qualquer grupo — garante que a regra nunca diverge entre os dois casos.
// Mesmo padrão de módulo puro e testável isoladamente de src/utils/rateioCustoFixo.js.

function arredondar(valor, casas) {
    const fator = 10 ** casas;
    return Math.round((valor + Number.EPSILON) * fator) / fator;
}

// NULL quando estoque atual = 0 (não dá pra "girar" um estoque que não existe).
function calcularGiro(quantidadeVendida, estoqueAtual) {
    if (estoqueAtual === 0) return null;
    return arredondar(quantidadeVendida / estoqueAtual, 2);
}

// NULL quando nada foi vendido no período (não dá pra estimar "quantos dias
// dura" um ritmo de venda zero).
function calcularCobertura(quantidadeVendida, estoqueAtual, dias) {
    if (quantidadeVendida === 0) return null;
    return arredondar(estoqueAtual / (quantidadeVendida / dias), 1);
}

function agregarGrupo(produtos, dias) {
    const estoqueAtual = produtos.reduce((soma, p) => soma + p.estoque_atual, 0);
    const quantidadeVendidaPeriodo = produtos.reduce((soma, p) => soma + p.quantidade_vendida_periodo, 0);

    return {
        estoque_atual: estoqueAtual,
        quantidade_vendida_periodo: quantidadeVendidaPeriodo,
        giro: calcularGiro(quantidadeVendidaPeriodo, estoqueAtual),
        cobertura: calcularCobertura(quantidadeVendidaPeriodo, estoqueAtual, dias)
    };
}

const NOME_SEM_CATEGORIA = 'Sem categoria';

// vinculos: [{ produto_id, nivel, categoria_id, categoria_nome }] — pode ter
// várias linhas por produto (uma por nível em que ele está categorizado).
// niveisExistentes: números de nível com pelo menos uma categoria ativa
// cadastrada na empresa (não depende de já ter produto vinculado).
// rotulosPorNivel: Map(nivel -> nome) vindo de niveis_categoria; nível sem
// rótulo cadastrado não é erro, só fica null pro frontend rotular.
function agregarPorNivel(produtos, vinculos, niveisExistentes, rotulosPorNivel, dias) {
    return niveisExistentes.map((nivel) => {
        // Filtra os vínculos DESTE nível antes de montar o mapa produto->categoria:
        // isso é o que garante que um produto com categoria em 2+ níveis apareça
        // em cada quebra de nível separadamente, sem que as linhas de um nível
        // vazem pra soma de outro (evita o JOIN-multiplicando-linhas do enunciado).
        const categoriaDoProdutoNesteNivel = new Map();
        for (const vinculo of vinculos) {
            if (vinculo.nivel === nivel) categoriaDoProdutoNesteNivel.set(vinculo.produto_id, vinculo);
        }

        const grupos = new Map(); // chave: categoria_id ou null (sem categoria)
        for (const produto of produtos) {
            const vinculo = categoriaDoProdutoNesteNivel.get(produto.id);
            const chave = vinculo ? vinculo.categoria_id : null;
            const nome = vinculo ? vinculo.categoria_nome : NOME_SEM_CATEGORIA;

            if (!grupos.has(chave)) grupos.set(chave, { nome, produtos: [] });
            grupos.get(chave).produtos.push(produto);
        }

        const categorias = Array.from(grupos.entries()).map(([categoria_id, grupo]) => ({
            categoria_id,
            nome: grupo.nome,
            ...agregarGrupo(grupo.produtos, dias)
        }));

        return {
            nivel,
            rotulo: rotulosPorNivel.get(nivel) ?? null,
            categorias
        };
    });
}

// Rankings por produto individual. Produtos com giro NULL (estoque_atual = 0)
// não entram em NENHUM dos dois rankings: giro null não é ordenável, e no
// caso específico de menor_giro isso também é regra de negócio — sem estoque
// não há capital parado, que é o que essa visão quer mostrar.
function montarRankings(produtos, dias, limite = 10) {
    const comGiro = produtos
        .map((produto) => ({
            id: produto.id,
            nome: produto.nome,
            sku: produto.sku,
            giro: calcularGiro(produto.quantidade_vendida_periodo, produto.estoque_atual),
            cobertura: calcularCobertura(produto.quantidade_vendida_periodo, produto.estoque_atual, dias),
            quantidade_vendida_periodo: produto.quantidade_vendida_periodo,
            estoque_atual: produto.estoque_atual,
            // Relativo à venda do período, não um limiar fixo de unidades.
            giro_alto_por_falta_de_estoque: produto.estoque_atual < produto.quantidade_vendida_periodo
        }))
        .filter((produto) => produto.giro !== null);

    const porIdAsc = (a, b) => a.id - b.id;

    const topGiro = [...comGiro].sort((a, b) => b.giro - a.giro || porIdAsc(a, b)).slice(0, limite);
    const menorGiro = [...comGiro].sort((a, b) => a.giro - b.giro || porIdAsc(a, b)).slice(0, limite);

    return { topGiro, menorGiro };
}

// Rupturas: produtos que venderam no período mas estão com estoque zerado —
// o caso mais grave de venda perdida. Ficam de fora de top_giro/menor_giro
// porque giro não é calculável com estoque zero (divisão por zero) — é
// exatamente por isso que essa visão existe separada: aqui não se calcula
// giro/cobertura nenhum, só se lista quem precisa de reposição urgente.
//
// SEM limite de itens (diferente de montarRankings, que corta em `limite`):
// ruptura é uma lista de ação, não um ranking dos "N piores" — se houver 30
// produtos zerados, o gestor precisa ver os 30. Não "corrigir" isso pra bater
// com o padrão dos outros rankings — a ausência de corte é intencional.
function montarRupturas(produtos) {
    return produtos
        .filter((produto) => produto.estoque_atual === 0 && produto.quantidade_vendida_periodo > 0)
        .map((produto) => ({
            id: produto.id,
            nome: produto.nome,
            sku: produto.sku,
            quantidade_vendida_periodo: produto.quantidade_vendida_periodo,
            estoque_atual: produto.estoque_atual
        }))
        .sort((a, b) => b.quantidade_vendida_periodo - a.quantidade_vendida_periodo || a.id - b.id);
}

module.exports = {
    calcularGiro,
    calcularCobertura,
    agregarGrupo,
    agregarPorNivel,
    montarRankings,
    montarRupturas
};

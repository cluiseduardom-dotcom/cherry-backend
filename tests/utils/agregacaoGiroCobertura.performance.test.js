// Teste de carga da agregação de giro/cobertura — separado de propósito dos
// testes de corretude em agregacaoGiroCobertura.test.js (não misturar: um
// prova que o resultado está certo, este prova que o resultado chega a
// tempo em volume). Não corrige nada hoje: é um sensor pra avisar no dia em
// que a suposição "catálogo cabe inteiro em memória sem custo perceptível"
// deixar de valer (ver nota no CLAUDE.md, seção do relatório agregado, sobre
// o teto de ~50 mil produtos ativos).
const {
  agregarGrupo,
  agregarPorNivel,
  montarRankings,
  montarRupturas
} = require('../../src/utils/agregacaoGiroCobertura');

const TOTAL_PRODUTOS = 50000;
const NIVEIS_EXISTENTES = [1, 2, 3];
const CATEGORIAS_POR_NIVEL = 20;
const DIAS = 90;

// Limite generoso de propósito: o objetivo é pegar uma regressão de ordem de
// grandeza (ex.: um O(n²) escondido em algum filter/find dentro de loop), não
// microsegundos. Runners de CI (GitHub Actions) são tipicamente mais lentos e
// mais ruidosos que uma máquina de dev — 2s dá folga suficiente pra não
// gerar falso positivo por ruído do runner, mas ainda é rápido o bastante
// pra um request HTTP se essa suposição continuar válida.
const LIMITE_MS = 2000;

function gerarFixture() {
    const produtos = [];
    const vinculos = [];

    for (let i = 1; i <= TOTAL_PRODUTOS; i++) {
        produtos.push({
            id: i,
            nome: `Produto ${i}`,
            sku: `SKU${i}`,
            estoque_atual: i % 50, // parte dos produtos com estoque zerado (ruptura)
            quantidade_vendida_periodo: i % 30
        });

        for (const nivel of NIVEIS_EXISTENTES) {
            vinculos.push({
                produto_id: i,
                nivel,
                categoria_id: nivel * 1000 + (i % CATEGORIAS_POR_NIVEL),
                categoria_nome: `Categoria ${nivel}-${i % CATEGORIAS_POR_NIVEL}`
            });
        }
    }

    return { produtos, vinculos };
}

test(`agrega ${TOTAL_PRODUTOS} produtos + ${TOTAL_PRODUTOS * NIVEIS_EXISTENTES.length} vínculos de categoria em menos de ${LIMITE_MS}ms`, () => {
    const { produtos, vinculos } = gerarFixture();
    const rotulosPorNivel = new Map(NIVEIS_EXISTENTES.map((n) => [n, `Nível ${n}`]));

    const inicio = Date.now();

    const total = agregarGrupo(produtos, DIAS);
    const porNivel = agregarPorNivel(produtos, vinculos, NIVEIS_EXISTENTES, rotulosPorNivel, DIAS);
    const { topGiro, menorGiro } = montarRankings(produtos, DIAS);
    const rupturas = montarRupturas(produtos);

    const duracaoMs = Date.now() - inicio;

    // Sanidade mínima — a corretude fina já é responsabilidade dos testes em
    // agregacaoGiroCobertura.test.js, aqui só confirma que rodou de verdade.
    expect(total.estoque_atual).toBeGreaterThan(0);
    expect(porNivel).toHaveLength(NIVEIS_EXISTENTES.length);
    expect(topGiro.length).toBeGreaterThan(0);
    expect(menorGiro.length).toBeGreaterThan(0);
    expect(rupturas.length).toBeGreaterThan(0);

    expect(duracaoMs).toBeLessThan(LIMITE_MS);
});

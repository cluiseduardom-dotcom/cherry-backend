const {
  calcularGiro,
  calcularCobertura,
  agregarGrupo,
  agregarPorNivel,
  montarRankings
} = require('../../src/utils/agregacaoGiroCobertura');

describe('calcularGiro', () => {
  test('divide vendido pelo estoque e arredonda em 2 casas', () => {
    expect(calcularGiro(5, 10)).toBe(0.5);
    expect(calcularGiro(1, 3)).toBe(0.33);
  });

  test('retorna null quando estoque atual é zero', () => {
    expect(calcularGiro(5, 0)).toBeNull();
  });

  test('retorna zero (não null) quando vendido é zero mas há estoque', () => {
    expect(calcularGiro(0, 10)).toBe(0);
  });
});

describe('calcularCobertura', () => {
  test('estoque dividido pela média diária vendida, arredondado em 1 casa', () => {
    // média diária = 30/90 = 0.333..., estoque 100 / 0.333... = 300
    expect(calcularCobertura(30, 100, 90)).toBe(300);
  });

  test('retorna null quando nada foi vendido no período', () => {
    expect(calcularCobertura(0, 100, 90)).toBeNull();
  });
});

describe('agregarGrupo', () => {
  test('agrega por SOMA/SOMA, não pela média dos giros individuais', () => {
    const produtos = [
      { id: 1, estoque_atual: 10, quantidade_vendida_periodo: 5 }, // giro individual 0.5
      { id: 2, estoque_atual: 100, quantidade_vendida_periodo: 5 } // giro individual 0.05
    ];

    const resultado = agregarGrupo(produtos, 90);

    // média ingênua dos giros individuais seria (0.5 + 0.05) / 2 = 0.275
    const mediaIngenua = 0.275;
    expect(resultado.giro).not.toBe(mediaIngenua);
    // soma/soma correto: 10 vendido / 110 estoque
    expect(resultado.estoque_atual).toBe(110);
    expect(resultado.quantidade_vendida_periodo).toBe(10);
    expect(resultado.giro).toBeCloseTo(10 / 110, 2);
  });

  test('giro null quando soma do estoque do grupo é zero', () => {
    const produtos = [
      { id: 1, estoque_atual: 0, quantidade_vendida_periodo: 5 },
      { id: 2, estoque_atual: 0, quantidade_vendida_periodo: 3 }
    ];

    const resultado = agregarGrupo(produtos, 90);

    expect(resultado.giro).toBeNull();
  });

  test('cobertura null quando soma do vendido do grupo é zero', () => {
    const produtos = [
      { id: 1, estoque_atual: 10, quantidade_vendida_periodo: 0 },
      { id: 2, estoque_atual: 20, quantidade_vendida_periodo: 0 }
    ];

    const resultado = agregarGrupo(produtos, 90);

    expect(resultado.cobertura).toBeNull();
  });

  test('grupo vazio soma zero e devolve giro/cobertura null', () => {
    const resultado = agregarGrupo([], 90);

    expect(resultado).toEqual({
      estoque_atual: 0,
      quantidade_vendida_periodo: 0,
      giro: null,
      cobertura: null
    });
  });
});

describe('agregarPorNivel', () => {
  const produtos = [
    { id: 1, nome: 'Colar Prata', sku: 'A', estoque_atual: 10, quantidade_vendida_periodo: 5 },
    { id: 2, nome: 'Pingente Ouro', sku: 'B', estoque_atual: 20, quantidade_vendida_periodo: 10 },
    { id: 3, nome: 'Sem categoria nenhuma', sku: null, estoque_atual: 5, quantidade_vendida_periodo: 1 }
  ];

  // produto 1: família=Colares (nivel 1), material=Prata (nivel 2)
  // produto 2: família=Pingentes (nivel 1), material=Ouro (nivel 2)
  // produto 3: sem nenhum vínculo
  const vinculos = [
    { produto_id: 1, nivel: 1, categoria_id: 10, categoria_nome: 'Colares' },
    { produto_id: 1, nivel: 2, categoria_id: 20, categoria_nome: 'Prata' },
    { produto_id: 2, nivel: 1, categoria_id: 11, categoria_nome: 'Pingentes' },
    { produto_id: 2, nivel: 2, categoria_id: 21, categoria_nome: 'Ouro' }
  ];

  test('produto com categoria em múltiplos níveis aparece em cada quebra sem inflar somas', () => {
    const resultado = agregarPorNivel(produtos, vinculos, [1, 2], new Map(), 90);

    expect(resultado).toHaveLength(2);

    for (const grupoNivel of resultado) {
      const somaQuantidade = grupoNivel.categorias.reduce((soma, c) => soma + c.quantidade_vendida_periodo, 0);
      const somaEstoque = grupoNivel.categorias.reduce((soma, c) => soma + c.estoque_atual, 0);
      // soma de TODAS as categorias (incluindo "sem categoria") do nível
      // precisa bater com a soma de todos os produtos — nunca mais, nunca menos.
      expect(somaQuantidade).toBe(16); // 5 + 10 + 1
      expect(somaEstoque).toBe(35); // 10 + 20 + 5
    }
  });

  test('produto sem categoria vai pro bucket explícito "Sem categoria" em todo nível existente', () => {
    const resultado = agregarPorNivel(produtos, vinculos, [1, 2], new Map(), 90);

    for (const grupoNivel of resultado) {
      const semCategoria = grupoNivel.categorias.find((c) => c.categoria_id === null);
      expect(semCategoria).toBeDefined();
      expect(semCategoria.nome).toBe('Sem categoria');
      expect(semCategoria.quantidade_vendida_periodo).toBe(1);
      expect(semCategoria.estoque_atual).toBe(5);
    }
  });

  test('usa o rótulo de niveis_categoria quando existe, null quando não existe', () => {
    const rotulos = new Map([[1, 'família']]);
    const resultado = agregarPorNivel(produtos, vinculos, [1, 2], rotulos, 90);

    expect(resultado.find((n) => n.nivel === 1).rotulo).toBe('família');
    expect(resultado.find((n) => n.nivel === 2).rotulo).toBeNull();
  });

  test('lista de níveis existentes vazia devolve array vazio', () => {
    expect(agregarPorNivel(produtos, vinculos, [], new Map(), 90)).toEqual([]);
  });
});

describe('montarRankings', () => {
  test('exclui produtos com giro null (estoque zerado) de AMBOS os rankings', () => {
    const produtos = [
      { id: 1, nome: 'A', sku: 'A1', estoque_atual: 0, quantidade_vendida_periodo: 50 }, // giro null
      { id: 2, nome: 'B', sku: 'B1', estoque_atual: 10, quantidade_vendida_periodo: 5 }
    ];

    const { topGiro, menorGiro } = montarRankings(produtos, 90);

    expect(topGiro.find((p) => p.id === 1)).toBeUndefined();
    expect(menorGiro.find((p) => p.id === 1)).toBeUndefined();
    expect(topGiro).toHaveLength(1);
    expect(menorGiro).toHaveLength(1);
  });

  test('flag giro_alto_por_falta_de_estoque é relativa à venda, não um limiar fixo', () => {
    const produtos = [
      { id: 1, nome: 'A', sku: 'A1', estoque_atual: 3, quantidade_vendida_periodo: 5 }, // 3 < 5 => true
      { id: 2, nome: 'B', sku: 'B1', estoque_atual: 100, quantidade_vendida_periodo: 5 } // 100 >= 5 => false
    ];

    const { topGiro } = montarRankings(produtos, 90);

    expect(topGiro.find((p) => p.id === 1).giro_alto_por_falta_de_estoque).toBe(true);
    expect(topGiro.find((p) => p.id === 2).giro_alto_por_falta_de_estoque).toBe(false);
  });

  test('topGiro ordena decrescente, menorGiro ordena crescente, limitado a `limite`', () => {
    const produtos = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      nome: `Produto ${i + 1}`,
      sku: `SKU${i + 1}`,
      estoque_atual: 10,
      quantidade_vendida_periodo: i + 1 // giro cresce com o id: 0.1, 0.2, ..., 1.5
    }));

    const { topGiro, menorGiro } = montarRankings(produtos, 90, 10);

    expect(topGiro).toHaveLength(10);
    expect(menorGiro).toHaveLength(10);
    expect(topGiro[0].id).toBe(15);
    expect(topGiro[9].id).toBe(6);
    expect(menorGiro[0].id).toBe(1);
    expect(menorGiro[9].id).toBe(10);
  });

  test('produto com giro e cobertura empatados usa id como desempate estável', () => {
    const produtos = [
      { id: 2, nome: 'B', sku: 'B1', estoque_atual: 10, quantidade_vendida_periodo: 5 },
      { id: 1, nome: 'A', sku: 'A1', estoque_atual: 10, quantidade_vendida_periodo: 5 }
    ];

    const { topGiro } = montarRankings(produtos, 90);

    expect(topGiro.map((p) => p.id)).toEqual([1, 2]);
  });
});

jest.mock('../../src/config/db');

const estoqueRepository = require('../../src/repositories/estoqueRepository');

const ESCRITA = /^\s*(INSERT INTO (estoque_locais|movimentacoes_estoque)|UPDATE produtos)/;

// Cliente falso que responde por trecho do SQL e guarda as chamadas.
function fakeClient({ locaisValidos = [10], comHistorico = [], produtosExistentes } = {}) {
  const client = { query: jest.fn() };
  client.query.mockImplementation((sql, params) => {
    if (sql.includes('INSERT INTO locais_estoque')) return Promise.resolve({});
    if (sql.includes("tipo = 'central'")) return Promise.resolve({ rows: [{ id: 10 }] });
    if (sql.includes('FROM locais_estoque WHERE id = ANY')) return Promise.resolve({ rows: locaisValidos.map((id) => ({ id })) });
    if (sql.includes('SELECT p.id FROM produtos p')) return Promise.resolve({ rows: comHistorico.map((id) => ({ id })) });
    if (sql.includes('SELECT COUNT(*)::int AS n FROM produtos')) return Promise.resolve({ rows: [{ n: produtosExistentes ?? params[0].length }] });
    return Promise.resolve({ rows: [] });
  });
  return client;
}

const escritas = (client) => client.query.mock.calls.filter(([sql]) => ESCRITA.test(sql));

describe('criarEntradasIniciaisEmLote', () => {
  test('sem itens não faz nada', async () => {
    const client = fakeClient();
    expect(await estoqueRepository.criarEntradasIniciaisEmLote({ itens: [], usuario_id: 1, empresa_id: 9 }, client)).toEqual({ movimentacoes: 0, unidades: 0 });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('grava saldo do local, total do produto e movimentação, em 3 instruções, com a empresa do chamador', async () => {
    const client = fakeClient({ locaisValidos: [10, 30] });
    const itens = [{ produto_id: 1, quantidade: 5, local_id: 10 }, { produto_id: 2, quantidade: 3, local_id: 30 }];

    const r = await estoqueRepository.criarEntradasIniciaisEmLote({ itens, usuario_id: 4, empresa_id: 9 }, client);

    expect(r).toEqual({ movimentacoes: 2, unidades: 8 });

    const [locais, produtos, movs] = escritas(client);
    expect(escritas(client)).toHaveLength(3);
    expect(locais[1]).toEqual([9, [1, 2], [10, 30], [5, 3]]);
    expect(produtos[1]).toEqual([[1, 2], [5, 3], 9]);
    expect(movs[1]).toEqual([4, 9, [1, 2], [5, 3], [10, 30]]);
    expect(movs[0]).toContain("'entrada'");
    expect(movs[0]).toContain("'estoque_inicial'");
  });

  test('item sem local vai para o Central da empresa', async () => {
    const client = fakeClient({ locaisValidos: [10] });
    await estoqueRepository.criarEntradasIniciaisEmLote({ itens: [{ produto_id: 1, quantidade: 2 }], usuario_id: 4, empresa_id: 9 }, client);

    const [insercaoLocal] = escritas(client);
    expect(insercaoLocal[1][2]).toEqual([10]);
  });

  test('local de outra empresa, inativo ou reserva: recusa tudo sem gravar', async () => {
    const client = fakeClient({ locaisValidos: [] });
    const r = await estoqueRepository.criarEntradasIniciaisEmLote({ itens: [{ produto_id: 1, quantidade: 2, local_id: 55 }], usuario_id: 4, empresa_id: 9 }, client);

    expect(r).toEqual({ erro: 'LOCAL_NAO_ENCONTRADO', local_id: 55 });
    expect(escritas(client)).toHaveLength(0);
    const consulta = client.query.mock.calls.find(([sql]) => sql.includes('FROM locais_estoque WHERE id = ANY'));
    expect(consulta[0]).toMatch(/empresa_id = \$2 AND ativo = true AND tipo <> 'reserva'/);
    expect(consulta[1]).toEqual([[55], 9]);
  });

  test('produto que já tem saldo ou movimentação: recusa tudo sem gravar (só vale para produto novo)', async () => {
    const client = fakeClient({ comHistorico: [2] });
    const r = await estoqueRepository.criarEntradasIniciaisEmLote(
      { itens: [{ produto_id: 1, quantidade: 1, local_id: 10 }, { produto_id: 2, quantidade: 1, local_id: 10 }], usuario_id: 4, empresa_id: 9 },
      client
    );

    expect(r).toEqual({ erro: 'ENTRADA_INICIAL_COM_HISTORICO', produto_id: 2 });
    expect(escritas(client)).toHaveLength(0);
  });

  test('produto de outra empresa: PRODUTO_NAO_ENCONTRADO, sem gravar', async () => {
    const client = fakeClient({ produtosExistentes: 1 });
    const r = await estoqueRepository.criarEntradasIniciaisEmLote(
      { itens: [{ produto_id: 1, quantidade: 1, local_id: 10 }, { produto_id: 2, quantidade: 1, local_id: 10 }], usuario_id: 4, empresa_id: 9 },
      client
    );

    expect(r).toEqual({ erro: 'PRODUTO_NAO_ENCONTRADO' });
    expect(escritas(client)).toHaveLength(0);
  });

  test('divide em blocos de 500 (2 blocos para 501 itens)', async () => {
    const client = fakeClient();
    const itens = Array.from({ length: 501 }, (_, i) => ({ produto_id: i + 1, quantidade: 1, local_id: 10 }));

    const r = await estoqueRepository.criarEntradasIniciaisEmLote({ itens, usuario_id: 4, empresa_id: 9 }, client);

    expect(r).toEqual({ movimentacoes: 501, unidades: 501 });
    expect(escritas(client)).toHaveLength(6);
  });
});

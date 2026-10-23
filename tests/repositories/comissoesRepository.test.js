jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const comissoesRepository = require('../../src/repositories/comissoesRepository');

function fakeClient(respostas = []) {
  const client = { query: jest.fn() };
  respostas.forEach((resposta) => client.query.mockResolvedValueOnce(resposta));
  client.query.mockResolvedValue({ rows: [], rowCount: 0 });
  return client;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('apurar', () => {
  test('exige o client da transação da venda', async () => {
    await expect(
      comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: 2, base: 100 })
    ).rejects.toThrow('exige o client da transação');
  });

  test('sem vendedor não consulta nem grava', async () => {
    const client = fakeClient();

    const resultado = await comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: null, base: 100 }, client);

    expect(resultado).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('sem percentual configurado não grava comissão', async () => {
    const client = fakeClient([{ rows: [] }]);

    const resultado = await comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: 2, base: 100 }, client);

    expect(resultado).toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('percentual 0 (vendedor desligado) não grava comissão', async () => {
    const client = fakeClient([{ rows: [{ percentual: '0.0000' }] }]);

    const resultado = await comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: 2, base: 100 }, client);

    expect(resultado).toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('congela percentual, base e valor, sempre no tenant e no vendedor da venda', async () => {
    const client = fakeClient([{ rows: [{ percentual: '5.0000' }] }, { rows: [{ id: 33 }] }]);

    const resultado = await comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: 2, base: 200 }, client);

    expect(resultado).toEqual({ id: 33 });

    const [sqlBusca, paramsBusca] = client.query.mock.calls[0];
    expect(sqlBusca).toContain('empresa_id = $1');
    expect(paramsBusca).toEqual([9, 2]);

    const [sqlInsert, paramsInsert] = client.query.mock.calls[1];
    expect(sqlInsert).toContain('INSERT INTO comissoes_venda');
    expect(sqlInsert).toContain('ON CONFLICT (venda_id) DO NOTHING');
    expect(paramsInsert).toEqual([1, 9, 2, 5, '200.00', '10.00']);
  });

  test('a busca do percentual dá prioridade ao percentual do vendedor sobre o padrão', async () => {
    const client = fakeClient([{ rows: [] }]);

    await comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: 2, base: 100 }, client);

    expect(client.query.mock.calls[0][0]).toMatch(/ORDER BY \(usuario_id IS NULL\) ASC/);
  });
});

describe('estornarPorVendaId', () => {
  test('marca como estornada (nunca apaga), só apuradas e só do tenant', async () => {
    const client = fakeClient([{ rowCount: 1 }]);

    const afetadas = await comissoesRepository.estornarPorVendaId(5, 9, client);

    expect(afetadas).toBe(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("SET status = 'estornada'");
    expect(sql).toContain("status = 'apurada'");
    expect(sql).toContain('empresa_id = $2');
    expect(sql).not.toMatch(/DELETE/i);
    expect(params).toEqual([5, 9]);
  });

  test('venda sem comissão é no-op (0 linhas)', async () => {
    const client = fakeClient([{ rowCount: 0 }]);

    await expect(comissoesRepository.estornarPorVendaId(5, 9, client)).resolves.toBe(0);
  });
});

describe('listarDoUsuario', () => {
  test('filtra por tenant E por vendedor, e aplica o período', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ quantidade: '1', total_base: '100.00', total_comissao: '5.00', total_estornado: '0' }] });

    const resultado = await comissoesRepository.listarDoUsuario({
      limit: 20, offset: 0, empresa_id: 9, usuario_id: 2, data_inicio: '2026-10-01', data_fim: '2026-10-31'
    });

    expect(resultado.total).toBe(1);
    expect(resultado.totais).toEqual({ total_base: '100.00', total_comissao: '5.00', total_estornado: '0' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('c.empresa_id = $1');
    expect(sql).toContain('c.usuario_id = $2');
    expect(params.slice(0, 4)).toEqual([9, 2, '2026-10-01', '2026-10-31']);
  });
});

describe('resumoEquipe', () => {
  test('soma os totais por vendedor e filtra pelo tenant', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { usuario_id: 2, nome: 'Ana', cargo: 'vendedor', percentual: '5.0000', quantidade_vendas: '3', total_base: '300.00', total_comissao: '15.00', total_estornado: '0' },
        { usuario_id: 3, nome: 'Bia', cargo: 'vendedor', percentual: null, quantidade_vendas: '0', total_base: '0', total_comissao: '0', total_estornado: '2.50' }
      ]
    });

    const resultado = await comissoesRepository.resumoEquipe({ empresa_id: 9 });

    expect(resultado.items).toHaveLength(2);
    expect(resultado.totais).toEqual({ total_base: '300.00', total_comissao: '15.00', total_estornado: '2.50' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('u.empresa_id = $1');
    expect(params[0]).toBe(9);
    expect(params[params.length - 1]).toEqual(['estoquista', 'faturista']);
  });
});

describe('definirPercentual', () => {
  test('usuário de outro tenant (ou inexistente) responde 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      comissoesRepository.definirPercentual({ empresa_id: 9, usuario_id: 77, percentual: 5, atualizado_por: 1 })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(db.query.mock.calls[0][0]).toContain('empresa_id = $2');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('cargo que não vende (estoquista) é recusado', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 4, papel: 'estoquista' }] });

    await expect(
      comissoesRepository.definirPercentual({ empresa_id: 9, usuario_id: 4, percentual: 5, atualizado_por: 1 })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('grava o percentual do vendedor com upsert e auditoria de quem alterou', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 2, papel: 'vendedor' }] })
      .mockResolvedValueOnce({ rows: [{ percentual: '5.0000' }] });

    const resultado = await comissoesRepository.definirPercentual({ empresa_id: 9, usuario_id: 2, percentual: 5, atualizado_por: 1 });

    expect(resultado).toEqual({ usuario_id: 2, percentual: '5.0000' });
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toContain('ON CONFLICT (empresa_id, usuario_id) WHERE usuario_id IS NOT NULL');
    expect(params).toEqual([9, 5, 1, 2]);
  });

  test('sem usuario_id grava o padrão da empresa, sem consultar usuários', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ percentual: '3.0000' }] });

    const resultado = await comissoesRepository.definirPercentual({ empresa_id: 9, usuario_id: null, percentual: 3, atualizado_por: 1 });

    expect(resultado).toEqual({ usuario_id: null, percentual: '3.0000' });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('ON CONFLICT (empresa_id) WHERE usuario_id IS NULL');
  });

  test('percentual null remove a regra do vendedor (volta a herdar o padrão)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 2, papel: 'vendedor' }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const resultado = await comissoesRepository.definirPercentual({ empresa_id: 9, usuario_id: 2, percentual: null, atualizado_por: 1 });

    expect(resultado).toEqual({ usuario_id: 2, percentual: null });
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toContain('DELETE FROM comissao_percentuais');
    expect(sql).toContain('empresa_id = $1');
    expect(params).toEqual([9, 2]);
  });
});

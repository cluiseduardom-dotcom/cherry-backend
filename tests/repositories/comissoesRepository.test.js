jest.mock('../../src/config/db');
jest.mock('../../src/repositories/shared/transacoes');

const { executarComLock } = require('../../src/repositories/shared/transacoes');
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

    // Nasce pendente (DEFAULT) e o histórico registra a apuração, sem executor.
    const [sqlEvento, paramsEvento] = client.query.mock.calls[2];
    expect(sqlEvento).toContain('INSERT INTO comissoes_eventos');
    expect(paramsEvento).toEqual([9, 33, 1, 'apurada', 'venda', 0, 0, null, null]);
  });

  test('a busca do percentual dá prioridade ao percentual do vendedor sobre o padrão', async () => {
    const client = fakeClient([{ rows: [] }]);

    await comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: 2, base: 100 }, client);

    expect(client.query.mock.calls[0][0]).toMatch(/ORDER BY \(cp\.usuario_id IS NULL\) ASC/);
  });

  test('o padrão da empresa não vale para cargo admin (a dona não ganha comissão sobre si)', async () => {
    const client = fakeClient([{ rows: [] }]);

    await comissoesRepository.apurar({ venda_id: 1, empresa_id: 9, usuario_id: 2, base: 100 }, client);

    expect(client.query.mock.calls[0][0]).toContain("cp.usuario_id IS NULL AND u.papel <> 'admin'");
  });
});

describe('estornarPorVendaId', () => {
  test('cancela repasses pendentes e marca a comissão como estornada (nunca apaga), só do tenant', async () => {
    const client = fakeClient([{ rowCount: 1 }, { rows: [{ id: 7, valor_liberado: '4.00' }] }]);

    const afetadas = await comissoesRepository.estornarPorVendaId(5, 9, client);

    expect(afetadas).toBe(1);

    const [sqlRepasses, paramsRepasses] = client.query.mock.calls[0];
    expect(sqlRepasses).toContain("SET status = 'cancelado'");
    expect(sqlRepasses).toContain("status = 'a_repassar'");
    expect(paramsRepasses).toEqual([5, 9]);

    const [sqlSelect, paramsSelect] = client.query.mock.calls[1];
    expect(sqlSelect).toContain("status <> 'estornada'");
    expect(sqlSelect).toContain('empresa_id = $2');
    expect(sqlSelect).toContain('FOR UPDATE');
    expect(paramsSelect).toEqual([5, 9]);

    const [sqlUpdate, paramsUpdate] = client.query.mock.calls[2];
    expect(sqlUpdate).toContain("status = 'estornada', valor_liberado = 0");
    expect(paramsUpdate).toEqual([7, 9]);

    const [sqlEvento, paramsEvento] = client.query.mock.calls[3];
    expect(sqlEvento).toContain('INSERT INTO comissoes_eventos');
    expect(paramsEvento).toEqual([9, 7, 5, 'estorno', 'cancelamento_venda', '-4.00', 0, null, null]);

    client.query.mock.calls.forEach(([sql]) => expect(sql).not.toMatch(/DELETE/i));
  });

  test('venda sem comissão (ou já estornada) é no-op: 0 e sem escrever', async () => {
    const client = fakeClient([{ rowCount: 0 }, { rows: [] }]);

    await expect(comissoesRepository.estornarPorVendaId(5, 9, client)).resolves.toBe(0);
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});

describe('registrarRepasses', () => {
  test('exige o client da transação', async () => {
    await expect(comissoesRepository.registrarRepasses({ venda_id: 1, empresa_id: 9, vendedor_id: 2, pagamentos: [] }))
      .rejects.toThrow('exige o client da transação');
  });

  test('sem pagamento em dinheiro não consulta nem grava', async () => {
    const client = fakeClient();

    await expect(comissoesRepository.registrarRepasses({
      venda_id: 1, empresa_id: 9, vendedor_id: 2, pagamentos: [{ id: 1, forma_pagamento: 'pix', valor: '50.00' }]
    }, client)).resolves.toBe(0);

    expect(client.query).not.toHaveBeenCalled();
  });

  test('venda sem comissão (vendedor sem percentual, dona) não gera repasse', async () => {
    const client = fakeClient([{ rows: [] }]);

    await expect(comissoesRepository.registrarRepasses({
      venda_id: 1, empresa_id: 9, vendedor_id: 2, pagamentos: [{ id: 1, forma_pagamento: 'dinheiro', valor: '50.00' }]
    }, client)).resolves.toBe(0);

    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('cada pagamento em dinheiro de venda com comissão vira um repasse, idempotente', async () => {
    const client = fakeClient([{ rows: [{ id: 3 }] }]);

    await comissoesRepository.registrarRepasses({
      venda_id: 1, empresa_id: 9, vendedor_id: 2,
      pagamentos: [
        { id: 11, forma_pagamento: 'dinheiro', valor: '40.00' },
        { id: 12, forma_pagamento: 'pix', valor: '60.00' }
      ]
    }, client);

    expect(client.query).toHaveBeenCalledTimes(2);
    const [sql, params] = client.query.mock.calls[1];
    expect(sql).toContain('INSERT INTO comissao_repasses');
    expect(sql).toContain('ON CONFLICT (pagamento_id) DO NOTHING');
    expect(params).toEqual([9, 11, 1, 2, '40.00']);
  });
});

describe('recalcularLiberacao', () => {
  const comissao = (extra = {}) => ({ id: 7, valor: '10.00', valor_liberado: '0.00', status: 'pendente', total: '100.00', forma_pagamento: 'a_vista', ...extra });
  const dados = { venda_id: 5, empresa_id: 9, origem: 'pagamento', executado_por: 3 };

  test('exige o client da transação', async () => {
    await expect(comissoesRepository.recalcularLiberacao(dados)).rejects.toThrow('exige o client da transação');
  });

  test('sem comissão ou já estornada: no-op', async () => {
    await expect(comissoesRepository.recalcularLiberacao(dados, fakeClient([{ rows: [] }]))).resolves.toBeNull();

    const client = fakeClient([{ rows: [comissao({ status: 'estornada' })] }]);
    await expect(comissoesRepository.recalcularLiberacao(dados, client)).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('trava a linha da comissão, sempre no tenant', async () => {
    const client = fakeClient([{ rows: [comissao()] }, { rows: [{ n: '1' }] }, { rows: [{ pago: '0.00' }] }]);

    await comissoesRepository.recalcularLiberacao(dados, client);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('FOR UPDATE OF c');
    expect(sql).toContain('c.empresa_id = $2');
    expect(params).toEqual([5, 9]);
  });

  test('pagamento proporcional: 40 de 100 pagos liberam 40% da comissão e gravam evento', async () => {
    const client = fakeClient([{ rows: [comissao()] }, { rows: [{ n: '2' }] }, { rows: [{ pago: '40.00' }] }]);

    const resultado = await comissoesRepository.recalcularLiberacao(dados, client);

    expect(resultado).toEqual({ id: 7, status: 'parcial', alterado: true });
    expect(client.query.mock.calls[3][1]).toEqual(['4.00', 'parcial', 7, 9]);
    expect(client.query.mock.calls[4][1]).toEqual([9, 7, 5, 'liberacao', 'pagamento', '4.00', '4.00', null, 3]);
  });

  test('pago integral libera tudo (liberada); nada pago mantém pendente sem evento', async () => {
    const cheio = fakeClient([{ rows: [comissao()] }, { rows: [{ n: '1' }] }, { rows: [{ pago: '100.00' }] }]);
    await expect(comissoesRepository.recalcularLiberacao(dados, cheio)).resolves.toMatchObject({ status: 'liberada', alterado: true });

    const vazio = fakeClient([{ rows: [comissao()] }, { rows: [{ n: '1' }] }, { rows: [{ pago: '0.00' }] }]);
    await expect(comissoesRepository.recalcularLiberacao(dados, vazio)).resolves.toMatchObject({ status: 'pendente', alterado: false });
    expect(vazio.query).toHaveBeenCalledTimes(3);
  });

  test('estorno de pagamento reduz o liberado e grava evento de redução', async () => {
    const client = fakeClient([
      { rows: [comissao({ valor_liberado: '10.00', status: 'liberada' })] },
      { rows: [{ n: '1' }] },
      { rows: [{ pago: '50.00' }] }
    ]);

    const resultado = await comissoesRepository.recalcularLiberacao({ ...dados, origem: 'estorno_pagamento' }, client);

    expect(resultado).toEqual({ id: 7, status: 'parcial', alterado: true });
    expect(client.query.mock.calls[4][1].slice(3, 7)).toEqual(['reducao', 'estorno_pagamento', '-5.00', '5.00']);
  });

  test('venda legada a prazo só libera quando a conta a receber é recebida', async () => {
    const client = fakeClient([
      { rows: [comissao({ forma_pagamento: 'prazo' })] },
      { rows: [{ n: '0' }] },
      { rows: [{ pago: '100.00' }] }
    ]);

    await comissoesRepository.recalcularLiberacao(dados, client);

    expect(client.query.mock.calls[2][0]).toContain('FROM contas_receber');
    expect(client.query.mock.calls[2][0]).toContain("status = 'recebido'");
  });

  test('venda legada à vista conta como paga, sem consultar contas', async () => {
    const client = fakeClient([{ rows: [comissao()] }, { rows: [{ n: '0' }] }]);

    await expect(comissoesRepository.recalcularLiberacao(dados, client)).resolves.toMatchObject({ status: 'liberada' });
  });

  test('o SQL do fluxo novo ignora dinheiro sem repasse confirmado e desconta estornos', async () => {
    const client = fakeClient([{ rows: [comissao()] }, { rows: [{ n: '1' }] }, { rows: [{ pago: '0.00' }] }]);

    await comissoesRepository.recalcularLiberacao(dados, client);

    const sql = client.query.mock.calls[2][0];
    expect(sql).toContain("r.status = 'confirmado'");
    expect(sql).toContain('estornos_pagamento');
    expect(sql).toContain('pv.venda_id = $1 AND pv.empresa_id = $2');
  });
});

describe('confirmarRepasse', () => {
  const executar = (linha, client) => executarComLock.mockImplementation(async (_t, _c, _e, _x, cb) => cb(linha, client));
  const args = { id: 4, empresa_id: 9, confirmado_por: 1, observacao: 'Recebi na loja' };

  test('trava o repasse pelo id e pelo tenant', async () => {
    executar(null, fakeClient());

    await expect(comissoesRepository.confirmarRepasse(args)).rejects.toMatchObject({ statusCode: 404 });
    expect(executarComLock).toHaveBeenCalledWith('comissao_repasses', { coluna: 'id', valor: 4 }, 9, undefined, expect.any(Function));
  });

  test('o próprio vendedor não confirma o seu repasse (403)', async () => {
    executar({ id: 4, vendedor_id: 1, status: 'a_repassar', venda_id: 5 }, fakeClient());

    await expect(comissoesRepository.confirmarRepasse(args)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('repasse já confirmado ou cancelado: 409', async () => {
    for (const status of ['confirmado', 'cancelado']) {
      executar({ id: 4, vendedor_id: 2, status, venda_id: 5 }, fakeClient());
      await expect(comissoesRepository.confirmarRepasse(args)).rejects.toMatchObject({ statusCode: 409 });
    }
  });

  test('confirma e recalcula a liberação da venda na mesma transação', async () => {
    const client = fakeClient([{ rows: [{ id: 4, status: 'confirmado' }] }, { rows: [] }]);
    executar({ id: 4, vendedor_id: 2, status: 'a_repassar', venda_id: 5 }, client);

    const resultado = await comissoesRepository.confirmarRepasse(args);

    expect(resultado).toEqual({ id: 4, status: 'confirmado' });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("SET status = 'confirmado'");
    expect(sql).toContain('empresa_id = $4');
    expect(params).toEqual([1, 'Recebi na loja', 4, 9]);
    expect(client.query.mock.calls[1][0]).toContain('FROM comissoes_venda');
    expect(client.query.mock.calls[1][1]).toEqual([5, 9]);
  });
});

describe('historicoDaComissao', () => {
  test('vendedor comum só vê a própria: filtra pelo dono; outra comissão é 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(comissoesRepository.historicoDaComissao({ empresa_id: 9, comissao_id: 7, usuario_id: 2 }))
      .rejects.toMatchObject({ statusCode: 404 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('c.empresa_id = $2');
    expect(sql).toContain('c.usuario_id = $3');
    expect(params).toEqual([7, 9, 2]);
  });

  test('gerente (sem filtro de dono) vê qualquer comissão do tenant, com a linha do tempo', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, tipo: 'apurada' }] });

    const resultado = await comissoesRepository.historicoDaComissao({ empresa_id: 9, comissao_id: 7 });

    expect(resultado.eventos).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).not.toContain('c.usuario_id = $3');
    expect(db.query.mock.calls[1][1]).toEqual([7, 9]);
  });
});

describe('listarRepasses', () => {
  test('vendedor: filtra por tenant e por si mesmo; gerente: só por tenant', async () => {
    db.query.mockResolvedValue({ rows: [{ quantidade: '0', total_a_repassar: '0' }] });

    await comissoesRepository.listarRepasses({ empresa_id: 9, vendedor_id: 2, status: 'a_repassar', limit: 20, offset: 0 });
    expect(db.query.mock.calls[0][0]).toContain('r.empresa_id = $1');
    expect(db.query.mock.calls[0][0]).toContain('r.vendedor_id = $2');
    expect(db.query.mock.calls[0][1].slice(0, 3)).toEqual([9, 2, 'a_repassar']);

    db.query.mockClear();
    await comissoesRepository.listarRepasses({ empresa_id: 9, limit: 20, offset: 0 });
    expect(db.query.mock.calls[0][0]).not.toContain('AND r.vendedor_id = ');
  });
});

describe('listarDoUsuario', () => {
  test('filtra por tenant E por vendedor, aplica o período e devolve liberado/pendente/a repassar', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ quantidade: '1', total_base: '100.00', total_comissao: '5.00', total_liberado: '2.00', total_pendente: '3.00', total_estornado: '0', total_pago: '1.00', a_receber: '1.00' }] })
      .mockResolvedValueOnce({ rows: [{ dinheiro_a_repassar: '40.00' }] });

    const resultado = await comissoesRepository.listarDoUsuario({
      limit: 20, offset: 0, empresa_id: 9, usuario_id: 2, data_inicio: '2026-10-01', data_fim: '2026-10-31'
    });

    expect(resultado.total).toBe(1);
    expect(resultado.totais).toEqual({
      total_base: '100.00', total_comissao: '5.00', total_liberado: '2.00',
      total_pendente: '3.00', total_estornado: '0', total_pago: '1.00', a_receber: '1.00', dinheiro_a_repassar: '40.00'
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('c.empresa_id = $1');
    expect(sql).toContain('c.usuario_id = $2');
    expect(params.slice(0, 4)).toEqual([9, 2, '2026-10-01', '2026-10-31']);
    expect(db.query.mock.calls[2][1]).toEqual([9, 2]);
  });
});

describe('resumoEquipe', () => {
  test('soma os totais por vendedor e filtra pelo tenant', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { usuario_id: 2, nome: 'Ana', cargo: 'vendedor', percentual: '5.0000', quantidade_vendas: '3', total_base: '300.00', total_comissao: '15.00', total_liberado: '10.00', total_pendente: '5.00', total_estornado: '0', total_pago: '4.00', a_pagar: '6.00', dinheiro_a_repassar: '20.00' },
        { usuario_id: 3, nome: 'Bia', cargo: 'vendedor', percentual: null, quantidade_vendas: '0', total_base: '0', total_comissao: '0', total_liberado: '0', total_pendente: '0', total_estornado: '2.50', total_pago: '0', a_pagar: '0', dinheiro_a_repassar: '0' }
      ]
    });

    const resultado = await comissoesRepository.resumoEquipe({ empresa_id: 9 });

    expect(resultado.items).toHaveLength(2);
    expect(resultado.totais).toEqual({
      total_base: '300.00', total_comissao: '15.00', total_liberado: '10.00',
      total_pendente: '5.00', total_estornado: '2.50', total_pago: '4.00', a_pagar: '6.00', dinheiro_a_repassar: '20.00'
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('u.empresa_id = $1');
    expect(sql).toContain("CASE WHEN u.papel <> 'admin'");
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

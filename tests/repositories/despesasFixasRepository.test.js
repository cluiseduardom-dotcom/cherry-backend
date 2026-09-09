jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const despesasFixasRepository = require('../../src/repositories/despesasFixasRepository');

// pg devolve DATE como Date à meia-noite local — replicado aqui com o
// construtor local do Date (new Date(ano, mesIndex, dia)), que é o mesmo
// tipo de objeto que paraDataString precisa converter de volta pra string.
function dataLocal(ano, mes, dia) {
  return new Date(ano, mes - 1, dia);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listar', () => {
  test('filters by empresa_id and deletado_em IS NULL, normalizing vigencia dates back to strings', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, vigencia_inicio: dataLocal(2026, 8, 1), vigencia_fim: null }]
    });

    const resultado = await despesasFixasRepository.listar(9);

    expect(resultado).toEqual([{ id: 1, vigencia_inicio: '2026-08-01', vigencia_fim: null }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('deletado_em IS NULL');
    expect(params).toEqual([9]);
  });
});

describe('criar', () => {
  test('inserts with the given empresa_id and vigencia dates', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{
        id: 1, categoria: 'pessoal', descricao: 'Salários', valor: '5000.00',
        vigencia_inicio: dataLocal(2026, 8, 1), vigencia_fim: null
      }]
    });

    const resultado = await despesasFixasRepository.criar({
      categoria: 'pessoal', descricao: 'Salários', valor: 5000, vigencia_inicio: '2026-08-01', empresa_id: 9
    });

    expect(resultado.id).toBe(1);
    expect(resultado.vigencia_inicio).toBe('2026-08-01');
    expect(resultado.vigencia_fim).toBeNull();
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['pessoal', 'Salários', 5000, '2026-08-01', null, 9]);
  });

  test('defaults vigencia_fim to null when not provided', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, vigencia_inicio: dataLocal(2026, 8, 1), vigencia_fim: null }]
    });

    await despesasFixasRepository.criar({
      categoria: 'pessoal', descricao: 'Salários', valor: 5000, vigencia_inicio: '2026-08-01', empresa_id: 9
    });

    const [, params] = db.query.mock.calls[0];
    expect(params[4]).toBeNull();
  });

  test('inserts vigencia_fim as null when explicitly passed null (same result as omitted)', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, vigencia_inicio: dataLocal(2026, 8, 1), vigencia_fim: null }]
    });

    await despesasFixasRepository.criar({
      categoria: 'pessoal', descricao: 'Salários', valor: 5000, vigencia_inicio: '2026-08-01', vigencia_fim: null, empresa_id: 9
    });

    const [, params] = db.query.mock.calls[0];
    expect(params[4]).toBeNull();
  });
});

describe('atualizar', () => {
  test('updates only the provided fields, scoped to empresa_id and deletado_em IS NULL', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, valor: 200, vigencia_inicio: dataLocal(2026, 8, 1), vigencia_fim: null }]
    });

    const resultado = await despesasFixasRepository.atualizar(1, { valor: 200 }, 9);

    expect(resultado).toEqual({ id: 1, valor: 200, vigencia_inicio: '2026-08-01', vigencia_fim: null });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('valor = $1');
    expect(sql).toContain('WHERE id = $2 AND empresa_id = $3 AND deletado_em IS NULL');
    expect(params).toEqual([200, 1, 9]);
  });

  test('accepts updating vigencia_inicio/vigencia_fim, including clearing vigencia_fim back to null', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, vigencia_inicio: dataLocal(2026, 9, 1), vigencia_fim: null }]
    });

    await despesasFixasRepository.atualizar(1, { vigencia_inicio: '2026-09-01', vigencia_fim: null }, 9);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('vigencia_inicio = $1');
    expect(sql).toContain('vigencia_fim = $2');
    expect(params).toEqual(['2026-09-01', null, 1, 9]);
  });

  test('returns null when no row matches', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await despesasFixasRepository.atualizar(999, { valor: 200 }, 9);

    expect(resultado).toBeNull();
  });
});

describe('deletar', () => {
  test('sets deletado_em, scoped to empresa_id and deletado_em IS NULL', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, vigencia_inicio: dataLocal(2026, 8, 1), vigencia_fim: null }]
    });

    const resultado = await despesasFixasRepository.deletar(1, 9);

    expect(resultado).toEqual({ id: 1, vigencia_inicio: '2026-08-01', vigencia_fim: null });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET deletado_em = NOW()');
    expect(sql).toContain('WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL');
    expect(params).toEqual([1, 9]);
  });

  test('returns null when no row matches (already deleted or another empresa)', async () => {
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await despesasFixasRepository.deletar(999, 9);

    expect(resultado).toBeNull();
  });
});

describe('alternarAtivo', () => {
  test('flips ativo, scoped to empresa_id and deletado_em IS NULL', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ id: 1, ativo: false, vigencia_inicio: dataLocal(2026, 8, 1), vigencia_fim: null }]
    });

    const resultado = await despesasFixasRepository.alternarAtivo(1, 9);

    expect(resultado).toEqual({ id: 1, ativo: false, vigencia_inicio: '2026-08-01', vigencia_fim: null });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('SET ativo = NOT ativo');
    expect(params).toEqual([1, 9]);
  });
});

// Substitui somarAtivas. ativo = true é checado primeiro no WHERE, sempre —
// é a pausa de exceção manual: nunca conta enquanto desligado, independente
// de a vigência cobrir o período (travado no teste abaixo).
describe('listarVigentesNoPeriodo', () => {
  test('queries by empresa_id, ativo = true (pausa de exceção), deletado_em IS NULL and vigência sobrepondo o período', async () => {
    db.query = jest.fn().mockResolvedValue({
      rows: [{ valor: '3100.00', vigencia_inicio: dataLocal(2026, 1, 1), vigencia_fim: null }]
    });

    const resultado = await despesasFixasRepository.listarVigentesNoPeriodo(9, '2026-08-01', '2026-08-31');

    expect(resultado).toEqual([{ valor: '3100.00', vigencia_inicio: '2026-01-01', vigencia_fim: null }]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('empresa_id = $1');
    expect(sql).toContain('ativo = true');
    expect(sql).toContain('deletado_em IS NULL');
    expect(sql).toContain('vigencia_inicio <= $3');
    expect(sql).toContain('vigencia_fim IS NULL OR vigencia_fim >= $2');
    expect(params).toEqual([9, '2026-08-01', '2026-08-31']);
  });

  test('a despesa desativada (ativo = false) nunca é listada, mesmo com vigência cobrindo o período inteiro', async () => {
    // A query real filtra isso no banco (ativo = true no WHERE); aqui travamos
    // que o WHERE sempre carrega essa condição, então uma despesa ativo=false
    // não pode nem chegar nas rows devolvidas pelo banco.
    db.query = jest.fn().mockResolvedValue({ rows: [] });

    const resultado = await despesasFixasRepository.listarVigentesNoPeriodo(9, '2026-08-01', '2026-08-31');

    expect(resultado).toEqual([]);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/ativo = true/);
  });
});

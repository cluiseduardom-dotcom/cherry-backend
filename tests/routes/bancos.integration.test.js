// Integração de verdade (Postgres real): módulo Bancos (contas, movimentos, saldo, conciliação).
// Prova permissão (gerir_financeiro), isolamento por empresa, saldo sem cancelados/futuros, cancelamento em vez
// de exclusão (o banco recusa DELETE/UPDATE de valor), idempotência e conciliação sem corrida.
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');

jest.unmock('../../src/repositories/sessaoRepository');

const db = require('../../src/config/db');
const app = require('../../src/app');
const movimentosRepo = require('../../src/repositories/movimentosBancariosRepository');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const senha = crypto.randomBytes(12).toString('hex');
const hojeBr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const diasAtras = (n) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const t = {};
let empresaA;
let empresaB;

async function criarUsuario(empresaId, papel, rotulo) {
  const email = `${rotulo}-${sufixo}@teste.invalid`;
  await db.query(
    `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5)`,
    [empresaId, `Usuário ${rotulo}`, email, await bcrypt.hash(senha, 4), papel]
  );
  const res = await request(app).post('/auth/login').send({ email, senha });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

const com = (token) => ({ Authorization: `Bearer ${token}` });
const get = (token, url) => request(app).get(url).set(com(token));
const post = (token, url, corpo) => request(app).post(url).set(com(token)).send(corpo);
const patch = (token, url, corpo) => request(app).patch(url).set(com(token)).send(corpo);
const saldoDe = async (token, contaId) => Number((await get(token, `/bancos/contas/${contaId}`)).body.data.saldo_atual);

beforeAll(async () => {
  empresaA = registro.registrar((await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste Bancos A ${sufixo}`, `t-bancos-a-${sufixo}`])).rows[0].id);
  empresaB = registro.registrar((await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste Bancos B ${sufixo}`, `t-bancos-b-${sufixo}`])).rows[0].id);
  t.adminA = await criarUsuario(empresaA, 'admin', 'admin-a');
  t.vendedorA = await criarUsuario(empresaA, 'vendedor', 'vend-a');
  t.adminB = await criarUsuario(empresaB, 'admin', 'admin-b');
});

afterAll(async () => {
  try {
    await registro.limpar();
  } finally {
    await db.end();
  }
});

describe('Bancos: saldo por dia (independe do horário do teste)', () => {
  test('movimento de hoje conta no saldo mesmo que o horário gravado ainda não tenha chegado; amanhã vai para a liberar', async () => {
    const conta = (await post(t.adminA, '/bancos/contas', { nome: 'Saldo por dia', tipo: 'CAIXA', saldo_inicial: 0 })).body.data.id;
    const hoje = hojeBr();
    const amanha = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const usuario = (await db.query('SELECT id FROM usuarios WHERE empresa_id = $1 LIMIT 1', [empresaA])).rows[0].id;
    const grava = (data, valor) => movimentosRepo.criar({
      empresa_id: empresaA, conta_bancaria_id: conta, tipo: 'ENTRADA', origem: 'MANUAL', valor,
      data_movimento: data, descricao: 'dia', usuario_id: usuario
    });
    await grava(`${hoje}T23:59:59-03:00`, 100); // ainda "no futuro" por horário, mas é hoje
    await grava(`${amanha}T00:00:01-03:00`, 40); // amanhã

    const c = (await get(t.adminA, `/bancos/contas/${conta}`)).body.data;
    expect(Number(c.saldo_atual)).toBe(100);
    expect(Number(c.a_liberar)).toBe(40);
  });
});

describe('Bancos: acesso', () => {
  test('sem login 401; vendedor 403; admin 200', async () => {
    expect((await request(app).get('/bancos/contas')).status).toBe(401);
    expect((await get(t.vendedorA, '/bancos/contas')).status).toBe(403);
    expect((await get(t.vendedorA, '/bancos/movimentos')).status).toBe(403);
    expect((await post(t.vendedorA, '/bancos/movimentos', {})).status).toBe(403);
    expect((await get(t.adminA, '/bancos/contas')).status).toBe(200);
  });
});

describe('Bancos: contas e saldo', () => {
  test('criação é sempre manual e recusa campos que não são do cliente', async () => {
    for (const extra of [{ empresa_id: empresaB }, { origem: 'OPEN_FINANCE' }, { provedor: 'x' }, { status: 'ATIVA' }]) {
      const res = await post(t.adminA, '/bancos/contas', { nome: 'Conta X', tipo: 'CONTA_CORRENTE', ...extra });
      expect(res.status).toBe(400);
    }
    expect((await post(t.adminA, '/bancos/contas', { nome: 'X', tipo: 'COFRE' })).status).toBe(400);
    expect((await post(t.adminA, '/bancos/contas', { nome: 'Conta X', tipo: 'CAIXA', saldo_inicial: 10.123 })).status).toBe(400);

    const ok = await post(t.adminA, '/bancos/contas', { nome: 'Banco Principal', tipo: 'CONTA_CORRENTE', saldo_inicial: 1000, data_saldo_inicial: diasAtras(10), principal: true });
    expect(ok.status).toBe(201);
    expect(ok.body.data.origem).toBe('MANUAL');
    expect(Number(ok.body.data.empresa_id)).toBe(Number(empresaA));
    t.contaA = ok.body.data.id;
  });

  test('saldo = inicial + entradas − saídas; data futura e valor inválido são recusados', async () => {
    const base = { conta_bancaria_id: t.contaA, data_movimento: hojeBr() };
    expect((await post(t.adminA, '/bancos/movimentos', { ...base, tipo: 'ENTRADA', valor: 250, descricao: 'Venda balcão' })).status).toBe(201);
    expect((await post(t.adminA, '/bancos/movimentos', { ...base, tipo: 'SAIDA', valor: 100.5, descricao: 'Material' })).status).toBe(201);
    expect(await saldoDe(t.adminA, t.contaA)).toBeCloseTo(1149.5, 2);

    expect((await post(t.adminA, '/bancos/movimentos', { ...base, tipo: 'ENTRADA', valor: 10, descricao: 'Amanhã', data_movimento: '2999-01-01' })).status).toBe(400);
    expect((await post(t.adminA, '/bancos/movimentos', { ...base, tipo: 'ENTRADA', valor: -5, descricao: 'Negativo' })).status).toBe(400);
    expect((await post(t.adminA, '/bancos/movimentos', { ...base, tipo: 'ENTRADA', valor: 0, descricao: 'Zero' })).status).toBe(400);
    expect((await post(t.adminA, '/bancos/movimentos', { ...base, tipo: 'ENTRADA', valor: 5, descricao: 'ab' })).status).toBe(400);
    expect((await post(t.adminA, '/bancos/movimentos', { ...base, tipo: 'ENTRADA', valor: 5, descricao: 'Com origem', origem: 'PAGAMENTO' })).status).toBe(400);
  });

  test('movimento anterior à data do saldo inicial não entra no saldo', async () => {
    const conta = (await post(t.adminA, '/bancos/contas', { nome: 'Caixa da loja', tipo: 'CAIXA', saldo_inicial: 50, data_saldo_inicial: hojeBr() })).body.data.id;
    await post(t.adminA, '/bancos/movimentos', { conta_bancaria_id: conta, tipo: 'ENTRADA', valor: 999, descricao: 'Antes do saldo', data_movimento: diasAtras(3) });
    expect(await saldoDe(t.adminA, conta)).toBe(50);
  });

  test('movimento futuro (liberação) vai para "a liberar", não para o saldo atual', async () => {
    const conta = (await post(t.adminA, '/bancos/contas', { nome: 'Conta de pagamento', tipo: 'CONTA_PAGAMENTO' })).body.data.id;
    const r = await movimentosRepo.criarSeNovo({
      empresa_id: empresaA, conta_bancaria_id: conta, tipo: 'ENTRADA', origem: 'API_BANCO', valor: 80,
      data_movimento: new Date(Date.now() + 5 * 86_400_000), descricao: 'Liberação futura', referencia_externa: `fut-${sufixo}`
    });
    expect(r.criado).toBe(true);
    const c = (await get(t.adminA, `/bancos/contas/${conta}`)).body.data;
    expect(Number(c.saldo_atual)).toBe(0);
    expect(Number(c.a_liberar)).toBe(80);
  });

  test('saldo inicial trava depois de haver movimentos; nome e principal seguem editáveis', async () => {
    expect((await patch(t.adminA, `/bancos/contas/${t.contaA}`, { saldo_inicial: 5 })).status).toBe(409);
    expect((await patch(t.adminA, `/bancos/contas/${t.contaA}`, {})).status).toBe(400);
    expect((await patch(t.adminA, `/bancos/contas/${t.contaA}`, { nome: 'Banco do Brasil' })).body.data.nome).toBe('Banco do Brasil');

    const outra = (await post(t.adminA, '/bancos/contas', { nome: 'Segunda conta', tipo: 'CONTA_POUPANCA' })).body.data.id;
    expect((await patch(t.adminA, `/bancos/contas/${outra}`, { principal: true })).status).toBe(200);
    const lista = (await get(t.adminA, '/bancos/contas')).body.data;
    expect(lista.filter((c) => c.principal)).toHaveLength(1);
    expect(lista.find((c) => c.principal).id).toBe(outra);
  });

  test('conta inativa não aceita lançamento nem vira principal', async () => {
    const c = (await post(t.adminA, '/bancos/contas', { nome: 'Conta antiga', tipo: 'CAIXA' })).body.data.id;
    expect((await patch(t.adminA, `/bancos/contas/${c}/status`, { status: 'INATIVA' })).status).toBe(200);
    expect((await post(t.adminA, '/bancos/movimentos', { conta_bancaria_id: c, tipo: 'ENTRADA', valor: 1, descricao: 'Em conta inativa', data_movimento: hojeBr() })).status).toBe(400);
    expect((await patch(t.adminA, `/bancos/contas/${c}`, { principal: true })).status).toBe(400);
  });
});

describe('Bancos: isolamento entre empresas', () => {
  test('empresa B não vê nem mexe no que é da A', async () => {
    const mov = (await post(t.adminA, '/bancos/movimentos', { conta_bancaria_id: t.contaA, tipo: 'ENTRADA', valor: 7, descricao: 'Só da empresa A', data_movimento: hojeBr() })).body.data;
    t.movA = mov.id;

    expect((await get(t.adminB, `/bancos/contas/${t.contaA}`)).status).toBe(404);
    expect((await get(t.adminB, '/bancos/contas')).body.data).toEqual([]);
    expect((await get(t.adminB, '/bancos/movimentos')).body.data.items).toEqual([]);
    expect((await get(t.adminB, `/bancos/movimentos?conta_bancaria_id=${t.contaA}`)).body.data.items).toEqual([]);
    expect((await patch(t.adminB, `/bancos/contas/${t.contaA}`, { nome: 'Invadida' })).status).toBe(404);
    expect((await patch(t.adminB, `/bancos/contas/${t.contaA}/status`, { status: 'INATIVA' })).status).toBe(404);
    expect((await post(t.adminB, '/bancos/movimentos', { conta_bancaria_id: t.contaA, tipo: 'SAIDA', valor: 1, descricao: 'Invasão', data_movimento: hojeBr() })).status).toBe(404);
    expect((await post(t.adminB, `/bancos/movimentos/${t.movA}/cancelar`, { motivo: 'Invasão' })).status).toBe(404);
    expect((await post(t.adminB, '/bancos/conciliacoes', { movimento_bancario_id: t.movA })).status).toBe(404);
    expect((await get(t.adminA, `/bancos/contas/${t.contaA}`)).body.data.nome).toBe('Banco do Brasil');
  });
});

describe('Bancos: cancelamento em vez de exclusão', () => {
  test('cancelar exige motivo, tira do saldo, some da lista e não se repete', async () => {
    const antes = await saldoDe(t.adminA, t.contaA);
    expect((await post(t.adminA, `/bancos/movimentos/${t.movA}/cancelar`, {})).status).toBe(400);
    expect((await post(t.adminA, `/bancos/movimentos/${t.movA}/cancelar`, { motivo: 'x' })).status).toBe(400);

    const ok = await post(t.adminA, `/bancos/movimentos/${t.movA}/cancelar`, { motivo: 'Lançado em duplicidade' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.cancelado_em).toBeTruthy();
    expect(await saldoDe(t.adminA, t.contaA)).toBeCloseTo(antes - 7, 2);

    expect((await post(t.adminA, `/bancos/movimentos/${t.movA}/cancelar`, { motivo: 'De novo' })).status).toBe(409);
    const ativos = (await get(t.adminA, `/bancos/movimentos?conta_bancaria_id=${t.contaA}`)).body.data.items;
    expect(ativos.find((m) => m.id === t.movA)).toBeUndefined();
    const todos = (await get(t.adminA, `/bancos/movimentos?conta_bancaria_id=${t.contaA}&incluir_cancelados=true`)).body.data.items;
    expect(todos.find((m) => m.id === t.movA).motivo_cancelamento).toBe('Lançado em duplicidade');
  });

  test('o banco recusa apagar e alterar valor/tipo/data de movimento', async () => {
    await expect(db.query('DELETE FROM movimentos_bancarios WHERE id = $1', [t.movA])).rejects.toThrow(/cancele/);
    await expect(db.query('UPDATE movimentos_bancarios SET valor = 1 WHERE id = $1', [t.movA])).rejects.toThrow(/não se alteram/);
    await expect(db.query(`UPDATE movimentos_bancarios SET tipo = 'SAIDA' WHERE id = $1`, [t.movA])).rejects.toThrow(/não se alteram/);
    await expect(db.query('UPDATE movimentos_bancarios SET cancelado_em = NULL, motivo_cancelamento = NULL WHERE id = $1', [t.movA])).rejects.toThrow(/não se reabre/);
  });

  test('lançamento automático com a mesma referência não duplica (nem depois de cancelado)', async () => {
    const dados = { empresa_id: empresaA, conta_bancaria_id: t.contaA, tipo: 'ENTRADA', origem: 'API_BANCO', valor: 33, descricao: 'Pix recebido', referencia_externa: `pix-${sufixo}` };
    const a = await movimentosRepo.criarSeNovo(dados);
    const b = await movimentosRepo.criarSeNovo(dados);
    expect(a.criado).toBe(true);
    expect(b.criado).toBe(false);
    await post(t.adminA, `/bancos/movimentos/${a.movimento.id}/cancelar`, { motivo: 'Teste de idempotência' });
    expect((await movimentosRepo.criarSeNovo(dados)).criado).toBe(false);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM movimentos_bancarios WHERE empresa_id = $1 AND referencia_externa = $2', [empresaA, dados.referencia_externa]);
    expect(rows[0].n).toBe(1);
  });
});

describe('Bancos: conciliação', () => {
  test('concilia uma vez; duas chamadas simultâneas, só uma vence; desfazer libera de novo', async () => {
    const m = (await post(t.adminA, '/bancos/movimentos', { conta_bancaria_id: t.contaA, tipo: 'ENTRADA', valor: 120, descricao: 'Extrato 120', data_movimento: hojeBr() })).body.data.id;

    const rodada = await Promise.all([
      post(t.adminA, '/bancos/conciliacoes', { movimento_bancario_id: m, referencia_externa: 'EXT-1', valor_externo: 120 }),
      post(t.adminA, '/bancos/conciliacoes', { movimento_bancario_id: m, referencia_externa: 'EXT-1', valor_externo: 120 })
    ]);
    expect(rodada.map((r) => r.status).filter((s) => s === 201)).toHaveLength(1);
    expect(rodada.find((r) => r.status !== 201).status).toBeGreaterThanOrEqual(400);
    const concId = rodada.find((r) => r.status === 201).body.data.id;
    const { rows: ativas } = await db.query(`SELECT COUNT(*)::int AS n FROM conciliacoes_bancarias WHERE movimento_bancario_id = $1 AND status = 'CONCILIADA'`, [m]);
    expect(ativas[0].n).toBe(1);

    expect((await post(t.adminA, `/bancos/movimentos/${m}/cancelar`, { motivo: 'Tentativa indevida' })).status).toBe(409);

    expect((await post(t.adminA, `/bancos/conciliacoes/${concId}/desfazer`, {})).status).toBe(200);
    expect((await post(t.adminA, `/bancos/conciliacoes/${concId}/desfazer`, {})).status).toBe(409);
    const { rows } = await db.query('SELECT conciliado FROM movimentos_bancarios WHERE id = $1', [m]);
    expect(rows[0].conciliado).toBe(false);

    const nova = await post(t.adminA, '/bancos/conciliacoes', { movimento_bancario_id: m });
    expect(nova.status).toBe(201);

    // A lista de movimentos informa a conciliação ativa (a tela usa para "desfazer").
    const item = (await get(t.adminA, `/bancos/movimentos?conta_bancaria_id=${t.contaA}`)).body.data.items.find((x) => x.id === m);
    expect(item.conciliado).toBe(true);
    expect(item.conciliacao_id).toBe(nova.body.data.id);
  });

  test('movimento cancelado não se concilia; empresa B não desfaz conciliação da A', async () => {
    expect((await post(t.adminA, '/bancos/conciliacoes', { movimento_bancario_id: t.movA })).status).toBe(400);
    const { rows } = await db.query(`SELECT id FROM conciliacoes_bancarias WHERE empresa_id = $1 AND status = 'CONCILIADA' LIMIT 1`, [empresaA]);
    expect((await post(t.adminB, `/bancos/conciliacoes/${rows[0].id}/desfazer`, {})).status).toBe(404);
  });
});

describe('Bancos: fluxo de caixa', () => {
  test('não conta movimento cancelado', async () => {
    const hoje = hojeBr();
    const res = await get(t.adminA, `/financeiro/fluxo-caixa?data_inicio=${hoje}&data_fim=${hoje}&conta_bancaria_id=${t.contaA}`);
    expect(res.status).toBe(200);
    // Hoje na conta: +250 −100,50 +120 (conciliado) ; o de 7 e o de 33 foram cancelados.
    expect(Number(res.body.data.resumo.entradas)).toBeCloseTo(370, 2);
    expect(Number(res.body.data.resumo.saidas)).toBeCloseTo(100.5, 2);
  });
});

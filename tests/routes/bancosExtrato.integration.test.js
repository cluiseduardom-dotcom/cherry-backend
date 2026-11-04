// Integração (Postgres real): importação de extrato OFX/CSV. Prova prévia sem gravar, deduplicação, bloqueio de
// contagem em dobro, corte por data do saldo inicial, atomicidade, permissão, isolamento e sugestões de títulos.
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');

jest.unmock('../../src/repositories/sessaoRepository');

const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const senha = crypto.randomBytes(12).toString('hex');
const dia = (n) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const ofxData = (n) => dia(n).replaceAll('-', '');
const br = (n) => dia(n).split('-').reverse().join('/');

let empresaA; let empresaB; let adminA; let adminB; let vendedorA; let usuarioAId; let conta;

async function criarUsuario(empresaId, papel, rotulo) {
  const email = `${rotulo}-${sufixo}@teste.invalid`;
  const { rows } = await db.query(
    'INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [empresaId, `U ${rotulo}`, email, await bcrypt.hash(senha, 4), papel]
  );
  const res = await request(app).post('/auth/login').send({ email, senha });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: rows[0].id };
}
const com = (t) => ({ Authorization: `Bearer ${t}` });
const post = (t, url, corpo) => request(app).post(url).set(com(t)).send(corpo);
const saldo = async (t, id) => Number((await request(app).get(`/bancos/contas/${id}`).set(com(t))).body.data.saldo_atual);
const ofx = (itens) => `OFXHEADER:100\n<OFX><BANKTRANLIST>\n${itens.map(([fit, n, v, memo]) =>
  `<STMTTRN>\n<TRNTYPE>OTHER\n<DTPOSTED>${ofxData(n)}\n<TRNAMT>${v}\n<FITID>${fit}\n<MEMO>${memo}\n</STMTTRN>`).join('\n')}\n</BANKTRANLIST></OFX>`;

beforeAll(async () => {
  empresaA = registro.registrar((await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1,'ativa',$2) RETURNING id`, [`Teste Ext A ${sufixo}`, `t-ext-a-${sufixo}`])).rows[0].id);
  empresaB = registro.registrar((await db.query(`INSERT INTO empresas (nome, status, slug) VALUES ($1,'ativa',$2) RETURNING id`, [`Teste Ext B ${sufixo}`, `t-ext-b-${sufixo}`])).rows[0].id);
  const a = await criarUsuario(empresaA, 'admin', 'ext-admin-a');
  adminA = a.token; usuarioAId = a.id;
  vendedorA = (await criarUsuario(empresaA, 'vendedor', 'ext-vend-a')).token;
  adminB = (await criarUsuario(empresaB, 'admin', 'ext-admin-b')).token;
  const c = await post(adminA, '/bancos/contas', { nome: 'Itaú', tipo: 'CONTA_CORRENTE', saldo_inicial: 1000, data_saldo_inicial: dia(10) });
  expect(c.status).toBe(201);
  conta = Number(c.body.data.id);
});
afterAll(async () => { try { await registro.limpar(); } finally { await db.end(); } });

describe('Bancos: importar extrato', () => {
  const arquivo = ofx([['F1', 3, '500.00', 'PIX RECEBIDO'], ['F2', 2, '-120,50', 'ENERGIA'], ['F3', 20, '-9.00', 'ANTIGA']]);

  test('permissão, isolamento e corpo estrito', async () => {
    expect((await post(vendedorA, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: arquivo })).status).toBe(403);
    expect((await post(adminB, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: arquivo })).status).toBe(404);
    expect((await post(adminA, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: arquivo, empresa_id: 9 })).status).toBe(400);
    expect((await post(adminA, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: '' })).status).toBe(400);
  });

  test('prévia classifica e não grava nada', async () => {
    const r = await post(adminA, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: arquivo });
    expect(r.status).toBe(200);
    expect(r.body.data.formato).toBe('OFX');
    expect(r.body.data.resumo).toMatchObject({ novas: 2, fora_do_saldo: 1, ja_importadas: 0, possiveis_duplicadas: 0 });
    expect(r.body.data.linhas.map((l) => l.situacao)).toEqual(['nova', 'nova', 'fora_do_saldo']);
    expect(await saldo(adminA, conta)).toBe(1000);
  });

  test('importa; reimportar o mesmo arquivo não duplica; saldo reflete o extrato', async () => {
    const r1 = await post(adminA, '/bancos/importacoes', { conta_bancaria_id: conta, conteudo: arquivo });
    expect(r1.status).toBe(201);
    expect(r1.body.data.importadas).toBe(2);
    expect(await saldo(adminA, conta)).toBeCloseTo(1000 + 500 - 120.5, 2);

    const r2 = await post(adminA, '/bancos/importacoes', { conta_bancaria_id: conta, conteudo: arquivo });
    expect(r2.body.data.importadas).toBe(0);
    expect(r2.body.data.resumo.ja_importadas).toBe(2);
    expect(await saldo(adminA, conta)).toBeCloseTo(1379.5, 2);

    const m = (await db.query(`SELECT origem, usuario_id, to_char(data_movimento AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') d FROM movimentos_bancarios WHERE conta_bancaria_id=$1 AND referencia_externa='ofx:F1'`, [conta])).rows;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ origem: 'EXTRATO', d: dia(3) });
  });

  test('linha cancelada continua "já importada" e não ressuscita', async () => {
    const id = (await db.query(`SELECT id FROM movimentos_bancarios WHERE referencia_externa='ofx:F2' AND conta_bancaria_id=$1`, [conta])).rows[0].id;
    expect((await post(adminA, `/bancos/movimentos/${id}/cancelar`, { motivo: 'teste cancelamento' })).status).toBe(200);
    const r = await post(adminA, '/bancos/importacoes', { conta_bancaria_id: conta, conteudo: arquivo });
    expect(r.body.data.importadas).toBe(0);
    expect(await saldo(adminA, conta)).toBeCloseTo(1500, 2);
  });

  test('lançamento manual igual no mesmo dia vira possível duplicado e só entra se for incluído', async () => {
    await post(adminA, '/bancos/movimentos', { conta_bancaria_id: conta, tipo: 'ENTRADA', valor: 77, data_movimento: dia(1), descricao: 'Venda balcão' });
    const csv = `Data;Descrição;Valor\n${br(1)};PIX CLIENTE;77,00\n${br(1)};TARIFA;-3,00`;
    const p = await post(adminA, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: csv });
    expect(p.body.data.formato).toBe('CSV');
    expect(p.body.data.linhas.map((l) => l.situacao)).toEqual(['possivel_duplicado', 'nova']);
    expect(p.body.data.linhas[0].duplicado_de).toBeTruthy();

    const antes = await saldo(adminA, conta);
    const r = await post(adminA, '/bancos/importacoes', { conta_bancaria_id: conta, conteudo: csv });
    expect(r.body.data.importadas).toBe(1);
    expect(await saldo(adminA, conta)).toBeCloseTo(antes - 3, 2);

    const ref = p.body.data.linhas[0].referencia_externa;
    const r2 = await post(adminA, '/bancos/importacoes', { conta_bancaria_id: conta, conteudo: csv, incluir_possiveis_duplicados: [ref] });
    expect(r2.body.data.importadas).toBe(1);
    expect(await saldo(adminA, conta)).toBeCloseTo(antes - 3 + 77, 2);
  });

  test('data futura não entra; arquivo ilegível é 400 e nada é gravado', async () => {
    const futuro = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').reverse().join('/');
    const p = await post(adminA, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: `Data;Descrição;Valor\n${futuro};X;10,00` });
    expect(p.body.data.linhas[0].situacao).toBe('futura');
    const n0 = (await db.query('SELECT COUNT(*)::int n FROM movimentos_bancarios WHERE conta_bancaria_id=$1', [conta])).rows[0].n;
    const ruim = await post(adminA, '/bancos/importacoes', { conta_bancaria_id: conta, conteudo: 'isso nao e um extrato' });
    expect(ruim.status).toBe(400);
    expect((await db.query('SELECT COUNT(*)::int n FROM movimentos_bancarios WHERE conta_bancaria_id=$1', [conta])).rows[0].n).toBe(n0);
  });

  test('arquivo maior que o limite padrão (100 KB) é aceito neste endpoint', async () => {
    const linhas = Array.from({ length: 3000 }, (_, i) => `${br(1)};LINHA ${i} ${'x'.repeat(30)};-0,01`);
    const csv = `Data;Descrição;Valor\n${linhas.join('\n')}`;
    expect(csv.length).toBeGreaterThan(120_000);
    const p = await post(adminA, '/bancos/importacoes/previa', { conta_bancaria_id: conta, conteudo: csv });
    expect(p.status).toBe(200);
    expect(p.body.data.linhas).toHaveLength(3000);
  });

  test('sugestões: título em aberto de mesmo valor perto da data; outra empresa não aparece', async () => {
    await db.query(`INSERT INTO contas_pagar (descricao, fornecedor, valor, data_vencimento, usuario_id, empresa_id) VALUES ('Energia nov','CPFL',120.50,$1,$2,$3)`, [dia(2), usuarioAId, empresaA]);
    await db.query(`INSERT INTO contas_pagar (descricao, valor, data_vencimento, usuario_id, empresa_id) VALUES ('Longe',120.50,$1,$2,$3)`, [dia(60), usuarioAId, empresaA]);
    const csv = `Data;Descrição;Valor\n${br(2)};DEB ENERGIA;-120,50`;
    await post(adminA, '/bancos/importacoes', { conta_bancaria_id: conta, conteudo: csv });
    const mov = (await db.query(`SELECT id FROM movimentos_bancarios WHERE conta_bancaria_id=$1 AND descricao='DEB ENERGIA'`, [conta])).rows[0].id;
    const s = await request(app).get(`/bancos/movimentos/${mov}/sugestoes`).set(com(adminA));
    expect(s.status).toBe(200);
    expect(s.body.data).toHaveLength(1);
    expect(s.body.data[0]).toMatchObject({ tipo_titulo: 'conta_pagar', descricao: 'Energia nov', fornecedor: 'CPFL', valor: '120.50' });
    expect((await request(app).get(`/bancos/movimentos/${mov}/sugestoes`).set(com(adminB))).status).toBe(404);
  });
});

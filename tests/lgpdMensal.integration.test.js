// Integração de verdade (Postgres de testes): conferência mensal automática da LGPD. Só age na janela do dia 1, 09:00-09:09 UTC;
// é SOMENTE simulação (não grava) e avisa pelo Sentry (mockado aqui) quando algo venceu.
jest.mock('../src/config/monitoramento', () => ({ registrarErro: jest.fn(), iniciarMonitoramento: jest.fn(() => false), encerrarMonitoramento: jest.fn() }));

const crypto = require('node:crypto');
const db = require('../src/config/db');
const { registrarErro } = require('../src/config/monitoramento');
const lgpd = require('../src/services/lgpdService');
const { criarRegistroDeEmpresas } = require('./helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const JANELA = new Date('2026-12-01T09:03:00Z');

beforeAll(async () => {
    const empresa = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste LGPD Mensal ${sufixo}`]));
    const admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [empresa, `adm-${empresa}-${sufixo}@teste.local`]);
    await db.query(
        `INSERT INTO pedidos_loja (codigo, empresa_id, status, cliente_nome, cliente_email, cliente_telefone, chave_idempotencia, hash_requisicao, subtotal, total, reserva_expira_em, pago_em, entrega_combinada_em, entrega_combinada_por)
         VALUES ($1, $2, 'pago', 'Pessoa Antiga', 'antiga@teste.local', '11911112222', $3, $4, 50, 50, NOW(), NOW() - INTERVAL '6 years', NOW(), $5)`,
        [crypto.randomUUID(), empresa, `chave-${sufixo}`, 'a'.repeat(64), admin]
    );
});

beforeEach(() => registrarErro.mockClear());

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('janela da conferência', () => {
    test.each([
        ['2026-12-01T09:00:00Z', true],
        ['2026-12-01T09:09:59Z', true],
        ['2026-12-01T09:10:00Z', false],
        ['2026-12-01T08:59:00Z', false],
        ['2026-12-02T09:00:00Z', false],
        ['2026-11-30T09:00:00Z', false]
    ])('%s -> %s', (quando, esperado) => {
        expect(lgpd.ehJanelaDaConferenciaMensal(new Date(quando))).toBe(esperado);
    });
});

describe('conferenciaMensal', () => {
    test('fora da janela não faz nada (nem consulta nem avisa)', async () => {
        expect(await lgpd.conferenciaMensal(new Date('2026-12-15T12:00:00Z'))).toBeNull();
        expect(registrarErro).not.toHaveBeenCalled();
    });

    test('na janela: conta o vencido, avisa uma vez com só números e NÃO grava nada', async () => {
        const r = await lgpd.conferenciaMensal(JANELA);

        expect(r.total.pedidos_vencidos).toBeGreaterThanOrEqual(1);
        expect(registrarErro).toHaveBeenCalledTimes(1);
        const [erro, contexto] = registrarErro.mock.calls[0];
        expect(erro.message).toMatch(/LGPD: \d+ pedido\(s\) da loja e \d+ colaborador\(es\) com prazo de retenção vencido/);
        expect(contexto).toEqual({ rota: 'lgpd-retencao-mensal', metodo: 'CRON' });
        expect(JSON.stringify([erro.message, r])).not.toMatch(/Pessoa Antiga|antiga@teste|11911112222/);
        const { rows } = await db.query(`SELECT cliente_nome FROM pedidos_loja WHERE cliente_email = 'antiga@teste.local'`);
        expect(rows[0].cliente_nome).toBe('Pessoa Antiga');
    });
});

// Integração de verdade (Postgres de testes): datas de negócio no fuso de São Paulo. O banco guarda UTC; uma venda feita às
// 22h de 30/11 em Brasília está gravada como 01h de 01/12 em UTC e TEM que contar em 30/11 nos filtros de período e nos
// relatórios. E "hoje" (recebimento, pagamento) é o dia de Brasília. Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { hojeSP, sqlDiaSP, SQL_HOJE_SP } = require('../../src/utils/dataSaoPaulo');
const pontoEquilibrioRepository = require('../../src/repositories/pontoEquilibrioRepository');
const contasReceberRepository = require('../../src/repositories/contasReceberRepository');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const E = {};

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;

beforeAll(async () => {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Datas SP ${sufixo}`]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [E.id]);
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, 'Admin', $2, 'x', 'admin', true) RETURNING id`, [E.id, `adm-${E.id}-${sufixo}@teste.local`]);
    E.token = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });

    // 'data' é TIMESTAMP sem fuso e guarda UTC. 01:00 UTC de 01/12 = 22:00 de 30/11 em Brasília; 03:00 UTC = 00:00 de 01/12.
    const venda = (utc, total) => um(
        `INSERT INTO vendas (canal_id, usuario_id, subtotal, desconto, juros, total, status, data, empresa_id) VALUES ($1, $2, $3, 0, 0, $3, 'finalizada', $4, $5) RETURNING id`,
        [E.canal, E.admin, total, utc, E.id]
    );

    E.noiteDeNovembro = await venda('2026-12-01 01:00:00', 100);
    E.meiaNoiteDeDezembro = await venda('2026-12-01 03:00:00', 200);
    E.tardeDeNovembro = await venda('2026-11-30 15:00:00', 50);
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('o dia de São Paulo de um instante UTC', () => {
    test.each([
        ['2026-12-01 01:00:00', '2026-11-30'],
        ['2026-12-01 02:59:59', '2026-11-30'],
        ['2026-12-01 03:00:00', '2026-12-01'],
        ['2026-11-30 15:00:00', '2026-11-30'],
        ['2027-01-01 02:00:00', '2026-12-31']
    ])('%s UTC -> %s em Brasília', async (utc, esperado) => {
        const { rows } = await db.query(`SELECT to_char(${sqlDiaSP('t')}, 'YYYY-MM-DD') AS dia FROM (SELECT $1::timestamp AS t) x`, [utc]);

        expect(rows[0].dia).toBe(esperado);
    });

    test('hoje em SQL = hoje em JS (mesmo dia de Brasília)', async () => {
        const { rows } = await db.query(`SELECT to_char(${SQL_HOJE_SP}, 'YYYY-MM-DD') AS dia`);

        // Tolera a virada da meia-noite entre as duas leituras.
        expect([hojeSP(), hojeSP(new Date(Date.now() + 2000))]).toContain(rows[0].dia);
    });
});

describe('filtro de período de vendas conta o dia de Brasília', () => {
    const listar = (de, ate) => request(app).get(`/vendas?data_de=${de}&data_ate=${ate}`).set('Authorization', `Bearer ${E.token}`);
    const ids = (res) => res.body.data.items.map((v) => v.id).sort((a, b) => a - b);

    test('30/11 traz a venda das 22h (que está em 01/12 UTC) e a da tarde; 01/12 traz só a da meia-noite', async () => {
        const novembro = await listar('2026-11-30', '2026-11-30');
        const dezembro = await listar('2026-12-01', '2026-12-01');

        expect(novembro.status).toBe(200);
        expect(ids(novembro)).toEqual([E.tardeDeNovembro, E.noiteDeNovembro].sort((a, b) => a - b));
        expect(ids(dezembro)).toEqual([E.meiaNoiteDeDezembro]);
    });
});

describe('relatórios por período', () => {
    test('a receita de novembro inclui a venda das 22h de 30/11; a de dezembro não', async () => {
        expect(Number(await pontoEquilibrioRepository.somarReceita(E.id, '2026-11-01', '2026-11-30'))).toBe(150);
        expect(Number(await pontoEquilibrioRepository.somarReceita(E.id, '2026-12-01', '2026-12-31'))).toBe(200);
    });
});

describe('recebimento e pagamento levam a data de Brasília', () => {
    test('marcar conta (legada) como recebida grava o dia de São Paulo', async () => {
        const venda = await um(
            `INSERT INTO vendas (canal_id, usuario_id, subtotal, desconto, juros, total, status, data, empresa_id, forma_pagamento) VALUES ($1, $2, 80, 0, 0, 80, 'finalizada', NOW(), $3, 'prazo') RETURNING id`,
            [E.canal, E.admin, E.id]
        );
        const conta = await um(`INSERT INTO contas_receber (venda_id, descricao, valor, data_vencimento, empresa_id) VALUES ($1, 'Legada', 80, '2027-03-10', $2) RETURNING id`, [venda, E.id]);

        await contasReceberRepository.marcarComoRecebida(conta, E.id);

        const { rows } = await db.query(`SELECT to_char(data_recebimento, 'YYYY-MM-DD') AS dia, to_char(${SQL_HOJE_SP}, 'YYYY-MM-DD') AS hoje_sp FROM contas_receber WHERE id = $1`, [conta]);

        expect(rows[0].dia).toBe(rows[0].hoje_sp);
    });
});

// Integração: Taxas a receber, etapa 3 — detalhe por venda e conciliação do retido no Mercado Pago (T6).
// Rotas /painel/* reais, banco de testes. Competência antiga e própria (2025-08), por empresa de teste.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);

let operador;
let politica;
const A = {};
const B = {};
const V = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Conciliacao ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'Loja', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.adminId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.empresaId, `admin ${sufixo}`, `admin-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH]
    )).rows[0].id;
}

// Venda como o PDV grava: pagamentos (Pix do MP = origem gateway, ligado à cobrança paga com a comissão retida),
// taxa congelada sobre a parte Pix (0,50%).
async function criarVenda(alvo, dia, { pixMp = 0, retidoMp = 0, pixManual = 0, dinheiro = 0, taxa, status = 'apurada' }) {
    const total = pixMp + pixManual + dinheiro;
    const venda = (await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, usuario_id, total, status, data)
         VALUES ($1, $2, $3, $4, 'finalizada', ($5::timestamptz) AT TIME ZONE current_setting('TimeZone')) RETURNING id`,
        [alvo.empresaId, alvo.canalId, alvo.adminId, total, `2025-08-${dia}T15:00:00Z`]
    )).rows[0].id;

    const pagar = (forma, valor, origem) => db.query(
        `INSERT INTO pagamentos_venda (venda_id, empresa_id, forma_pagamento, valor, status, origem) VALUES ($1, $2, $3, $4, 'pago', $5)`,
        [venda, alvo.empresaId, forma, valor, origem]
    );
    if (pixMp) {
        await pagar('pix', pixMp, 'gateway');
        await db.query(
            `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, metodo, status, taxa_plataforma, venda_id, usada_em)
             VALUES ($1, $2, $3, 'pix', 'pago', $4, $5, NOW())`,
            [crypto.randomUUID(), alvo.empresaId, pixMp, retidoMp, venda]
        );
    }
    if (pixManual) await pagar('pix', pixManual, 'manual');
    if (dinheiro) await pagar('dinheiro', dinheiro, 'manual');

    await db.query(
        `INSERT INTO taxas_venda (venda_id, empresa_id, politica_id, plano_id, origem, tipo, percentual, base_calculo, valor, status)
         VALUES ($1, $2, $3, $4, 'padrao_sem_plano', 'percentual', 0.5, $5, $6, $7)`,
        [venda, alvo.empresaId, politica.id, politica.plano_id, pixMp + pixManual, taxa, status]
    );
    return venda;
}

const vendas = (query) => request(app).get('/painel/taxas/vendas').set(operador.cabecalho).query(query);

beforeAll(async () => {
    operador = await criarOperadorComSessao('conciliacao');
    politica = (await db.query('SELECT id, plano_id FROM politicas_taxa_plataforma ORDER BY id LIMIT 1')).rows[0];
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    // 15,00 × 0,50% = 0,075 -> 0,08 retido: confere.
    V.mpOk = await criarVenda(A, '05', { pixMp: 15, retidoMp: 0.08, taxa: 0.08 });
    // Pix manual: nada retido, nada esperado.
    V.manual = await criarVenda(A, '06', { pixManual: 100, taxa: 0.5 });
    // MP reteve 0,50 onde o esperado era 1,00: divergência de -0,50.
    V.divergente = await criarVenda(A, '07', { pixMp: 200, retidoMp: 0.5, taxa: 1 });
    // Misto: 40 pelo MP (0,20 retido) + 60 manual; taxa 0,50 sobre os 100.
    V.misto = await criarVenda(A, '08', { pixMp: 40, retidoMp: 0.2, pixManual: 60, taxa: 0.5 });
    // Só dinheiro: taxa zero, fica fora do detalhe.
    V.dinheiro = await criarVenda(A, '09', { dinheiro: 50, taxa: 0 });
    // Estornada (com divergência): aparece como estornada, não entra nos totais nem nas divergências.
    V.estornada = await criarVenda(A, '10', { pixMp: 100, retidoMp: 0.1, taxa: 0.5, status: 'estornada' });

    await criarVenda(B, '05', { pixMp: 10, retidoMp: 0.05, taxa: 0.05 });
});

afterAll(async () => {
    try {
        await registro.limpar();
        await removerOperador(operador);
    } finally {
        await db.end();
    }
});

describe('detalhe por venda (T6)', () => {
    test('uma linha por venda com Pix, origem MP/manual/misto, taxa, retido, esperado e situação', async () => {
        const res = await vendas({ competencia: '2025-08', empresa_id: A.empresaId });
        expect(res.status).toBe(200);

        const porId = Object.fromEntries(res.body.data.items.map((i) => [i.venda_id, i]));
        expect(Object.keys(porId).map(Number).sort((a, b) => a - b))
            .toEqual([V.mpOk, V.manual, V.divergente, V.misto, V.estornada].sort((a, b) => a - b));

        expect(porId[V.mpOk]).toMatchObject({ valor_pix: 15, pix_mp: 15, pix_manual: 0, origem: 'mp', percentual: 0.5, taxa: 0.08, retido: 0.08, retido_esperado: 0.08, divergencia: 0, situacao: 'ok' });
        expect(porId[V.manual]).toMatchObject({ origem: 'manual', taxa: 0.5, retido: 0, retido_esperado: 0, situacao: 'ok' });
        expect(porId[V.divergente]).toMatchObject({ origem: 'mp', retido: 0.5, retido_esperado: 1, divergencia: -0.5, situacao: 'divergente' });
        expect(porId[V.misto]).toMatchObject({ origem: 'misto', valor_pix: 100, pix_mp: 40, pix_manual: 60, retido: 0.2, retido_esperado: 0.2, situacao: 'ok' });
        expect(porId[V.estornada]).toMatchObject({ situacao: 'estornada' });
    });

    test('só o necessário: sem cliente, produto, vendedor ou total da venda', async () => {
        const res = await vendas({ competencia: '2025-08', empresa_id: A.empresaId });
        const chaves = Object.keys(res.body.data.items[0]).sort();
        expect(chaves).toEqual(['data', 'divergencia', 'origem', 'percentual', 'pix_manual', 'pix_mp', 'retido', 'retido_esperado',
            'situacao', 'taxa', 'valor_pix', 'venda_id'].sort());
    });

    test('totais só das apuradas: Pix MP × manual, retido × esperado e quantas divergem', async () => {
        const { totais } = (await vendas({ competencia: '2025-08', empresa_id: A.empresaId })).body.data;
        expect(totais).toEqual({
            qtd_vendas: 4, valor_pix: 415, pix_mp: 255, pix_manual: 160,
            taxa: 2.08, retido: 0.78, retido_esperado: 1.28, divergencia: -0.5, qtd_divergentes: 1
        });
    });

    test('filtro só divergentes e paginação', async () => {
        const div = (await vendas({ competencia: '2025-08', empresa_id: A.empresaId, somente_divergentes: 'true' })).body.data;
        expect(div.items.map((i) => i.venda_id)).toEqual([V.divergente]);
        expect(div.total).toBe(1);

        const p1 = (await vendas({ competencia: '2025-08', empresa_id: A.empresaId, limit: 2, offset: 0 })).body.data;
        const p2 = (await vendas({ competencia: '2025-08', empresa_id: A.empresaId, limit: 2, offset: 2 })).body.data;
        expect(p1.total).toBe(5);
        expect(p1.items).toHaveLength(2);
        expect(p2.items[0].venda_id).not.toBe(p1.items[1].venda_id);
    });

    test('isolamento: cada empresa só vê as próprias vendas; inexistente 404', async () => {
        const deB = (await vendas({ competencia: '2025-08', empresa_id: B.empresaId })).body.data;
        expect(deB.items).toHaveLength(1);
        expect(deB.items.some((i) => Object.values(V).includes(i.venda_id))).toBe(false);
        expect((await vendas({ competencia: '2025-08', empresa_id: 999999999 })).status).toBe(404);
    });

    test('validação: empresa obrigatória, competência, filtro e limite', async () => {
        expect((await vendas({ competencia: '2025-08' })).status).toBe(400);
        expect((await vendas({ competencia: '2025-8', empresa_id: A.empresaId })).status).toBe(400);
        expect((await vendas({ competencia: '2025-08', empresa_id: A.empresaId, somente_divergentes: 'sim' })).status).toBe(400);
        expect((await vendas({ competencia: '2025-08', empresa_id: A.empresaId, limit: 501 })).status).toBe(400);
        expect((await vendas({ competencia: '2025-08', empresa_id: A.empresaId, cliente: 'x' })).status).toBe(400);
    });

    test('sem sessão do painel ou com token do ERP: 401', async () => {
        const tokenErp = makeToken({ id: A.adminId, empresa_id: A.empresaId, papel: 'admin' });
        expect((await request(app).get(`/painel/taxas/vendas?competencia=2025-08&empresa_id=${A.empresaId}`)).status).toBe(401);
        expect((await request(app).get(`/painel/taxas/vendas?competencia=2025-08&empresa_id=${A.empresaId}`)
            .set('Authorization', `Bearer ${tokenErp}`)).status).toBe(401);
    });
});

describe('sinalização no resumo do mês', () => {
    test('a cobrança do mês mostra quantas vendas divergem e o Pix por origem', async () => {
        const res = await request(app).get('/painel/taxas/cobranca').set(operador.cabecalho)
            .query({ competencia: '2025-08', empresa_id: A.empresaId });
        expect(res.body.data.items[0]).toMatchObject({ qtd_divergencias: 1, pix_mp: 255, pix_manual: 160 });
    });
});

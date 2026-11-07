// Integração (Postgres de testes): GET /consumos/indicadores. Saldo do Central, consumo avulso do período,
// cobertura, reposição, RBAC (custo só com ver_custos) e isolamento entre empresas.
jest.setTimeout(60000);
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const A = { u: {} };
const B = { u: {} };
const ids = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Indic Insumos ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.centralId = (await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING RETURNING id`, [alvo.empresaId]
    )).rows[0]?.id ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0].id;
    for (const papel of ['admin', 'vendedor', 'estoquista', 'gerente', 'analista', 'supervisor']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
}

async function criarInsumo(alvo, { sku, nome, saldo, minimo, custo, tipo = 'insumo' }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, estoque_atual, estoque_minimo, tipo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [alvo.empresaId, sku, nome, custo, saldo, minimo, tipo]
    );
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [rows[0].id, alvo.centralId, alvo.empresaId, saldo]);
    return rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    ids.giro = await criarInsumo(A, { sku: 'EMB-1', nome: 'Embalagem', saldo: 100, minimo: 10, custo: 2 });
    ids.baixo = await criarInsumo(A, { sku: 'ETQ-1', nome: 'Etiqueta', saldo: 5, minimo: 10, custo: 1 });
    ids.zerado = await criarInsumo(A, { sku: 'MAT-1', nome: 'Material', saldo: 0, minimo: 3, custo: 1 });
    ids.parado = await criarInsumo(A, { sku: 'EMB-2', nome: 'Embalagem parada', saldo: 50, minimo: 0, custo: 1 });
    ids.acabado = await criarInsumo(A, { sku: 'ANE-1', nome: 'Anel', saldo: 9, minimo: 0, custo: 1, tipo: 'acabado' });
    ids.deB = await criarInsumo(B, { sku: 'EMB-X', nome: 'Embalagem de B', saldo: 7, minimo: 0, custo: 1 });

    const avulso = await request(app).post('/consumos/avulsos').set(como(A, 'admin'))
        .send({ produto_id: ids.giro, quantidade: 30, motivo: 'perda' });
    expect(avulso.status).toBe(201);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /consumos/indicadores', () => {
    test('vendedor 403; estoquista e admin 200; outras rotas de /consumos seguem só admin/estoquista', async () => {
        expect((await get(A, 'vendedor', '/consumos/indicadores')).status).toBe(403);
        expect((await get(A, 'estoquista', '/consumos/indicadores')).status).toBe(200);
        expect((await get(A, 'admin', '/consumos/indicadores')).status).toBe(200);
    });

    test('só insumos ativos da própria empresa; consumo, cobertura e reposição', async () => {
        const res = await get(A, 'admin', '/consumos/indicadores?dias=90');

        expect(res.status).toBe(200);
        const porSku = Object.fromEntries(res.body.data.insumos.map((i) => [i.sku, i]));
        expect(Object.keys(porSku).sort()).toEqual(['EMB-1', 'EMB-2', 'ETQ-1', 'MAT-1']);

        // saldo 100 - 30 consumidos = 70; 30 em 90 dias -> cobertura 70 / (30 / 90) = 210
        expect(porSku['EMB-1']).toMatchObject({ saldo: 70, consumo_periodo: 30, cobertura_dias: 210, repor: false });
        expect(porSku['ETQ-1']).toMatchObject({ saldo: 5, repor: true, motivos_reposicao: ['abaixo_minimo'], para_atingir_minimo: 5 });
        expect(porSku['MAT-1']).toMatchObject({ saldo: 0, repor: true, motivos_reposicao: ['esgotado'], para_atingir_minimo: 3 });
        expect(porSku['EMB-2']).toMatchObject({ consumo_periodo: 0, cobertura_dias: null, repor: false });

        expect(res.body.data.totais).toMatchObject({
            insumos_ativos: 4, esgotados: 1, abaixo_minimo: 1, a_repor: 2, sem_consumo_no_periodo: 3, consumo_total_periodo: 30
        });
    });

    test('gerente, analista e supervisor (ver_dashboard/ver_custos) leem os indicadores, mas não o resto de /consumos', async () => {
        for (const papel of ['gerente', 'analista', 'supervisor']) {
            expect((await get(A, papel, '/consumos/indicadores')).status).toBe(200);
            expect((await get(A, papel, '/consumos/insumos')).status).toBe(403);
            expect((await get(A, papel, '/consumos/relatorio')).status).toBe(403);
        }
    });

    test('custo: gerente (ver_custos) vê; analista e supervisor (só ver_dashboard) não', async () => {
        expect((await get(A, 'gerente', '/consumos/indicadores')).body.data.totais.custo_consumo_periodo).toBe(60);
        expect((await get(A, 'analista', '/consumos/indicadores')).body.data.totais).not.toHaveProperty('custo_consumo_periodo');
        expect((await get(A, 'supervisor', '/consumos/indicadores')).body.data.totais).not.toHaveProperty('custo_consumo_periodo');
    });

    test('custo do consumo só aparece com ver_custos (admin sim, estoquista não)', async () => {
        const admin = await get(A, 'admin', '/consumos/indicadores');
        const estoquista = await get(A, 'estoquista', '/consumos/indicadores');

        expect(admin.body.data.totais.custo_consumo_periodo).toBe(60); // 30 un. x R$ 2,00
        expect(admin.body.data.insumos.find((i) => i.sku === 'EMB-1').custo_consumo_periodo).toBe(60);
        expect(estoquista.body.data.totais).not.toHaveProperty('custo_consumo_periodo');
        expect(estoquista.body.data.insumos[0]).not.toHaveProperty('custo_consumo_periodo');
    });

    test('isolamento: empresa B vê só o próprio insumo, sem o consumo de A', async () => {
        const res = await get(B, 'admin', '/consumos/indicadores');

        expect(res.body.data.insumos.map((i) => i.sku)).toEqual(['EMB-X']);
        expect(res.body.data.totais.consumo_total_periodo).toBe(0);
    });

    test('período inválido é 400', async () => {
        expect((await get(A, 'admin', '/consumos/indicadores?dias=0')).status).toBe(400);
        expect((await get(A, 'admin', '/consumos/indicadores?dias=400')).status).toBe(400);
        expect((await get(A, 'admin', '/consumos/indicadores?dias=abc')).status).toBe(400);
    });
});

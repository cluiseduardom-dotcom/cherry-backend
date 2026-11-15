// Integração: ciclo de cobrança da taxa (etapa 5, parte 1 — só leitura). Períodos reais fechados pela API, saldo
// do banco, regra aplicada em datas fixas (o serviço aceita `hoje`); a rota usa um mês bem antigo para não depender do relógio.
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
const { avaliarEmpresas } = require('../../src/services/cicloCobrancaService');
const { hojeSP } = require('../../src/utils/dataSaoPaulo');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);

let operador;
let politica;
const A = {}; // R$ 25,00 em 2025-10 (vence 05/11/2025)
const B = {}; // R$ 6,00 em 2025-10: abaixo do piso
const C = {}; // R$ 25,00 já quitado
const D = {}; // R$ 25,00 em 2025-02: muito atrasado (para a rota, que usa o relógio real)

async function criarEmpresa(alvo, rotulo, competencia, taxa) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Ciclo ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.nome = `Teste Ciclo ${rotulo} ${sufixo}`;
    const canal = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'Loja', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.adminId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.empresaId, `admin ${sufixo}`, `admin-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH]
    )).rows[0].id;
    const venda = (await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, total, status, data)
         VALUES ($1, $2, 1000, 'finalizada', ($3::timestamptz) AT TIME ZONE current_setting('TimeZone')) RETURNING id`,
        [alvo.empresaId, canal, `${competencia}-10T15:00:00Z`]
    )).rows[0].id;
    await db.query(
        `INSERT INTO taxas_venda (venda_id, empresa_id, politica_id, plano_id, origem, tipo, percentual, base_calculo, valor, status)
         VALUES ($1, $2, $3, $4, 'padrao_sem_plano', 'percentual', 0.5, 1000, $5, 'apurada')`,
        [venda, alvo.empresaId, politica.id, politica.plano_id, taxa]
    );
    const res = await request(app).post('/painel/taxas/periodos/fechar').set(operador.cabecalho).send({ competencia, empresa_id: alvo.empresaId });
    alvo.periodoId = res.body.data.items[0].periodo_id;
}

const daLoja = (resultado, alvo) => resultado.items.find((i) => i.empresa_id === alvo.empresaId);

async function removerTrilhaDasEmpresas(ids) {
    const c = await db.connect();
    try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL vertumno.limpeza_teste = 'on'`);
        await c.query('DELETE FROM plataforma_eventos WHERE alvo_empresa_id = ANY($1::int[])', [ids]);
        await c.query('COMMIT');
    } catch (erro) {
        await c.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        c.release();
    }
}

beforeAll(async () => {
    operador = await criarOperadorComSessao('ciclo');
    politica = (await db.query('SELECT id, plano_id FROM politicas_taxa_plataforma ORDER BY id LIMIT 1')).rows[0];
    await criarEmpresa(A, 'A', '2025-10', 25);
    await criarEmpresa(B, 'B', '2025-10', 6);
    await criarEmpresa(C, 'C', '2025-10', 25);
    await criarEmpresa(D, 'D', '2025-02', 25);

    await request(app).post(`/painel/taxas/periodos/${C.periodoId}/pagamentos`).set(operador.cabecalho)
        .send({ valor: 25, data_pagamento: hojeSP(), forma_pagamento: 'pix' });
});

afterAll(async () => {
    try {
        await removerTrilhaDasEmpresas(registro.ids());
        await registro.limpar();
        await removerOperador(operador);
    } finally {
        await db.end();
    }
});

describe('ciclo de cobrança por loja (serviço, datas fixas)', () => {
    test('linha do tempo de um período de R$ 25,00: a vencer → vencido → aviso → suspensão devida', async () => {
        const ate = async (hoje) => daLoja(await avaliarEmpresas({ hoje }), A);

        expect(await ate('2025-11-04')).toMatchObject({ estagio: 'a_vencer', lembrete: true, saldo_a_vencer: 25, saldo_vencido: 0 });
        expect(await ate('2025-11-05')).toMatchObject({ estagio: 'a_vencer' });
        expect(await ate('2025-11-06')).toMatchObject({ estagio: 'vencido', saldo_vencido: 25, aviso: false, suspender: false });
        expect(await ate('2025-11-15')).toMatchObject({ estagio: 'aviso_suspensao', aviso: true, suspender: false });
        expect(await ate('2025-11-20')).toMatchObject({ estagio: 'aviso_suspensao', suspender: false });
        expect(await ate('2025-11-21')).toMatchObject({ estagio: 'suspensao_devida', suspender: true });
    });

    test('abaixo do piso (R$ 6,00): acumula, sem cobrar, avisar nem suspender, mesmo muito depois', async () => {
        const b = daLoja(await avaliarEmpresas({ hoje: '2025-12-30' }), B);
        expect(b).toMatchObject({ estagio: 'abaixo_do_piso', cobravel: false, aviso: false, suspender: false, saldo_vencido: 6 });
    });

    test('loja quitada não aparece; pagamento parcial reduz o saldo e pode levar ao piso', async () => {
        expect(daLoja(await avaliarEmpresas({ hoje: '2025-11-25' }), C)).toBeUndefined();

        const pago = await request(app).post(`/painel/taxas/periodos/${A.periodoId}/pagamentos`).set(operador.cabecalho)
            .send({ valor: 20, data_pagamento: hojeSP(), forma_pagamento: 'pix' });
        expect(pago.status).toBe(201);
        // Sobraram R$ 5,00 (< piso): sai da suspensão, vira "abaixo do piso".
        expect(daLoja(await avaliarEmpresas({ hoje: '2025-11-25' }), A)).toMatchObject({ estagio: 'abaixo_do_piso', saldo_vencido: 5, suspender: false });
    });

    test('carência e piso vêm do ambiente (único lugar)', async () => {
        const curta = await avaliarEmpresas({ hoje: '2025-11-11', env: { COBRANCA_CARENCIA_DIAS: '5', COBRANCA_PISO: '3' } });
        expect(curta.config).toMatchObject({ carencia_dias: 5, piso: 3 });
        expect(daLoja(curta, B)).toMatchObject({ estagio: 'suspensao_devida' });
    });

    test('ordem: o que exige ação vem primeiro; totais por estágio', async () => {
        const r = await avaliarEmpresas({ hoje: '2025-11-25' });
        const nossas = r.items.filter((i) => [A, B, D].some((x) => x.empresaId === i.empresa_id));
        expect(nossas[0].empresa_id).toBe(D.empresaId); // suspensão devida antes de "abaixo do piso"
        expect(r.totais.suspensao_devida).toBeGreaterThanOrEqual(1);
        expect(r.totais.lojas).toBe(r.items.length);
    });
});

describe('GET /painel/taxas/ciclo', () => {
    test('responde com a configuração e as lojas (mês antigo: suspensão devida independente do relógio)', async () => {
        const res = await request(app).get('/painel/taxas/ciclo').set(operador.cabecalho);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.data.config).toMatchObject({ carencia_dias: 15, piso: 10, antecedencia_aviso_dias: 5, periodos_abaixo_do_piso: 3 });
        expect(res.body.data.hoje).toBe(hojeSP());

        const d = daLoja(res.body.data, D);
        expect(d).toMatchObject({ empresa_nome: D.nome, estagio: 'suspensao_devida', suspender: true, saldo_vencido: 25, competencia_mais_antiga: '2025-02' });
        expect(d.periodos).toEqual([{ periodo_id: D.periodoId, competencia: '2025-02', vencimento: '2025-03-05', saldo: 25 }]);
    });

    test('sem sessão do painel ou com token do ERP: 401', async () => {
        const tokenErp = makeToken({ id: A.adminId, empresa_id: A.empresaId, papel: 'admin' });
        expect((await request(app).get('/painel/taxas/ciclo')).status).toBe(401);
        expect((await request(app).get('/painel/taxas/ciclo').set('Authorization', `Bearer ${tokenErp}`)).status).toBe(401);
    });
});

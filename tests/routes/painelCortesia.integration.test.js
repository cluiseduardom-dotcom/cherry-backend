// Integração de verdade (Postgres): a Cortesia acaba sozinha no 3º mês. Atribuir a Cortesia grava também o
// sucessor (Básico) no dia seguinte ao fim; a GiroNex pode substituir o sucessor pelo plano negociado; a
// empresa nunca fica sem plano em silêncio.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
let operador;

const trocar = (empresa, corpo) => request(app).post(`/painel/empresas/${empresa}/plano`).set(operador.cabecalho).send(corpo);
const novaEmpresa = async (rotulo) => registro.registrar((await db.query(
    `INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Cortesia ${rotulo} ${sufixo}`])).rows[0].id);
const linhas = async (empresa) => (await db.query(
    `SELECT p.codigo, ep.vigencia_inicio::text AS ini, ep.vigencia_fim::text AS fim, ep.ativo, ep.sucessor_automatico AS auto
     FROM empresa_planos ep JOIN planos_comerciais p ON p.id = ep.plano_id WHERE ep.empresa_id = $1 ORDER BY ep.id`, [empresa])).rows;
const sql = async (q, p = []) => (await db.query(q, p)).rows[0].v;
const HOJE = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

beforeAll(async () => {
    operador = await criarOperadorComSessao('cortesia');
});

afterAll(async () => {
    try {
        await removerOperador(operador);
        await registro.limpar();
    } finally {
        await db.end();
    }
});

test('Cortesia dura 3 meses e já agenda o Básico no dia seguinte', async () => {
    const e = await novaEmpresa('a');
    const res = await trocar(e, { plano: 'cortesia', justificativa: 'conquista de cliente' });
    expect(res.status).toBe(201);

    const fimEsperado = await sql(`SELECT (${HOJE} + INTERVAL '3 months' - INTERVAL '1 day')::date::text AS v`);
    const sucessorEsperado = await sql(`SELECT (${HOJE} + INTERVAL '3 months')::date::text AS v`);

    expect(res.body.data.vigencia_fim).toBe(fimEsperado);
    expect(res.body.data.sucessor_automatico).toMatchObject({ plano_codigo: 'basico', vigencia_inicio: sucessorEsperado });

    expect(await linhas(e)).toEqual([
        { codigo: 'cortesia', ini: await sql(`SELECT ${HOJE}::text AS v`), fim: fimEsperado, ativo: true, auto: false },
        { codigo: 'basico', ini: sucessorEsperado, fim: null, ativo: true, auto: true }
    ]);
});

test('plano negociado durante a Cortesia substitui o sucessor sem erro de "plano agendado"', async () => {
    const e = await novaEmpresa('b');
    expect((await trocar(e, { plano: 'cortesia', justificativa: 'início' })).status).toBe(201);

    const amanha = await sql(`SELECT (${HOJE} + 1)::text AS v`);
    const res = await trocar(e, { plano: 'padrao', vigencia_inicio: amanha, justificativa: 'negociação fechada no Padrão' });
    expect(res.status).toBe(201);

    const hoje = await sql(`SELECT ${HOJE}::text AS v`);
    expect(await linhas(e)).toEqual([
        { codigo: 'cortesia', ini: hoje, fim: hoje, ativo: true, auto: false },
        { codigo: 'basico', ini: await sql(`SELECT (${HOJE} + INTERVAL '3 months')::date::text AS v`), fim: null, ativo: false, auto: true },
        { codigo: 'padrao', ini: amanha, fim: null, ativo: true, auto: false }
    ]);

    const { rows } = await db.query(`SELECT motivo_encerramento FROM empresa_planos WHERE empresa_id = $1 AND sucessor_automatico`, [e]);
    expect(rows[0].motivo_encerramento).toMatch(/Sucessor automático da Cortesia substituído/);
});

test('plano agendado que NÃO é o sucessor automático continua barrando nova troca', async () => {
    const e = await novaEmpresa('c');
    expect((await trocar(e, { plano: 'basico', justificativa: 'início' })).status).toBe(201);
    const futuro = await sql(`SELECT (${HOJE} + 10)::text AS v`);
    expect((await trocar(e, { plano: 'padrao', vigencia_inicio: futuro, justificativa: 'agendado' })).status).toBe(201);
    expect((await trocar(e, { plano: 'pro', vigencia_inicio: await sql(`SELECT (${HOJE} + 5)::text AS v`), justificativa: 'outro' })).status).toBe(409);
});

test('planos que não são Cortesia seguem sem prazo nem sucessor', async () => {
    const e = await novaEmpresa('d');
    const res = await trocar(e, { plano: 'padrao', justificativa: 'direto no Padrão' });
    expect(res.status).toBe(201);
    expect(res.body.data.vigencia_fim).toBeNull();
    expect(res.body.data.sucessor_automatico).toBeUndefined();
    expect(await linhas(e)).toHaveLength(1);
});

test('depois do fim da Cortesia a resolução enxerga o Básico (limite 3), não o padrão sem limite', async () => {
    const e = await novaEmpresa('e');
    // Histórico imutável e API sem início no passado: monta direto a situação de 4 meses depois.
    await db.query(
        `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, vigencia_fim, justificativa, responsavel, sucessor_automatico)
         SELECT $1, id, ${HOJE} - 120, ${HOJE} - 30, 'teste', 'teste', false FROM planos_comerciais WHERE codigo = 'cortesia'`, [e]);
    await db.query(
        `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel, sucessor_automatico)
         SELECT $1, id, ${HOJE} - 29, 'teste', 'teste', true FROM planos_comerciais WHERE codigo = 'basico'`, [e]);

    const limiteRepo = require('../../src/repositories/limiteUsuariosRepository');
    expect(await limiteRepo.buscarLimite(db, e)).toEqual({ plano: 'basico', limite: 3 });
});

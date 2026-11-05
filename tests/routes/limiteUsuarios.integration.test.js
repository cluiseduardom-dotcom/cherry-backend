// Integração de verdade (Postgres de testes): limite de usuários ativos por plano, extras e exceção ilimitada,
// na criação e no desbloqueio. Empresas próprias e temporárias; remove tudo no fim.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(10).toString('hex');

const inserir = async (sql, params) => (await db.query(sql, params)).rows[0].id;

async function criarEmpresa(rotulo, planoCodigo) {
    const id = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Limite Usuarios ${rotulo} ${sufixo}`]));
    const admin = await inserir(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`,
        [id, `adm-${rotulo}-${sufixo}@teste.invalid`]
    );
    if (planoCodigo) {
        await db.query(
            `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel)
             SELECT $1, id, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date, 'teste', 'teste' FROM planos_comerciais WHERE codigo = $2`,
            [id, planoCodigo]
        );
    }
    return { id, admin, token: makeToken({ id: admin, role: 'admin', empresa_id: id, tv: 0 }) };
}

const criarUsuario = (E, n) => request(app).post('/usuarios').set('Authorization', `Bearer ${E.token}`).send({
    nome: `Vend ${n}`, email: `v${n}-${E.id}-${sufixo}@teste.invalid`, senha: SENHA, papel: 'vendedor', telefone: '(11) 91234-5678'
});
const bloquear = (E, usuarioId, bloqueado) => request(app).patch(`/usuarios/${usuarioId}/bloqueio`).set('Authorization', `Bearer ${E.token}`).send({ bloqueado, motivo: 'teste' });
const ativos = async (E) => (await db.query('SELECT COUNT(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND ativo = true', [E.id])).rows[0].n;
const ligarCargoVendedor = (E) => db.query(
    `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, 'vendedor', 1, true, '{}')
     ON CONFLICT (empresa_id, cargo) DO UPDATE SET ativo = true`, [E.id]);

let basico; let padrao; let semPlano;

beforeAll(async () => {
    basico = await criarEmpresa('basico', 'basico');
    padrao = await criarEmpresa('padrao', 'padrao');
    semPlano = await criarEmpresa('semplano', null);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

test('seed: Cortesia/Básico 3, Padrão 7, Pro 15, legados sem limite', async () => {
    const { rows } = await db.query(`SELECT codigo, limite_usuarios FROM planos_comerciais WHERE codigo = ANY($1) ORDER BY codigo`,
        [['cortesia', 'basico', 'padrao', 'pro', 'sem_mensalidade', 'com_mensalidade']]);
    expect(Object.fromEntries(rows.map((r) => [r.codigo, r.limite_usuarios]))).toEqual({
        com_mensalidade: null, cortesia: 3, basico: 3, padrao: 7, pro: 15, sem_mensalidade: null
    });
});

describe('plano Básico (limite 3, com o admin contando)', () => {
    const criados = [];

    test('cabem mais 2; o terceiro novo é barrado com 409 e nada é criado', async () => {
        await ligarCargoVendedor(basico);
        for (const n of [1, 2]) {
            const res = await criarUsuario(basico, n);
            expect(res.status).toBe(201);
            criados.push(res.body.data.usuario.id);
        }
        const barrado = await criarUsuario(basico, 3);
        expect(barrado.status).toBe(409);
        expect(barrado.body.message).toMatch(/Limite de 3 usuários/);
        expect(await ativos(basico)).toBe(3);
    });

    test('corrida: duas criações simultâneas com 1 vaga resultam em exatamente 1', async () => {
        await db.query('UPDATE usuarios SET ativo = false WHERE id = $1', [criados[1]]);
        const [a, b] = await Promise.all([criarUsuario(basico, 10), criarUsuario(basico, 11)]);
        expect([a.status, b.status].sort()).toEqual([201, 409]);
        expect(await ativos(basico)).toBe(3);
    });

    test('desbloquear sem vaga dá 409; bloquear é sempre possível e libera a vaga', async () => {
        const res = await bloquear(basico, criados[1], false);
        expect(res.status).toBe(409);
        expect((await bloquear(basico, criados[0], true)).status).toBe(200);
        expect((await bloquear(basico, criados[1], false)).status).toBe(200);
        expect(await ativos(basico)).toBe(3);
    });

    test('extras somam ao limite do plano; ilimitado libera de vez', async () => {
        await db.query(`INSERT INTO empresa_limites_usuarios (empresa_id, usuarios_extras, justificativa, responsavel) VALUES ($1, 2, 'teste', 'teste')`, [basico.id]);
        const ate = await ativos(basico);
        let criadosAgora = 0;
        for (let n = 20; n < 30; n += 1) {
            const res = await criarUsuario(basico, n);
            if (res.status === 201) criadosAgora += 1; else { expect(res.status).toBe(409); break; }
        }
        expect(ate + criadosAgora).toBe(5);

        await db.query(`UPDATE empresa_limites_usuarios SET ilimitado = true WHERE empresa_id = $1`, [basico.id]);
        expect((await criarUsuario(basico, 40)).status).toBe(201);
    });
});

test('plano Padrão: limite 7', async () => {
    await ligarCargoVendedor(padrao);
    for (let n = 1; n <= 6; n += 1) expect((await criarUsuario(padrao, n)).status).toBe(201);
    const res = await criarUsuario(padrao, 7);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Limite de 7 usuários/);
});

test('empresa sem plano (padrão sem_mensalidade) não tem limite', async () => {
    await ligarCargoVendedor(semPlano);
    for (let n = 1; n <= 9; n += 1) expect((await criarUsuario(semPlano, n)).status).toBe(201);
});

test('limite é por empresa: lotar o Básico não afeta o Padrão', async () => {
    expect(await ativos(padrao)).toBe(7);
    expect((await criarUsuario(basico, 99)).status).toBe(201);
});

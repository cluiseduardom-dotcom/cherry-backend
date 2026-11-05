// Integração de verdade (Postgres): limite de usuários por empresa operado pelo Painel GiroNex. Prova acesso só por
// sessão do painel, justificativa obrigatória, extras/ilimitado, remoção, trilha com antes/depois e efeito real
// na criação de usuário do ERP.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
let operador;
let E;

const url = (empresa) => `/painel/empresas/${empresa}/limite-usuarios`;
const get = (empresa) => request(app).get(url(empresa)).set(operador.cabecalho);
const put = (empresa, corpo) => request(app).put(url(empresa)).set(operador.cabecalho).send(corpo);
const del = (empresa, corpo) => request(app).delete(url(empresa)).set(operador.cabecalho).send(corpo);
const criarNoErp = (n) => request(app).post('/usuarios').set('Authorization', `Bearer ${makeToken({ id: E.usuario, role: 'admin', empresa_id: E.id, tv: 0 })}`).send({
    nome: `Vend ${n}`, email: `v${n}-${sufixo}@teste.invalid`, senha: 'senha-teste-123', papel: 'vendedor', telefone: '(11) 91234-5678'
});
const eventos = async () => (await db.query(
    `SELECT acao, detalhe FROM plataforma_eventos WHERE alvo_empresa_id = $1 AND acao LIKE 'limite_usuarios%' ORDER BY id`, [E.id])).rows;

beforeAll(async () => {
    operador = await criarOperadorComSessao('limuser');
    const id = registro.registrar((await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Painel Limite ${sufixo}`])).rows[0].id);
    const usuario = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`,
        [id, `painel-lim-${sufixo}@teste.invalid`])).rows[0].id;
    await db.query(
        `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel)
         SELECT $1, id, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date, 'teste', 'teste' FROM planos_comerciais WHERE codigo = 'cortesia'`, [id]);
    await db.query(
        `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, 'vendedor', 1, true, '{}')`, [id]);
    E = { id, usuario };
});

afterAll(async () => {
    try {
        await removerOperador(operador);
        await registro.limpar();
    } finally {
        await db.end();
    }
});

test('acesso: sem sessão do painel 401; token do ERP não abre; empresa inexistente 404; id inválido 400', async () => {
    expect((await request(app).get(url(E.id))).status).toBe(401);
    const tokenErp = makeToken({ id: E.usuario, role: 'admin', empresa_id: E.id, tv: 0 });
    expect((await request(app).get(url(E.id)).set('Authorization', `Bearer ${tokenErp}`)).status).toBe(401);
    expect((await get(999999999)).status).toBe(404);
    expect((await get('abc')).status).toBe(400);
});

test('situação inicial: plano Cortesia, limite 3, 1 ativo, sem configuração', async () => {
    const res = await get(E.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ plano: 'cortesia', limite_plano: 3, limite_efetivo: 3, usuarios_ativos: 1, configuracao: null });
});

test('justificativa e campos são obrigatórios e validados', async () => {
    expect((await put(E.id, { usuarios_extras: 1, ilimitado: false })).status).toBe(400);
    expect((await put(E.id, { usuarios_extras: -1, ilimitado: false, justificativa: 'x' })).status).toBe(400);
    expect((await put(E.id, { usuarios_extras: 1.5, ilimitado: false, justificativa: 'x' })).status).toBe(400);
    expect((await put(E.id, { usuarios_extras: 1, justificativa: 'x' })).status).toBe(400);
    expect((await put(E.id, { usuarios_extras: 1, ilimitado: false, justificativa: 'x', empresa_id: 2 })).status).toBe(400);
    expect((await del(E.id, {})).status).toBe(400);
    expect(await eventos()).toHaveLength(0);
});

test('extras somam ao plano e valem de imediato na criação de usuário do ERP; trilha guarda antes e depois', async () => {
    expect((await criarNoErp(1)).status).toBe(201);
    expect((await criarNoErp(2)).status).toBe(201);
    expect((await criarNoErp(3)).status).toBe(409);

    const res = await put(E.id, { usuarios_extras: 2, ilimitado: false, justificativa: 'cliente contratou 2 extras' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ limite_efetivo: 5, usuarios_ativos: 3 });
    expect(res.body.data.configuracao).toMatchObject({ usuarios_extras: 2, ilimitado: false });

    expect((await criarNoErp(3)).status).toBe(201);
    expect((await criarNoErp(4)).status).toBe(201);
    expect((await criarNoErp(5)).status).toBe(409);

    const trilha = await eventos();
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({ acao: 'limite_usuarios_definido' });
    expect(trilha[0].detalhe).toMatchObject({ limite_antes: 3, limite_depois: 5, usuarios_extras: 2 });
});

test('ilimitado libera de vez; remover volta ao plano sem derrubar ninguém', async () => {
    const lib = await put(E.id, { usuarios_extras: 0, ilimitado: true, justificativa: 'exceção negociada' });
    expect(lib.body.data.limite_efetivo).toBeNull();
    expect((await criarNoErp(5)).status).toBe(201);

    const rem = await del(E.id, { justificativa: 'fim da exceção' });
    expect(rem.status).toBe(200);
    expect(rem.body.data).toMatchObject({ limite_efetivo: 3, usuarios_ativos: 6, configuracao: null });
    expect((await criarNoErp(6)).status).toBe(409);

    expect((await del(E.id, { justificativa: 'de novo' })).status).toBe(404);
    expect((await eventos()).map((e) => e.acao)).toEqual(['limite_usuarios_definido', 'limite_usuarios_definido', 'limite_usuarios_removido']);
});

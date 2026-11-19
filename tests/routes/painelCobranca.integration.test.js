// Integração de verdade (Postgres): teste grátis de 30 dias, pagamento manual, isenção e desligamento, operados pelo Painel
// GiroNex. Prova acesso só por sessão do painel, justificativa obrigatória, a derivação das situações, o efeito real no ERP
// (somente leitura barra gravação, consulta segue, desligada perde o login) e a trilha com antes/depois.
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
const HOJE = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
let operador;
let E;
let contador = 0;

const url = (empresa, resto = 'cobranca') => `/painel/empresas/${empresa}/${resto}`;
const get = (empresa) => request(app).get(url(empresa)).set(operador.cabecalho);
const post = (empresa, resto, corpo) => request(app).post(url(empresa, resto)).set(operador.cabecalho).send(corpo);
const tokenErp = () => makeToken({ id: E.usuario, role: 'admin', empresa_id: E.id, tv: 0 });
const erp = (metodo, caminho) => request(app)[metodo](caminho).set('Authorization', `Bearer ${tokenErp()}`);
const criarNoErp = () => {
    contador += 1;
    return erp('post', '/usuarios').send({
        nome: `Vend ${contador}`, email: `cob${contador}-${sufixo}@teste.invalid`, senha: 'senha-teste-123', papel: 'vendedor', telefone: '(11) 91234-5678'
    });
};
const eventos = async () => (await db.query(
    `SELECT acao, detalhe FROM plataforma_eventos WHERE alvo_empresa_id = $1 AND (acao LIKE 'cobranca_%' OR acao LIKE 'empresa_%') ORDER BY id`, [E.id])).rows;
const sql = (texto, params = []) => db.query(texto, params);
const dia = async (expr) => (await sql(`SELECT (${expr})::text AS d`)).rows[0].d;

beforeAll(async () => {
    operador = await criarOperadorComSessao('cobranca');
    const id = registro.registrar((await sql(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Painel Cobranca ${sufixo}`])).rows[0].id);
    const usuario = (await sql(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`,
        [id, `painel-cob-${sufixo}@teste.invalid`])).rows[0].id;
    await sql(
        `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel)
         SELECT $1, id, ${HOJE}, 'teste', 'teste' FROM planos_comerciais WHERE codigo = 'padrao'`, [id]);
    await sql(`INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, 'vendedor', 1, true, '{}')`, [id]);
    // Sem limite de usuários: este teste cria vários vendedores e não quer esbarrar no limite do Padrão.
    await sql(`INSERT INTO empresa_limites_usuarios (empresa_id, ilimitado, justificativa, responsavel) VALUES ($1, true, 'teste', 'teste')`, [id]);
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
    expect((await request(app).get(url(E.id)).set('Authorization', `Bearer ${tokenErp()}`)).status).toBe(401);
    expect((await request(app).post(url(E.id, 'cobranca/teste')).send({ justificativa: 'x ok' })).status).toBe(401);
    expect((await get(999999999)).status).toBe(404);
    expect((await get('abc')).status).toBe(400);
});

test('empresa sem regra (como as que já existiam): situação sem_regra e o ERP nunca é restrito', async () => {
    const res = await get(E.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ situacao: 'sem_regra', ate: null, isenta: false, empresa_status: 'ativa' });

    expect((await erp('get', '/auth/me')).body.data.cobranca).toBeNull();
    expect((await criarNoErp()).status).toBe(201);
});

test('justificativa é obrigatória e os campos são validados; nada é gravado nem registrado', async () => {
    expect((await post(E.id, 'cobranca/teste', {})).status).toBe(400);
    expect((await post(E.id, 'cobranca/teste', { justificativa: 'ok!', dias: 0 })).status).toBe(400);
    expect((await post(E.id, 'cobranca/teste', { justificativa: 'ok!', dias: 91 })).status).toBe(400);
    expect((await post(E.id, 'cobranca/teste', { justificativa: 'ok!', dias: 1.5 })).status).toBe(400);
    expect((await post(E.id, 'cobranca/teste', { justificativa: 'ok!', empresa_id: 2 })).status).toBe(400);
    expect((await post(E.id, 'cobranca/pagamento', { justificativa: 'ok!' })).status).toBe(400);
    expect((await post(E.id, 'cobranca/pagamento', { justificativa: 'ok!', pago_ate: '2026-02-30' })).status).toBe(400);
    expect((await post(E.id, 'cobranca/isencao', {})).status).toBe(400);
    expect((await post(E.id, 'desligar', {})).status).toBe(400);
    expect((await get(E.id)).body.data.situacao).toBe('sem_regra');
    expect(await eventos()).toHaveLength(0);
});

test('teste grátis: 30 dias a partir de hoje (último dia grátis = hoje + 29), uso normal, taxa e plano intactos', async () => {
    const res = await post(E.id, 'cobranca/teste', { justificativa: 'Cliente escolheu o Padrão' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ situacao: 'em_teste', isenta: false, trial_inicio: await dia(HOJE), trial_fim: await dia(`${HOJE} + 29`), ate: await dia(`${HOJE} + 29`) });

    expect((await erp('get', '/auth/me')).body.data.cobranca).toEqual({ situacao: 'em_teste', ate: await dia(`${HOJE} + 29`) });
    expect((await criarNoErp()).status).toBe(201);
    expect((await get(E.id)).body.data.situacao).toBe('em_teste');
});

test('o teste só começa uma vez por empresa (anti-abuso): repetir dá 409 e não muda as datas', async () => {
    const antes = (await get(E.id)).body.data;
    const res = await post(E.id, 'cobranca/teste', { justificativa: 'de novo' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/já foi iniciado/);
    expect((await get(E.id)).body.data).toMatchObject({ trial_inicio: antes.trial_inicio, trial_fim: antes.trial_fim });
});

test('teste vencido e sem pagamento: somente leitura. Consulta e exporta, não grava; sessão continua viva', async () => {
    await sql(`UPDATE empresa_cobranca SET trial_inicio = ${HOJE} - 30, trial_fim = ${HOJE} - 1 WHERE empresa_id = $1`, [E.id]);

    expect((await get(E.id)).body.data).toMatchObject({ situacao: 'somente_leitura', ate: null });
    expect((await erp('get', '/auth/me')).body.data.cobranca).toEqual({ situacao: 'somente_leitura', ate: null });
    expect((await erp('get', '/usuarios')).status).toBe(200);

    const barrado = await criarNoErp();
    expect(barrado.status).toBe(403);
    expect(barrado.body.message).toMatch(/somente para consulta/);
    for (const metodo of ['put', 'patch', 'delete']) {
        expect((await erp(metodo, '/usuarios/1')).status).toBe(403);
    }
    expect((await erp('post', '/auth/register')).status).toBe(403);

    // A sessão não morre: renovar o token e trocar a própria senha passam do portão (a resposta final é do controller).
    expect((await erp('post', '/auth/renovar')).status).not.toBe(403);
    expect((await erp('post', '/auth/senha').send({})).status).not.toBe(403);
});

test('pagamento manual: data no passado ou muito à frente é recusada; data válida liga a cobrança (ativa)', async () => {
    expect((await post(E.id, 'cobranca/pagamento', { justificativa: 'Pix recebido', pago_ate: await dia(`${HOJE} - 1`) })).status).toBe(400);
    expect((await post(E.id, 'cobranca/pagamento', { justificativa: 'Pix recebido', pago_ate: await dia(`${HOJE} + 401`) })).status).toBe(400);
    expect((await get(E.id)).body.data.situacao).toBe('somente_leitura');

    const ate = await dia(`${HOJE} + 30`);
    const res = await post(E.id, 'cobranca/pagamento', { justificativa: 'Pix recebido em 19/11', pago_ate: ate });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ situacao: 'ativa', pago_ate: ate, ate });
    expect((await criarNoErp()).status).toBe(201);
});

test('pagamento vencido volta a somente leitura sozinho (a situação é derivada das datas, não gravada)', async () => {
    await sql(`UPDATE empresa_cobranca SET pago_ate = ${HOJE} - 1 WHERE empresa_id = $1`, [E.id]);
    expect((await get(E.id)).body.data.situacao).toBe('somente_leitura');
    expect((await criarNoErp()).status).toBe(403);
});

test('isenção: vale para sempre e independe das datas; pagamento e teste não se aplicam a isenta', async () => {
    const res = await post(E.id, 'cobranca/isencao', { justificativa: 'Família, sem cobrança' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ situacao: 'isenta', isenta: true, ate: null });

    expect((await post(E.id, 'cobranca/isencao', { justificativa: 'de novo' })).status).toBe(409);
    expect((await post(E.id, 'cobranca/pagamento', { justificativa: 'x ok', pago_ate: await dia(`${HOJE} + 5`) })).status).toBe(409);
    expect((await erp('get', '/auth/me')).body.data.cobranca).toEqual({ situacao: 'isenta', ate: null });
    expect((await criarNoErp()).status).toBe(201);
});

test('remover a isenção devolve a regra das datas: já vencida, cai em somente leitura e o retorno avisa', async () => {
    const res = await post(E.id, 'cobranca/isencao/remover', { justificativa: 'Passa a pagar' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ situacao: 'somente_leitura', isenta: false });
    expect((await criarNoErp()).status).toBe(403);
    expect((await post(E.id, 'cobranca/isencao/remover', { justificativa: 'de novo' })).status).toBe(409);
});

test('desligar: o login e o token do ERP caem na hora, nada é apagado; religar devolve o acesso', async () => {
    expect((await erp('get', '/auth/me')).status).toBe(200);

    const res = await post(E.id, 'desligar', { justificativa: 'Não pagou após o teste' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ empresa_status: 'inativa' });

    expect((await erp('get', '/auth/me')).status).toBe(401);
    expect((await post(E.id, 'desligar', { justificativa: 'de novo' })).status).toBe(409);
    expect((await sql('SELECT COUNT(*)::int AS n FROM usuarios WHERE empresa_id = $1', [E.id])).rows[0].n).toBeGreaterThan(0);

    const volta = await post(E.id, 'religar', { justificativa: 'Pagou' });
    expect(volta.status).toBe(200);
    expect(volta.body.data.empresa_status).toBe('ativa');
    expect((await erp('get', '/auth/me')).status).toBe(200);
    expect((await post(E.id, 'religar', { justificativa: 'de novo' })).status).toBe(409);
});

test('lista comercial do painel traz a situação de cobrança de cada empresa', async () => {
    const res = await request(app).get('/painel/empresas/comercial').set(operador.cabecalho);
    expect(res.status).toBe(200);
    const linha = res.body.data.find((e) => e.empresa_id === E.id);
    expect(linha.cobranca).toEqual({ situacao: 'somente_leitura', ate: null });
    // Toda empresa traz o campo; as que já existiam (sem linha em empresa_cobranca) vêm como sem_regra.
    expect(res.body.data.every((e) => typeof e.cobranca?.situacao === 'string')).toBe(true);
});

test('trilha: cada mudança grava evento com quem, antes e depois; justificativa fica guardada', async () => {
    const lista = await eventos();
    expect(lista.map((e) => e.acao)).toEqual([
        'cobranca_trial_iniciado', 'cobranca_pagamento_registrado', 'cobranca_isencao_concedida', 'cobranca_isencao_removida',
        'empresa_desligada', 'empresa_religada'
    ]);
    expect(lista[0].detalhe).toMatchObject({ situacao_antes: 'sem_regra', situacao_depois: 'em_teste', dias: 30, justificativa: 'Cliente escolheu o Padrão' });
    expect(lista[1].detalhe).toMatchObject({ situacao_antes: 'somente_leitura', situacao_depois: 'ativa' });
    expect(lista[2].detalhe).toMatchObject({ situacao_depois: 'isenta' });
    expect(lista[3].detalhe).toMatchObject({ situacao_antes: 'isenta', situacao_depois: 'somente_leitura' });
    expect(lista[4].detalhe).toMatchObject({ status_antes: 'ativa', status_depois: 'inativa' });
    expect(lista[5].detalhe).toMatchObject({ status_antes: 'inativa', status_depois: 'ativa' });
    for (const e of lista) expect(typeof e.detalhe.responsavel).toBe('string');
});

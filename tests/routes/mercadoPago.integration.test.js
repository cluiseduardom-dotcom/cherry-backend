// Integração de verdade (Postgres real; cliente do Mercado Pago SIMULADO, sem rede):
// conexão da loja por OAuth, cobrança Pix, consulta e webhook, com isolamento por empresa e RBAC.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

jest.mock('../../src/integrations/mercadoPagoClient', () => {
    const real = jest.requireActual('../../src/integrations/mercadoPagoClient');
    return {
        ...real,
        trocarCodigo: jest.fn(),
        renovarToken: jest.fn(),
        criarPagamentoPix: jest.fn(),
        buscarPagamento: jest.fn()
    };
});

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const client = require('../../src/integrations/mercadoPagoClient');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { cifrar, decifrar } = require('../../src/utils/criptografiaToken');
const { calcularAssinatura } = require('../../src/utils/mercadoPagoAssinatura');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);
const CHAVE = crypto.randomBytes(32);
const SEGREDO_WEBHOOK = `wh-${sufixo}`;
const A = { u: {} };
const B = { u: {} };

const ENV_MP = {
    MP_APP_ID: '123456',
    MP_CLIENT_SECRET: 'segredo-app-teste',
    MP_REDIRECT_URI: 'https://api.test/integracoes/mercadopago/callback',
    MP_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
    MP_WEBHOOK_URL: 'https://api.test/webhooks/mercadopago',
    MP_TOKEN_ENC_KEY: CHAVE.toString('base64'),
    MP_FRONTEND_URL: 'https://front.test'
};

async function criarEmpresa(alvo, rotulo, papeis) {
    const { rows } = await db.query(
        `INSERT INTO empresas (nome, status, email_contato) VALUES ($1, 'ativa', $2) RETURNING id`,
        [`Teste MercadoPago ${rotulo} ${sufixo}`, `loja-${rotulo.toLowerCase()}-${sufixo}@teste.invalid`]
    );
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of papeis) {
        alvo.u[papel] = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH, papel]
        )).rows[0].id;
    }
}

const tk = (alvo, papel) => makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 });
const auth = (req, alvo, papel = 'admin') => req.set('Authorization', `Bearer ${tk(alvo, papel)}`);

async function conectarLoja(alvo, { userId, accessToken = `AT-${alvo.empresaId}`, refreshToken = `RT-${alvo.empresaId}`, expiraEm = new Date(Date.now() + 100 * 24 * 3600 * 1000) } = {}) {
    await db.query('DELETE FROM empresa_mercadopago WHERE empresa_id = $1', [alvo.empresaId]);
    await db.query(
        `INSERT INTO empresa_mercadopago (empresa_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, token_expira_em, ativo, conectado_por)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [alvo.empresaId, userId ?? `mp-${alvo.empresaId}-${sufixo}`, cifrar(accessToken, CHAVE), cifrar(refreshToken, CHAVE), expiraEm, alvo.u.admin]
    );
}

const respostaPix = (id) => ({ idExterno: String(id), status: 'pending', qrCode: `QR-${id}`, qrCodeBase64: `B64-${id}`, ticketUrl: `https://t/${id}` });
const pagamentoMp = (cobranca, extra = {}) => ({
    id: Number(cobranca.id_externo), status: 'approved', external_reference: cobranca.codigo, transaction_amount: Number(cobranca.valor), ...extra
});
const cobrancaDoBanco = async (codigo) => (await db.query('SELECT * FROM cobrancas_pagamento WHERE codigo = $1', [codigo])).rows[0];

function assinar(dataId, { segredo = SEGREDO_WEBHOOK } = {}) {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `req-${crypto.randomBytes(4).toString('hex')}`;
    const v1 = calcularAssinatura({ dataId, requestId, ts, segredo });
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

const enviarWebhook = (dataId, { tipo = 'payment', cabecalhos } = {}) =>
    request(app).post(`/webhooks/mercadopago?data.id=${dataId}&type=${tipo}`).set(cabecalhos ?? assinar(dataId)).send({ type: tipo, data: { id: String(dataId) } });

let idSeq = 900000000 + Math.floor(Math.random() * 1000000);
const proximoId = () => ++idSeq;

async function criarCobrancaPendente(alvo, valor = 100) {
    client.criarPagamentoPix.mockResolvedValueOnce(respostaPix(proximoId()));
    const res = await auth(request(app).post('/pagamentos-gateway/pix'), alvo).send({ valor });
    expect(res.status).toBe(201);
    return cobrancaDoBanco(res.body.data.codigo);
}

const envOriginal = {};
let logOriginal;

beforeAll(async () => {
    for (const k of Object.keys(ENV_MP)) { envOriginal[k] = process.env[k]; process.env[k] = ENV_MP[k]; }
    logOriginal = console.error;
    console.error = jest.fn();
    await criarEmpresa(A, 'A', ['admin', 'vendedor', 'estoquista']);
    await criarEmpresa(B, 'B', ['admin', 'vendedor']);
});

afterAll(async () => {
    console.error = logOriginal;
    for (const k of Object.keys(ENV_MP)) { if (envOriginal[k] === undefined) delete process.env[k]; else process.env[k] = envOriginal[k]; }
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('integração desligada (sem variáveis MP_*)', () => {
    test('rotas de loja respondem 409, o webhook recusa e o status informa configurado=false', async () => {
        const guardado = process.env.MP_APP_ID;
        delete process.env.MP_APP_ID;
        try {
            expect((await auth(request(app).post('/integracoes/mercadopago/conectar'), A)).status).toBe(409);
            expect((await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 10 })).status).toBe(409);
            expect((await request(app).post('/webhooks/mercadopago?data.id=1&type=payment').send({})).status).toBe(500);
            const st = await auth(request(app).get('/integracoes/mercadopago'), A);
            expect(st.body.data).toMatchObject({ configurado: false, conectado: false });
        } finally {
            process.env.MP_APP_ID = guardado;
        }
    });
});

describe('conexão da loja (OAuth)', () => {
    const iniciar = async (alvo) => {
        const res = await auth(request(app).post('/integracoes/mercadopago/conectar'), alvo);
        expect(res.status).toBe(200);
        return new URL(res.body.data.url).searchParams.get('state');
    };

    test('só admin conecta, consulta e desconecta; vendedor e estoquista recebem 403; sem token, 401', async () => {
        for (const papel of ['vendedor', 'estoquista']) {
            expect((await auth(request(app).post('/integracoes/mercadopago/conectar'), A, papel)).status).toBe(403);
            expect((await auth(request(app).get('/integracoes/mercadopago'), A, papel)).status).toBe(403);
            expect((await auth(request(app).delete('/integracoes/mercadopago'), A, papel)).status).toBe(403);
        }
        expect((await request(app).post('/integracoes/mercadopago/conectar')).status).toBe(401);
    });

    test('conectar devolve a URL do Mercado Pago com state aleatório, amarrado à empresa e ao usuário', async () => {
        const res = await auth(request(app).post('/integracoes/mercadopago/conectar'), A);
        const url = new URL(res.body.data.url);
        expect(url.origin + url.pathname).toBe('https://auth.mercadopago.com/authorization');
        expect(url.searchParams.get('client_id')).toBe('123456');
        expect(url.searchParams.get('redirect_uri')).toBe(ENV_MP.MP_REDIRECT_URI);
        const state = url.searchParams.get('state');
        expect(state).toMatch(/^[0-9a-f]{64}$/);
        const { rows } = await db.query('SELECT empresa_id, usuario_id FROM mp_oauth_estados WHERE state = $1', [state]);
        expect(rows[0]).toEqual({ empresa_id: A.empresaId, usuario_id: A.u.admin });
        expect(res.headers['cache-control']).toContain('no-store');
    });

    test('retorno válido guarda os tokens CIFRADOS, redireciona ao frontend e o state é de uso único', async () => {
        client.trocarCodigo.mockResolvedValue({ accessToken: 'AT-NOVO', refreshToken: 'RT-NOVO', expiraEmSegundos: 3600, userId: `u-${sufixo}-a` });
        const state = await iniciar(A);

        const res = await request(app).get(`/integracoes/mercadopago/callback?code=CODE1&state=${state}`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('https://front.test/configuracoes/empresa?mercadopago=conectado');
        expect(client.trocarCodigo).toHaveBeenCalledWith(expect.objectContaining({ appId: '123456' }), 'CODE1');

        const { rows } = await db.query('SELECT * FROM empresa_mercadopago WHERE empresa_id = $1', [A.empresaId]);
        expect(rows[0].ativo).toBe(true);
        expect(rows[0].mp_user_id).toBe(`u-${sufixo}-a`);
        expect(rows[0].access_token_cifrado).not.toContain('AT-NOVO');
        expect(rows[0].refresh_token_cifrado).not.toContain('RT-NOVO');
        expect(decifrar(rows[0].access_token_cifrado, CHAVE)).toBe('AT-NOVO');
        expect(decifrar(rows[0].refresh_token_cifrado, CHAVE)).toBe('RT-NOVO');

        const st = await auth(request(app).get('/integracoes/mercadopago'), A);
        expect(st.body.data).toMatchObject({ configurado: true, conectado: true });
        expect(JSON.stringify(st.body)).not.toMatch(/AT-NOVO|RT-NOVO|token/i);

        const repetido = await request(app).get(`/integracoes/mercadopago/callback?code=CODE2&state=${state}`);
        expect(repetido.headers.location).toContain('mercadopago=erro');
        expect(client.trocarCodigo).toHaveBeenCalledTimes(1);
    });

    test('state inventado, mal formado, vencido ou retorno com error: redireciona com erro e não troca código', async () => {
        const inventado = crypto.randomBytes(32).toString('hex');
        expect((await request(app).get(`/integracoes/mercadopago/callback?code=C&state=${inventado}`)).headers.location).toContain('mercadopago=erro');
        expect((await request(app).get('/integracoes/mercadopago/callback?code=C&state=curto')).headers.location).toContain('mercadopago=erro');
        expect((await request(app).get('/integracoes/mercadopago/callback')).headers.location).toContain('mercadopago=erro');
        expect((await request(app).get('/integracoes/mercadopago/callback?error=access_denied')).headers.location).toContain('mercadopago=erro');

        const state = await iniciar(A);
        await db.query(`UPDATE mp_oauth_estados SET expira_em = NOW() - INTERVAL '1 minute' WHERE state = $1`, [state]);
        expect((await request(app).get(`/integracoes/mercadopago/callback?code=C&state=${state}`)).headers.location).toContain('mercadopago=erro');
        expect(client.trocarCodigo).not.toHaveBeenCalled();
    });

    test('a mesma conta Mercado Pago não pode ficar ligada a duas empresas ativas', async () => {
        client.trocarCodigo.mockResolvedValue({ accessToken: 'AT-B', refreshToken: 'RT-B', expiraEmSegundos: 3600, userId: `u-${sufixo}-a` });
        const state = await iniciar(B);
        const res = await request(app).get(`/integracoes/mercadopago/callback?code=C&state=${state}`);
        expect(res.headers.location).toContain('mercadopago=erro');
        const { rows } = await db.query('SELECT 1 FROM empresa_mercadopago WHERE empresa_id = $1', [B.empresaId]);
        expect(rows).toHaveLength(0);
    });

    test('desconectar apaga os tokens; B não é afetada', async () => {
        await conectarLoja(B);
        await conectarLoja(A);
        const res = await auth(request(app).delete('/integracoes/mercadopago'), A);
        expect(res.body.data).toEqual({ desconectado: true });
        const a = (await db.query('SELECT * FROM empresa_mercadopago WHERE empresa_id = $1', [A.empresaId])).rows[0];
        expect(a).toMatchObject({ ativo: false, access_token_cifrado: null, refresh_token_cifrado: null });
        const b = (await auth(request(app).get('/integracoes/mercadopago'), B)).body.data;
        expect(b.conectado).toBe(true);
    });
});

describe('GET /pagamentos-gateway/disponibilidade', () => {
    test('vendedor e admin veem só { pix, motivo }; estoquista 403; sem token 401', async () => {
        await conectarLoja(A);

        const vendedor = await auth(request(app).get('/pagamentos-gateway/disponibilidade'), A, 'vendedor');
        expect(vendedor.status).toBe(200);
        expect(vendedor.body.data).toEqual({ pix: true, motivo: null });
        expect((await auth(request(app).get('/pagamentos-gateway/disponibilidade'), A, 'admin')).body.data).toEqual({ pix: true, motivo: null });

        expect((await auth(request(app).get('/pagamentos-gateway/disponibilidade'), A, 'estoquista')).status).toBe(403);
        expect((await request(app).get('/pagamentos-gateway/disponibilidade')).status).toBe(401);
    });

    test('loja sem conexão ativa: pix=false, loja_nao_conectada; a de outra empresa não interfere', async () => {
        await conectarLoja(A);
        await conectarLoja(B);
        await db.query('UPDATE empresa_mercadopago SET ativo = false, access_token_cifrado = NULL, refresh_token_cifrado = NULL WHERE empresa_id = $1', [B.empresaId]);

        const b = await auth(request(app).get('/pagamentos-gateway/disponibilidade'), B, 'vendedor');
        expect(b.body.data).toEqual({ pix: false, motivo: 'loja_nao_conectada' });
        expect((await auth(request(app).get('/pagamentos-gateway/disponibilidade'), A, 'vendedor')).body.data.pix).toBe(true);
    });

    test('integração desligada no ambiente: pix=false, nao_configurado', async () => {
        const guardado = process.env.MP_APP_ID;
        delete process.env.MP_APP_ID;
        try {
            const res = await auth(request(app).get('/pagamentos-gateway/disponibilidade'), A, 'vendedor');
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ pix: false, motivo: 'nao_configurado' });
        } finally {
            process.env.MP_APP_ID = guardado;
        }
    });
});

describe('POST /pagamentos-gateway/pix', () => {
    beforeAll(async () => { await conectarLoja(A); await conectarLoja(B); });

    test('estoquista não cria cobrança; sem token, 401', async () => {
        expect((await auth(request(app).post('/pagamentos-gateway/pix'), A, 'estoquista').send({ valor: 10 })).status).toBe(403);
        expect((await request(app).post('/pagamentos-gateway/pix').send({ valor: 10 })).status).toBe(401);
    });

    test('loja sem conexão ativa recebe 409 e nada é gravado', async () => {
        await db.query('UPDATE empresa_mercadopago SET ativo = false, access_token_cifrado = NULL, refresh_token_cifrado = NULL WHERE empresa_id = $1', [B.empresaId]);
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM cobrancas_pagamento WHERE empresa_id = $1', [B.empresaId])).rows[0].n;
        const res = await auth(request(app).post('/pagamentos-gateway/pix'), B, 'vendedor').send({ valor: 10 });
        expect(res.status).toBe(409);
        expect(client.criarPagamentoPix).not.toHaveBeenCalled();
        const depois = (await db.query('SELECT COUNT(*)::int AS n FROM cobrancas_pagamento WHERE empresa_id = $1', [B.empresaId])).rows[0].n;
        expect(depois).toBe(antes);
        await conectarLoja(B);
    });

    test.each([
        [{ valor: 0 }], [{ valor: -5 }], [{ valor: 10.123 }], [{ valor: '10' }], [{ valor: 1e9 }], [{}],
        [{ valor: 10, empresa_id: 1 }], [{ valor: 10, cliente_email: 'nao-e-email' }]
    ])('corpo inválido %j → 400', async (corpo) => {
        const res = await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send(corpo);
        expect(res.status).toBe(400);
        expect(client.criarPagamentoPix).not.toHaveBeenCalled();
    });

    test('cria a cobrança com o token da loja, a comissão pela regra da taxa e SEM expor a taxa na resposta', async () => {
        client.criarPagamentoPix.mockResolvedValue(respostaPix(proximoId()));
        const res = await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 1000 });
        expect(res.status).toBe(201);
        expect(res.headers['cache-control']).toContain('no-store');
        expect(res.body.data).toMatchObject({ status: 'pendente', valor: '1000.00', expirada: false });
        expect(res.body.data.qr_code).toMatch(/^QR-/);
        expect(Object.keys(res.body.data).sort()).toEqual(['codigo', 'expira_em', 'expira_em_segundos', 'expirada', 'qr_code', 'qr_code_base64', 'status', 'ticket_url', 'valor']);
        // validade do Pix = 30 min (relógio do servidor), com folga para a execução do teste
        expect(res.body.data.expira_em_segundos).toBeGreaterThan(29 * 60);
        expect(res.body.data.expira_em_segundos).toBeLessThanOrEqual(30 * 60);

        const [config, entrada] = client.criarPagamentoPix.mock.calls[0];
        expect(config.appId).toBe('123456');
        expect(entrada.accessToken).toBe(`AT-${A.empresaId}`);
        expect(entrada.valor).toBe(1000);
        expect(entrada.codigo).toBe(res.body.data.codigo);
        expect(entrada.emailPagador).toBe(`loja-a-${sufixo}@teste.invalid`);
        // regra padrão sem plano: 0,15% de 1000,00 = 1,50
        expect(entrada.taxaPlataforma).toBe(1.5);
        expect(entrada.expiraEm).toMatch(/-03:00$/);

        const linha = await cobrancaDoBanco(res.body.data.codigo);
        expect(linha).toMatchObject({ empresa_id: A.empresaId, taxa_plataforma: '1.50', criado_por: A.u.vendedor, status: 'pendente' });
        expect(linha.id_externo).toBe(res.body.data.qr_code.replace('QR-', ''));
        expect(JSON.stringify(res.body)).not.toMatch(/AT-|RT-|1\.50|taxa/);
    });

    test('MP_EMAIL_PAGADOR_PADRAO tem precedência sobre o e-mail de contato da empresa, e o do cliente sobre os dois', async () => {
        client.criarPagamentoPix.mockResolvedValue(respostaPix(proximoId()));
        process.env.MP_EMAIL_PAGADOR_PADRAO = 'pagamentos@plataforma.invalid';

        try {
            await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 10 });
            expect(client.criarPagamentoPix.mock.calls[0][1].emailPagador).toBe('pagamentos@plataforma.invalid');

            client.criarPagamentoPix.mockClear();
            await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 10, cliente_email: 'cliente@x.com' });
            expect(client.criarPagamentoPix.mock.calls[0][1].emailPagador).toBe('cliente@x.com');
        } finally {
            delete process.env.MP_EMAIL_PAGADOR_PADRAO;
        }
    });

    test('e-mail do cliente informado tem precedência sobre o e-mail da empresa; sem nenhum e-mail, 400 (não 409: o PDV só cai no Pix manual com 409)', async () => {
        client.criarPagamentoPix.mockResolvedValue(respostaPix(proximoId()));
        await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 10, cliente_email: 'cliente@x.com' });
        expect(client.criarPagamentoPix.mock.calls[0][1].emailPagador).toBe('cliente@x.com');

        await db.query('UPDATE empresas SET email_contato = NULL WHERE id = $1', [B.empresaId]);
        const res = await auth(request(app).post('/pagamentos-gateway/pix'), B, 'vendedor').send({ valor: 10 });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/e-mail de contato/);
        await db.query('UPDATE empresas SET email_contato = $2 WHERE id = $1', [B.empresaId, `loja-b-${sufixo}@teste.invalid`]);
    });

    test('valor pequeno cuja comissão arredonda para zero não manda application_fee', async () => {
        client.criarPagamentoPix.mockResolvedValue(respostaPix(proximoId()));
        await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 1 });
        expect(client.criarPagamentoPix.mock.calls[0][1].taxaPlataforma).toBe(0);
    });

    test('falha do provedor: 424, cobrança marcada como falhou e nenhum detalhe interno na resposta', async () => {
        const AppError = require('../../src/errors/AppError');
        client.criarPagamentoPix.mockRejectedValue(new AppError('O Mercado Pago recusou a operação.', 424));
        const res = await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 77 });
        expect(res.status).toBe(424);
        expect(res.body.message).toBe('O Mercado Pago recusou a operação.');
        const { rows } = await db.query(`SELECT status FROM cobrancas_pagamento WHERE empresa_id = $1 AND valor = 77 ORDER BY id DESC LIMIT 1`, [A.empresaId]);
        expect(rows[0].status).toBe('falhou');
    });

    test('token perto de vencer é renovado sob lock e o novo fica cifrado; falha na renovação com token ainda válido segue', async () => {
        await conectarLoja(A, { expiraEm: new Date(Date.now() + 2 * 24 * 3600 * 1000) });
        client.renovarToken.mockResolvedValue({ accessToken: 'AT-RENOVADO', refreshToken: 'RT-RENOVADO', expiraEmSegundos: 15552000, userId: 'x' });
        client.criarPagamentoPix.mockResolvedValue(respostaPix(proximoId()));
        const res = await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 20 });
        expect(res.status).toBe(201);
        expect(client.renovarToken).toHaveBeenCalledWith(expect.anything(), `RT-${A.empresaId}`);
        expect(client.criarPagamentoPix.mock.calls[0][1].accessToken).toBe('AT-RENOVADO');
        const linha = (await db.query('SELECT * FROM empresa_mercadopago WHERE empresa_id = $1', [A.empresaId])).rows[0];
        expect(decifrar(linha.access_token_cifrado, CHAVE)).toBe('AT-RENOVADO');
        expect(decifrar(linha.refresh_token_cifrado, CHAVE)).toBe('RT-RENOVADO');
        expect(new Date(linha.token_expira_em).getTime()).toBeGreaterThan(Date.now() + 100 * 24 * 3600 * 1000);

        await conectarLoja(A, { expiraEm: new Date(Date.now() + 2 * 24 * 3600 * 1000) });
        client.renovarToken.mockRejectedValue(new Error('provedor fora'));
        client.criarPagamentoPix.mockResolvedValue(respostaPix(proximoId()));
        const seguiu = await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 20 });
        expect(seguiu.status).toBe(201);
        expect(client.criarPagamentoPix.mock.calls[1][1].accessToken).toBe(`AT-${A.empresaId}`);

        await conectarLoja(A, { expiraEm: new Date(Date.now() - 1000) });
        client.criarPagamentoPix.mockClear();
        const vencido = await auth(request(app).post('/pagamentos-gateway/pix'), A, 'vendedor').send({ valor: 20 });
        expect(vencido.status).toBe(409);
        expect(client.criarPagamentoPix).not.toHaveBeenCalled();
        await conectarLoja(A);
    });
});

describe('GET /pagamentos-gateway/:codigo', () => {
    beforeAll(async () => { await conectarLoja(A); await conectarLoja(B); });

    test('outra empresa não enxerga a cobrança (404), código inválido é 404 e sem token é 401', async () => {
        const cobranca = await criarCobrancaPendente(A);
        expect((await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), B, 'vendedor')).status).toBe(404);
        expect((await auth(request(app).get('/pagamentos-gateway/nao-e-uuid'), A, 'vendedor')).status).toBe(404);
        expect((await auth(request(app).get(`/pagamentos-gateway/${crypto.randomUUID()}`), A, 'vendedor')).status).toBe(404);
        expect((await request(app).get(`/pagamentos-gateway/${cobranca.codigo}`)).status).toBe(401);
        expect((await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'estoquista')).status).toBe(403);
    });

    test('consulta pendente reconsulta o provedor com o token da loja e vira pago; depois não consulta mais', async () => {
        const cobranca = await criarCobrancaPendente(A, 250);
        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca));
        const res = await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor');
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('pago');
        expect(client.buscarPagamento).toHaveBeenCalledWith(expect.anything(), { accessToken: `AT-${A.empresaId}`, idExterno: cobranca.id_externo });

        client.buscarPagamento.mockClear();
        const outra = await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor');
        expect(outra.body.data.status).toBe('pago');
        expect(client.buscarPagamento).not.toHaveBeenCalled();
    });

    test('consultas seguidas de uma cobrança pendente respeitam o intervalo mínimo', async () => {
        const cobranca = await criarCobrancaPendente(A);
        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca, { status: 'pending' }));
        await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor');
        await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor');
        expect(client.buscarPagamento).toHaveBeenCalledTimes(1);
    });

    test('divergência de valor ou de referência no provedor é ignorada (continua pendente)', async () => {
        const cobranca = await criarCobrancaPendente(A, 100);
        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca, { transaction_amount: 1 }));
        expect((await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor')).body.data.status).toBe('pendente');

        await db.query('UPDATE cobrancas_pagamento SET consultado_em = NULL WHERE id = $1', [cobranca.id]);
        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca, { external_reference: crypto.randomUUID() }));
        expect((await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor')).body.data.status).toBe('pendente');
    });

    test('falha do provedor na leitura devolve o último estado conhecido, sem erro', async () => {
        const cobranca = await criarCobrancaPendente(A);
        client.buscarPagamento.mockRejectedValue(new Error('fora do ar'));
        const res = await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor');
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('pendente');
    });

    test('QR vencido é sinalizado como expirada', async () => {
        const cobranca = await criarCobrancaPendente(A);
        await db.query(`UPDATE cobrancas_pagamento SET expira_em = NOW() - INTERVAL '1 minute', consultado_em = NOW() WHERE id = $1`, [cobranca.id]);
        const res = await auth(request(app).get(`/pagamentos-gateway/${cobranca.codigo}`), A, 'vendedor');
        expect(res.body.data.expirada).toBe(true);
        expect(res.body.data.expira_em_segundos).toBe(0);
    });
});

describe('POST /webhooks/mercadopago', () => {
    beforeAll(async () => { await conectarLoja(A); await conectarLoja(B); });

    test('assinatura ausente, errada ou de outro segredo: 401 e nenhuma consulta ao provedor', async () => {
        const cobranca = await criarCobrancaPendente(A);
        const id = cobranca.id_externo;
        expect((await request(app).post(`/webhooks/mercadopago?data.id=${id}&type=payment`).send({})).status).toBe(401);
        expect((await enviarWebhook(id, { cabecalhos: assinar(id, { segredo: 'outro' }) })).status).toBe(401);
        expect((await enviarWebhook(id, { cabecalhos: { 'x-signature': 'ts=1,v1=00', 'x-request-id': 'r' } })).status).toBe(401);
        // assinatura válida para OUTRO id não vale para este
        expect((await enviarWebhook(id, { cabecalhos: assinar('999') })).status).toBe(401);
        expect(client.buscarPagamento).not.toHaveBeenCalled();
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pendente');
    });

    test('notificação válida consulta o provedor com o token da loja dona e marca pago (o corpo recebido não é confiável)', async () => {
        const cobranca = await criarCobrancaPendente(A, 300);
        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca));
        const res = await enviarWebhook(cobranca.id_externo);
        expect(res.status).toBe(200);
        expect(client.buscarPagamento).toHaveBeenCalledWith(expect.anything(), { accessToken: `AT-${A.empresaId}`, idExterno: cobranca.id_externo });
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pago');
    });

    test('repetição é idempotente e a cobrança da empresa B usa o token de B', async () => {
        const cobranca = await criarCobrancaPendente(B, 80);
        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca));
        await enviarWebhook(cobranca.id_externo);
        await enviarWebhook(cobranca.id_externo);
        expect(client.buscarPagamento.mock.calls.every(([, e]) => e.accessToken === `AT-${B.empresaId}`)).toBe(true);
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pago');
    });

    test('pago -> estornado é aceito; pago nunca volta para pendente ou cancelado', async () => {
        const cobranca = await criarCobrancaPendente(A, 90);
        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca));
        await enviarWebhook(cobranca.id_externo);

        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca, { status: 'pending' }));
        await enviarWebhook(cobranca.id_externo);
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pago');

        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca, { status: 'cancelled' }));
        await enviarWebhook(cobranca.id_externo);
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pago');

        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca, { status: 'refunded' }));
        await enviarWebhook(cobranca.id_externo);
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('estornado');
    });

    test('pagamento desconhecido e tipos que não são payment: 200 sem consultar o provedor', async () => {
        const desconhecido = await enviarWebhook(5555555555);
        expect(desconhecido.status).toBe(200);
        const outroTipo = await enviarWebhook(1234, { tipo: 'merchant_order' });
        expect(outroTipo.status).toBe(200);
        expect(client.buscarPagamento).not.toHaveBeenCalled();
    });

    test('provedor fora do ar na notificação: resposta de erro para o Mercado Pago tentar de novo', async () => {
        const AppError = require('../../src/errors/AppError');
        const cobranca = await criarCobrancaPendente(A);
        client.buscarPagamento.mockRejectedValue(new AppError('O Mercado Pago recusou a operação.', 424));
        const res = await enviarWebhook(cobranca.id_externo);
        expect(res.status).toBe(424);
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pendente');
    });

    test('cobrança cuja loja desconectou não quebra: erro 409 e nada muda', async () => {
        const cobranca = await criarCobrancaPendente(B, 30);
        await db.query('UPDATE empresa_mercadopago SET ativo = false, access_token_cifrado = NULL, refresh_token_cifrado = NULL WHERE empresa_id = $1', [B.empresaId]);
        const res = await enviarWebhook(cobranca.id_externo);
        expect(res.status).toBe(409);
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pendente');
        await conectarLoja(B);
    });
});

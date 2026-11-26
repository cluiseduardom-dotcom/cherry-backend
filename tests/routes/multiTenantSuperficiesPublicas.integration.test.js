// Integração de verdade (Postgres real; cliente do Mercado Pago SIMULADO, sem rede).
// Tarefa 01 (isolamento multi-tenant), PR 5: duas superfícies públicas (sem JWT) que gravam por identidade
// vinda de fora do corpo autenticado e que não tinham teste contra o banco real:
//   1. retorno do OAuth: a empresa vem só do `state` gravado por nós; nada da query muda o destino;
//   2. webhook de link de cartão: a loja vem do `user_id` da notificação; uma cobrança de outra loja,
//      citada no external_reference, nunca é tocada.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

jest.mock('../../src/integrations/mercadoPagoClient', () => {
    const real = jest.requireActual('../../src/integrations/mercadoPagoClient');
    return {
        ...real,
        trocarCodigo: jest.fn(),
        renovarToken: jest.fn(),
        criarPagamentoPix: jest.fn(),
        buscarPagamento: jest.fn(),
        buscarPagamentosPorReferencia: jest.fn()
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
const A = { mpUser: `mpu-a-${sufixo}` };
const B = { mpUser: `mpu-b-${sufixo}` };

const ENV_MP = {
    MP_APP_ID: '123456',
    MP_CLIENT_SECRET: 'segredo-app-teste',
    MP_REDIRECT_URI: 'https://api.test/integracoes/mercadopago/callback',
    MP_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
    MP_WEBHOOK_URL: 'https://api.test/webhooks/mercadopago',
    MP_TOKEN_ENC_KEY: CHAVE.toString('base64'),
    MP_FRONTEND_URL: 'https://front.test'
};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(
        `INSERT INTO empresas (nome, status, email_contato) VALUES ($1, 'ativa', $2) RETURNING id`,
        [`Teste SuperficiesPublicas ${rotulo} ${sufixo}`, `sp-${rotulo.toLowerCase()}-${sufixo}@teste.invalid`]
    );
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.admin = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.empresaId, `admin ${sufixo}`, `admin-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH]
    )).rows[0].id;
}

const auth = (req, alvo) => req.set('Authorization', `Bearer ${makeToken({ id: alvo.admin, role: 'admin', empresa_id: alvo.empresaId, tv: 0 })}`);

async function conectarLoja(alvo) {
    await db.query('DELETE FROM empresa_mercadopago WHERE empresa_id = $1', [alvo.empresaId]);
    await db.query(
        `INSERT INTO empresa_mercadopago (empresa_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, token_expira_em, ativo, conectado_por)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [alvo.empresaId, alvo.mpUser, cifrar(`AT-${alvo.empresaId}`, CHAVE), cifrar(`RT-${alvo.empresaId}`, CHAVE),
            new Date(Date.now() + 100 * 24 * 3600 * 1000), alvo.admin]
    );
}

const conexaoDoBanco = async (empresaId) =>
    (await db.query('SELECT * FROM empresa_mercadopago WHERE empresa_id = $1', [empresaId])).rows[0];

let idSeq = 800000000 + Math.floor(Math.random() * 1000000);
const proximoId = () => ++idSeq;

// Link de cartão pendente (ainda sem pagamento ligado), como o PDV o deixa.
async function cobrancaCartaoPendente(alvo, valor = 120) {
    const codigo = crypto.randomUUID();
    await db.query(
        `INSERT INTO cobrancas_pagamento
            (codigo, empresa_id, metodo, valor, taxa_plataforma, status, criado_por, preferencia_id, link_url, parcelas_maximas)
         VALUES ($1, $2, 'cartao_link', $3, 0, 'pendente', $4, $5, 'https://mp.exemplo/checkout', 12)`,
        [codigo, alvo.empresaId, valor, alvo.admin, `pref-${codigo}`]
    );
    return codigo;
}

const cobrancaDoBanco = async (codigo) => (await db.query('SELECT * FROM cobrancas_pagamento WHERE codigo = $1', [codigo])).rows[0];

const pagamentoCartao = (id, codigo, valor = 120) => ({
    id, status: 'approved', external_reference: codigo, payment_type_id: 'credit_card', transaction_amount: valor, installments: 3
});

function assinar(dataId) {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `req-${crypto.randomBytes(4).toString('hex')}`;
    return { 'x-signature': `ts=${ts},v1=${calcularAssinatura({ dataId, requestId, ts, segredo: SEGREDO_WEBHOOK })}`, 'x-request-id': requestId };
}

const webhook = (dataId, userId) =>
    request(app).post(`/webhooks/mercadopago?data.id=${dataId}&type=payment`).set(assinar(dataId))
        .send({ type: 'payment', data: { id: String(dataId) }, ...(userId === undefined ? {} : { user_id: userId }) });

const envOriginal = {};
let logOriginal;

beforeAll(async () => {
    for (const k of Object.keys(ENV_MP)) { envOriginal[k] = process.env[k]; process.env[k] = ENV_MP[k]; }
    logOriginal = console.error;
    console.error = jest.fn();
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
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

describe('retorno do OAuth (público): o destino é só a empresa do state', () => {
    const iniciar = async (alvo) => {
        const res = await auth(request(app).post('/integracoes/mercadopago/conectar'), alvo);
        expect(res.status).toBe(200);
        return new URL(res.body.data.url).searchParams.get('state');
    };

    test('state da empresa A grava só em A: a conexão já existente de B não muda', async () => {
        await conectarLoja(B);
        const antesB = await conexaoDoBanco(B.empresaId);
        client.trocarCodigo.mockResolvedValue({ accessToken: 'AT-NOVO-A', refreshToken: 'RT-NOVO-A', expiraEmSegundos: 3600, userId: `u-novo-a-${sufixo}` });

        const state = await iniciar(A);
        const res = await request(app).get(`/integracoes/mercadopago/callback?code=CODE-A&state=${state}`);
        expect(res.headers.location).toBe('https://front.test/configuracoes/empresa?mercadopago=conectado');

        const a = await conexaoDoBanco(A.empresaId);
        expect(a).toMatchObject({ ativo: true, mp_user_id: `u-novo-a-${sufixo}` });
        expect(decifrar(a.access_token_cifrado, CHAVE)).toBe('AT-NOVO-A');

        expect(await conexaoDoBanco(B.empresaId)).toEqual(antesB);
    });

    test('empresa_id (ou usuario_id) na query do retorno é ignorado: o destino segue o state', async () => {
        await conectarLoja(B);
        const antesB = await conexaoDoBanco(B.empresaId);
        client.trocarCodigo.mockResolvedValue({ accessToken: 'AT-X', refreshToken: 'RT-X', expiraEmSegundos: 3600, userId: `u-x-${sufixo}` });

        const state = await iniciar(A);
        await request(app).get(`/integracoes/mercadopago/callback?code=CODE-X&state=${state}&empresa_id=${B.empresaId}&usuario_id=${B.admin}`);

        expect(await conexaoDoBanco(B.empresaId)).toEqual(antesB);
        const a = await conexaoDoBanco(A.empresaId);
        expect(a).toMatchObject({ ativo: true, mp_user_id: `u-x-${sufixo}`, conectado_por: A.admin });
    });

    test('state de uso único: reapresentá-lo (inclusive com outro code) não regrava nada', async () => {
        client.trocarCodigo.mockResolvedValue({ accessToken: 'AT-1', refreshToken: 'RT-1', expiraEmSegundos: 3600, userId: `u-1-${sufixo}` });
        const state = await iniciar(A);
        await request(app).get(`/integracoes/mercadopago/callback?code=C1&state=${state}`);
        const depoisDoPrimeiro = await conexaoDoBanco(A.empresaId);

        client.trocarCodigo.mockClear();
        client.trocarCodigo.mockResolvedValue({ accessToken: 'AT-2', refreshToken: 'RT-2', expiraEmSegundos: 3600, userId: `u-2-${sufixo}` });
        const repetido = await request(app).get(`/integracoes/mercadopago/callback?code=C2&state=${state}`);

        expect(repetido.headers.location).toContain('mercadopago=erro');
        expect(client.trocarCodigo).not.toHaveBeenCalled();
        expect(await conexaoDoBanco(A.empresaId)).toEqual(depoisDoPrimeiro);
    });
});

describe('webhook de link de cartão: user_id de uma loja nunca alcança a cobrança de outra', () => {
    beforeAll(async () => { await conectarLoja(A); await conectarLoja(B); });

    test('controle: user_id da própria loja + referência da própria cobrança liga o pagamento e marca pago', async () => {
        const codigo = await cobrancaCartaoPendente(A);
        const idPagamento = proximoId();
        client.buscarPagamento.mockResolvedValue(pagamentoCartao(idPagamento, codigo));
        client.buscarPagamentosPorReferencia.mockResolvedValue([pagamentoCartao(idPagamento, codigo)]);

        const res = await webhook(idPagamento, A.mpUser);
        expect(res.status).toBe(200);
        expect(client.buscarPagamento).toHaveBeenCalledWith(expect.anything(), { accessToken: `AT-${A.empresaId}`, idExterno: String(idPagamento) });

        const cobranca = await cobrancaDoBanco(codigo);
        expect(cobranca).toMatchObject({ status: 'pago', id_externo: String(idPagamento), tipo_cartao: 'credito', parcelas: 3 });
    });

    test('user_id da loja B + external_reference da cobrança de A: A não é tocada e só o token de B é usado', async () => {
        const codigoA = await cobrancaCartaoPendente(A);
        const antesA = await cobrancaDoBanco(codigoA);
        const idPagamento = proximoId();
        client.buscarPagamento.mockResolvedValue(pagamentoCartao(idPagamento, codigoA));
        client.buscarPagamentosPorReferencia.mockResolvedValue([pagamentoCartao(idPagamento, codigoA)]);

        const res = await webhook(idPagamento, B.mpUser);
        expect(res.status).toBe(200);

        // A leitura do pagamento foi feita com o token de B (quem o `user_id` diz ser), nunca o de A.
        expect(client.buscarPagamento).toHaveBeenCalledTimes(1);
        expect(client.buscarPagamento).toHaveBeenCalledWith(expect.anything(), { accessToken: `AT-${B.empresaId}`, idExterno: String(idPagamento) });
        // Nenhuma busca por referência (que usaria o token da dona da cobrança) e nenhuma gravação em A.
        expect(client.buscarPagamentosPorReferencia).not.toHaveBeenCalled();
        expect(await cobrancaDoBanco(codigoA)).toEqual(antesA);
        expect((await cobrancaDoBanco(codigoA)).status).toBe('pendente');
        expect((await cobrancaDoBanco(codigoA)).id_externo).toBeNull();
    });

    test('user_id ausente, desconhecido ou de loja desconectada: 200, sem consultar o provedor e sem gravar', async () => {
        const codigo = await cobrancaCartaoPendente(A);
        const antes = await cobrancaDoBanco(codigo);
        const idPagamento = proximoId();
        client.buscarPagamento.mockResolvedValue(pagamentoCartao(idPagamento, codigo));

        expect((await webhook(idPagamento)).status).toBe(200);
        expect((await webhook(idPagamento, `inexistente-${sufixo}`)).status).toBe(200);

        await db.query('UPDATE empresa_mercadopago SET ativo = false WHERE empresa_id = $1', [A.empresaId]);
        try {
            expect((await webhook(idPagamento, A.mpUser)).status).toBe(200);
        } finally {
            await db.query('UPDATE empresa_mercadopago SET ativo = true WHERE empresa_id = $1', [A.empresaId]);
        }

        expect(client.buscarPagamento).not.toHaveBeenCalled();
        expect(await cobrancaDoBanco(codigo)).toEqual(antes);
    });

    test('user_id de B com a referência de uma cobrança Pix de A também não a altera', async () => {
        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(proximoId()), status: 'pending', qrCode: 'QR', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });
        const criada = await auth(request(app).post('/pagamentos-gateway/pix'), A).send({ valor: 55 });
        expect(criada.status).toBe(201);
        const codigoPix = criada.body.data.codigo;
        const antes = await cobrancaDoBanco(codigoPix);

        const idPagamento = proximoId();
        client.buscarPagamento.mockResolvedValue(pagamentoCartao(idPagamento, codigoPix, 55));
        expect((await webhook(idPagamento, B.mpUser)).status).toBe(200);

        expect(await cobrancaDoBanco(codigoPix)).toEqual(antes);
    });
});

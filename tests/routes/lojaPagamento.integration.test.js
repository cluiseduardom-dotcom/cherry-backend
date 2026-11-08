// Integração de verdade (Postgres de testes; cliente do Mercado Pago SIMULADO, sem rede, nunca a conta real):
// pagamento do pedido da loja online e conversão do pedido pago em venda.
//
// Prova: (1) a cliente só cria a cobrança, quem marca "pago" é o webhook assinado e conferido; (2) webhook duplicado ou
// simultâneo vende uma vez só; (3) a venda usa o preço CONGELADO do pedido; (4) falha do ERP no meio desfaz tudo e a
// próxima tentativa refaz; (5) pagamento recusado/pendente/tardio não corrompe estoque; (6) o PDV segue intacto.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

jest.mock('../../src/integrations/mercadoPagoClient', () => {
    const real = jest.requireActual('../../src/integrations/mercadoPagoClient');
    return {
        ...real,
        criarPagamentoPix: jest.fn(),
        criarPreferenciaCartao: jest.fn(),
        buscarPagamento: jest.fn(),
        buscarPagamentosPorReferencia: jest.fn(),
        devolverPagamento: jest.fn(),
        renovarToken: jest.fn()
    };
});

const crypto = require('node:crypto');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const client = require('../../src/integrations/mercadoPagoClient');
const AppError = require('../../src/errors/AppError');
const vendasRepository = require('../../src/repositories/vendasRepository');
const pedidosRepository = require('../../src/repositories/lojaPedidosRepository');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { cifrar } = require('../../src/utils/criptografiaToken');
const { calcularAssinatura } = require('../../src/utils/mercadoPagoAssinatura');
const { calcularTaxaPlataformaCentavos, reaisParaCentavos } = require('../../src/utils/taxaPlataforma');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const SEGREDO_WEBHOOK = `wh-${sufixo}`;
const CHAVE = crypto.randomBytes(32);
const LOJA_URL = 'https://loja.teste.invalid';
const A = { slug: `teste-ga-${sufixo}`, p: {}, mpUser: `mpu-a-${sufixo}` };
const B = { slug: `teste-gb-${sufixo}`, p: {}, mpUser: `mpu-b-${sufixo}` };

const ENV = {
    MP_APP_ID: '123456',
    MP_CLIENT_SECRET: 'segredo-app-teste',
    MP_REDIRECT_URI: 'https://api.test/integracoes/mercadopago/callback',
    MP_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
    MP_WEBHOOK_URL: 'https://api.test/webhooks/mercadopago',
    MP_TOKEN_ENC_KEY: CHAVE.toString('base64'),
    MP_FRONTEND_URL: 'https://front.test',
    LOJA_PUBLIC_URL: LOJA_URL
};

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
let contador = 0;
let idMp = 800000000 + Math.floor(Math.random() * 1000000);
const chaveNova = () => `chave-${sufixo}-${++contador}-${crypto.randomBytes(3).toString('hex')}`;
const emailNovo = () => `cliente${++contador}-${crypto.randomBytes(3).toString('hex')}@teste.local`;

async function criarEmpresa(E, nome) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${nome} ${sufixo}`, E.slug]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'online') RETURNING id`, [E.id]);
    E.canalFisico = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'loja_fisica') RETURNING id`, [E.id]);
    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.slug}@teste.local`]);
    E.token = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`,
        [E.id]
    );
    await conectarMercadoPago(E);
}

async function conectarMercadoPago(E) {
    await db.query('DELETE FROM empresa_mercadopago WHERE empresa_id = $1', [E.id]);
    await db.query(
        `INSERT INTO empresa_mercadopago (empresa_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, token_expira_em, ativo, conectado_por)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [E.id, E.mpUser, cifrar(`AT-${E.id}`, CHAVE), cifrar(`RT-${E.id}`, CHAVE), new Date(Date.now() + 100 * 24 * 3600 * 1000), E.admin]
    );
}

async function criarProduto(E, chave, { preco = 100, saldo = 5 } = {}) {
    const id = await um(`INSERT INTO produtos (empresa_id, nome, custo, tipo, ativo, estoque_atual) VALUES ($1, $2, 9.99, 'acabado', true, $3) RETURNING id`, [E.id, `Peça ${chave}`, saldo]);
    E.p[chave] = { id, slug: `${chave}-${id}`, preco };
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 1, 1)`, [E.id, id, E.canal, preco]);
    if (saldo > 0) await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, E.central, E.id, saldo]);
    await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug) VALUES ($1, $2, true, $3)`, [id, E.id, E.p[chave].slug]);
    return id;
}

async function estoque(E, chave) {
    const { id } = E.p[chave];
    const { rows } = await db.query(
        `SELECT l.tipo, COALESCE(el.saldo, 0) AS saldo FROM locais_estoque l
           LEFT JOIN estoque_locais el ON el.local_id = l.id AND el.produto_id = $2 AND el.empresa_id = l.empresa_id WHERE l.empresa_id = $1`,
        [E.id, id]
    );
    const por = Object.fromEntries(rows.map((r) => [r.tipo, r.saldo]));
    const { rows: [p] } = await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [id]);

    return { central: por.central ?? 0, reserva: por.reserva ?? 0, total: p.estoque_atual, fecha: rows.reduce((a, r) => a + r.saldo, 0) === p.estoque_atual };
}

// Cria um pedido pela API e devolve { codigo, id, total }.
async function novoPedido(E, chaves, { email = emailNovo() } = {}) {
    const itens = chaves.map((c) => (typeof c === 'string' ? { chave: c, quantidade: 1 } : c))
        .map((c) => ({ slug: E.p[c.chave].slug, quantidade: c.quantidade ?? 1, preco_exibido: E.p[c.chave].preco }));
    const res = await request(app).post(`/loja/${E.slug}/pedidos`).set('Idempotency-Key', chaveNova())
        .send({ cliente: { nome: 'Maria Cliente', email, telefone: '11912345678' }, itens });

    if (res.status !== 201) throw new Error(`pedido: ${res.status} ${JSON.stringify(res.body)}`);

    const { rows: [p] } = await db.query('SELECT id FROM pedidos_loja WHERE codigo = $1', [res.body.data.codigo]);
    return { codigo: res.body.data.codigo, id: p.id, total: res.body.data.total, email };
}

const pagar = (E, codigo, metodo, corpo = {}) => request(app).post(`/loja/${E.slug}/pedidos/${codigo}/pagamento`).send({ metodo, ...corpo });
const verPedido = (E, codigo) => request(app).get(`/loja/${E.slug}/pedidos/${codigo}`);
const pedidoDoBanco = async (id) => (await db.query('SELECT * FROM pedidos_loja WHERE id = $1', [id])).rows[0];
const cobrancaDoBanco = async (codigo) => (await db.query('SELECT * FROM cobrancas_pagamento WHERE codigo = $1', [codigo])).rows[0];
const eventos = async (id) => (await db.query('SELECT tipo FROM pedidos_loja_eventos WHERE pedido_id = $1 ORDER BY id', [id])).rows.map((r) => r.tipo);

function assinar(dataId, { segredo = SEGREDO_WEBHOOK } = {}) {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `req-${crypto.randomBytes(4).toString('hex')}`;
    return { 'x-signature': `ts=${ts},v1=${calcularAssinatura({ dataId, requestId, ts, segredo })}`, 'x-request-id': requestId };
}

const webhook = (E, dataId, { cabecalhos } = {}) =>
    request(app).post(`/webhooks/mercadopago?data.id=${dataId}&type=payment`).set(cabecalhos ?? assinar(dataId))
        .send({ type: 'payment', data: { id: String(dataId) }, user_id: E.mpUser });

// Cria o Pix do pedido (cliente simulado do provedor) e devolve a cobrança do banco.
async function pedirPix(E, pedido) {
    const id = ++idMp;
    client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(id), status: 'pending', qrCode: `QR-${id}`, qrCodeBase64: `B64-${id}`, ticketUrl: `https://t/${id}` });
    const res = await pagar(E, pedido.codigo, 'pix');
    if (res.status !== 201) throw new Error(`pix: ${res.status} ${JSON.stringify(res.body)}`);
    const { cobranca_codigo } = await pedidoDoBanco(pedido.id);
    return cobrancaDoBanco(cobranca_codigo);
}

// O provedor passa a informar este pagamento (do Pix, aprovado por padrão).
function provedorInforma(cobranca, extra = {}) {
    client.buscarPagamento.mockResolvedValue({
        id: Number(cobranca.id_externo), status: 'approved', external_reference: cobranca.codigo, transaction_amount: Number(cobranca.valor), ...extra
    });
}

const envOriginal = {};
let logOriginal;

beforeAll(async () => {
    for (const k of Object.keys(ENV)) { envOriginal[k] = process.env[k]; process.env[k] = ENV[k]; }
    logOriginal = console.error;
    console.error = jest.fn();
    await criarEmpresa(A, 'Pagamento A');
    await criarEmpresa(B, 'Pagamento B');
});

afterAll(async () => {
    console.error = logOriginal;
    for (const k of Object.keys(ENV)) { if (envOriginal[k] === undefined) delete process.env[k]; else process.env[k] = envOriginal[k]; }
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
    console.error = jest.fn();
});

describe('criar o pagamento do pedido', () => {
    test('Pix: devolve o QR, grava a cobrança sem usuário, com a taxa da plataforma, e estende a reserva', async () => {
        await criarProduto(A, 'pix1', { preco: 200, saldo: 5 });
        const pedido = await novoPedido(A, [{ chave: 'pix1', quantidade: 2 }]);
        const antes = (await pedidoDoBanco(pedido.id)).reserva_expira_em;
        const id = ++idMp;
        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(id), status: 'pending', qrCode: `QR-${id}`, qrCodeBase64: `B64-${id}`, ticketUrl: 'https://t/x' });

        const res = await pagar(A, pedido.codigo, 'pix');

        expect(res.status).toBe(201);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.data).toMatchObject({ metodo: 'pix', status: 'pendente', valor: 400, qr_code: `QR-${id}`, qr_code_base64: `B64-${id}` });
        expect(res.body.data.expira_em_segundos).toBeGreaterThan(25 * 60);

        const { cobranca_codigo, reserva_expira_em } = await pedidoDoBanco(pedido.id);
        const cobranca = await cobrancaDoBanco(cobranca_codigo);
        const regra = await taxasPlataformaRepository.resolverRegra(A.id, db);
        const taxaEsperada = calcularTaxaPlataformaCentavos(reaisParaCentavos(400), regra.percentual);

        expect(cobranca).toMatchObject({ empresa_id: A.id, metodo: 'pix', status: 'pendente', criado_por: null, venda_id: null });
        expect(reaisParaCentavos(cobranca.taxa_plataforma)).toBe(taxaEsperada);

        // O provedor recebeu o valor do PEDIDO (do servidor), o e-mail da cliente e a taxa.
        const enviado = client.criarPagamentoPix.mock.calls[0][1];
        expect(enviado).toMatchObject({ codigo: cobranca_codigo, valor: 400, emailPagador: pedido.email, descricao: 'Pedido na loja online' });
        expect(Math.round(enviado.taxaPlataforma * 100)).toBe(taxaEsperada);

        expect(new Date(reserva_expira_em).getTime()).toBeGreaterThan(new Date(antes).getTime());
        expect(await eventos(pedido.id)).toEqual(['criado', 'pagamento_iniciado']);
    });

    test('a resposta não traz taxa, id do provedor nem código interno da cobrança', async () => {
        await criarProduto(A, 'pix2', { saldo: 5 });
        const pedido = await novoPedido(A, ['pix2']);
        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(++idMp), status: 'pending', qrCode: 'QR', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });

        const res = await pagar(A, pedido.codigo, 'pix');

        expect(Object.keys(res.body.data).sort()).toEqual(['expira_em', 'expira_em_segundos', 'metodo', 'qr_code', 'qr_code_base64', 'status', 'valor']);
        expect(JSON.stringify(res.body)).not.toMatch(/taxa|id_externo|ticket|codigo|criado_por/i);
    });

    test('é idempotente: pedir de novo devolve a MESMA cobrança e não vai de novo ao provedor', async () => {
        await criarProduto(A, 'idem1', { saldo: 5 });
        const pedido = await novoPedido(A, ['idem1']);
        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(++idMp), status: 'pending', qrCode: 'QR-IGUAL', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });

        const primeira = await pagar(A, pedido.codigo, 'pix');
        const segunda = await pagar(A, pedido.codigo, 'pix');

        expect([primeira.status, segunda.status]).toEqual([201, 200]);
        expect(segunda.body.data.qr_code).toBe('QR-IGUAL');
        expect(client.criarPagamentoPix).toHaveBeenCalledTimes(1);
    });

    test('seis pedidos de pagamento SIMULTÂNEOS: uma única cobrança no provedor', async () => {
        await criarProduto(A, 'conc1', { saldo: 5 });
        const pedido = await novoPedido(A, ['conc1']);
        client.criarPagamentoPix.mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 150));
            return { idExterno: String(++idMp), status: 'pending', qrCode: 'QR', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' };
        });

        const res = await Promise.all(Array.from({ length: 6 }, () => pagar(A, pedido.codigo, 'pix')));

        expect(client.criarPagamentoPix).toHaveBeenCalledTimes(1);
        expect(res.filter((r) => r.status === 201)).toHaveLength(1);
        expect(res.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
        expect(res.filter((r) => r.status === 409).every((r) => r.body.codigo === 'PAGAMENTO_EM_PREPARO')).toBe(true);
    });

    test('cartão: devolve o link, volta à loja depois de pagar e não cobra taxa', async () => {
        await criarProduto(A, 'cartao1', { preco: 150, saldo: 5 });
        const pedido = await novoPedido(A, ['cartao1']);
        client.criarPreferenciaCartao.mockResolvedValueOnce({ preferenciaId: `pref-${sufixo}-1`, linkUrl: 'https://mp.teste/checkout/1' });

        const res = await pagar(A, pedido.codigo, 'cartao');

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ metodo: 'cartao', status: 'pendente', valor: 150, link_url: 'https://mp.teste/checkout/1' });
        expect(res.body.data.parcelas_maximas).toBeGreaterThanOrEqual(1);
        expect(res.body.data).not.toHaveProperty('qr_code');

        const enviado = client.criarPreferenciaCartao.mock.calls[0][1];
        expect(enviado.taxaPlataforma).toBe(0);
        expect(enviado.urlsRetorno).toEqual({
            sucesso: `${LOJA_URL}/pedido/${pedido.codigo}?pagamento=sucesso`,
            pendente: `${LOJA_URL}/pedido/${pedido.codigo}?pagamento=pendente`,
            falha: `${LOJA_URL}/pedido/${pedido.codigo}?pagamento=falha`
        });
    });

    test('com um Pix em aberto, trocar para cartão é recusado (evita dois pagamentos)', async () => {
        await criarProduto(A, 'troca1', { saldo: 5 });
        const pedido = await novoPedido(A, ['troca1']);
        await pedirPix(A, pedido);

        const res = await pagar(A, pedido.codigo, 'cartao');

        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('PAGAMENTO_OUTRO_METODO');
        expect(client.criarPreferenciaCartao).not.toHaveBeenCalled();
    });

    test('falha do provedor: 503 genérico (sem a mensagem do provedor), nada fica preso e dá para tentar de novo', async () => {
        await criarProduto(A, 'falha1', { saldo: 5 });
        const pedido = await novoPedido(A, ['falha1']);
        client.criarPagamentoPix.mockRejectedValueOnce(new AppError('Mercado Pago recusou: token-secreto-xyz', 424));

        const falha = await pagar(A, pedido.codigo, 'pix');

        expect(falha.status).toBe(503);
        expect(falha.body.codigo).toBe('PAGAMENTO_INDISPONIVEL');
        expect(JSON.stringify(falha.body)).not.toContain('token-secreto-xyz');
        expect((await cobrancaDoBanco((await pedidoDoBanco(pedido.id)).cobranca_codigo)).status).toBe('falhou');

        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(++idMp), status: 'pending', qrCode: 'QR-OK', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });
        const nova = await pagar(A, pedido.codigo, 'pix');

        expect(nova.status).toBe(201);
        expect(nova.body.data.qr_code).toBe('QR-OK');
    });

    test('loja sem Mercado Pago conectado: 503 e o pedido fica livre para tentar quando conectar', async () => {
        await criarProduto(B, 'semmp', { saldo: 5 });
        const pedido = await novoPedido(B, ['semmp']);
        await db.query('DELETE FROM empresa_mercadopago WHERE empresa_id = $1', [B.id]);

        const res = await pagar(B, pedido.codigo, 'pix');

        expect(res.status).toBe(503);
        expect((await pedidoDoBanco(pedido.id)).cobranca_codigo).toBeNull();
        expect(client.criarPagamentoPix).not.toHaveBeenCalled();

        await conectarMercadoPago(B);
        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(++idMp), status: 'pending', qrCode: 'QR', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });
        expect((await pagar(B, pedido.codigo, 'pix')).status).toBe(201);
    });

    test('pedido inexistente, de outra loja ou código malformado: 404; método inválido ou campo extra: 400', async () => {
        await criarProduto(A, 'val1', { saldo: 5 });
        const pedido = await novoPedido(A, ['val1']);

        expect((await pagar(A, crypto.randomUUID(), 'pix')).status).toBe(404);
        expect((await pagar(B, pedido.codigo, 'pix')).status).toBe(404);
        expect((await pagar(A, 'nao-e-uuid', 'pix')).status).toBe(404);
        expect((await pagar(A, pedido.codigo, 'boleto')).status).toBe(400);
        expect((await pagar(A, pedido.codigo, 'pix', { valor: 1 })).status).toBe(400);
        expect((await pagar(A, pedido.codigo, 'pix', { empresa_id: B.id })).status).toBe(400);
        expect(client.criarPagamentoPix).not.toHaveBeenCalled();
    });

    test('pedido com a reserva vencida não gera pagamento (409)', async () => {
        await criarProduto(A, 'venc1', { saldo: 5 });
        const pedido = await novoPedido(A, ['venc1']);
        await db.query(`UPDATE pedidos_loja SET reserva_expira_em = NOW() - INTERVAL '1 minute' WHERE id = $1`, [pedido.id]);

        const res = await pagar(A, pedido.codigo, 'pix');

        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('RESERVA_EXPIRADA');
        expect(client.criarPagamentoPix).not.toHaveBeenCalled();
    });

    test('a reserva não passa do teto absoluto, mesmo criando pagamento atrás de pagamento', async () => {
        await criarProduto(A, 'teto1', { saldo: 5 });
        const pedido = await novoPedido(A, ['teto1']);
        await db.query(`UPDATE pedidos_loja SET criado_em = NOW() - INTERVAL '119 minutes', reserva_expira_em = NOW() + INTERVAL '5 minutes' WHERE id = $1`, [pedido.id]);
        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(++idMp), status: 'pending', qrCode: 'QR', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });

        expect((await pagar(A, pedido.codigo, 'pix')).status).toBe(201);

        const { rows: [p] } = await db.query(`SELECT reserva_expira_em <= criado_em + INTERVAL '120 minutes' AS dentro_do_teto FROM pedidos_loja WHERE id = $1`, [pedido.id]);
        expect(p.dentro_do_teto).toBe(true);
    });

    test('o pedido mostra o QR enquanto o Pix está em aberto, para a cliente voltar à tela', async () => {
        await criarProduto(A, 'volta1', { saldo: 5 });
        const pedido = await novoPedido(A, ['volta1']);
        expect((await verPedido(A, pedido.codigo)).body.data.pagamento).toBeNull();

        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(++idMp), status: 'pending', qrCode: 'QR-VOLTA', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });
        await pagar(A, pedido.codigo, 'pix');

        const { data } = (await verPedido(A, pedido.codigo)).body;
        expect(data.status).toBe('aguardando_pagamento');
        expect(data.pagamento).toMatchObject({ metodo: 'pix', status: 'pendente', qr_code: 'QR-VOLTA' });
        expect(JSON.stringify(data)).not.toMatch(/taxa|id_externo/i);
    });
});

describe('pagamento confirmado pelo webhook vira venda', () => {
    test('Pix aprovado: pedido pago, venda do canal online sem usuário, preço do pedido, taxa e estoque exatos', async () => {
        await criarProduto(A, 'venda1', { preco: 80, saldo: 5 });
        const pedido = await novoPedido(A, [{ chave: 'venda1', quantidade: 2 }]);
        const cobranca = await pedirPix(A, pedido);
        expect(await estoque(A, 'venda1')).toEqual({ central: 3, reserva: 2, total: 5, fecha: true });
        provedorInforma(cobranca);

        const res = await webhook(A, cobranca.id_externo);

        expect(res.status).toBe(200);

        const p = await pedidoDoBanco(pedido.id);
        expect(p).toMatchObject({ status: 'pago' });
        expect(p.venda_id).not.toBeNull();
        expect(p.pago_em).not.toBeNull();

        const { rows: [venda] } = await db.query('SELECT * FROM vendas WHERE id = $1', [p.venda_id]);
        expect(venda).toMatchObject({ empresa_id: A.id, canal_id: A.canal, usuario_id: null, cliente_id: null, status: 'finalizada' });
        expect(Number(venda.total)).toBe(160);

        const { rows: itens } = await db.query('SELECT produto_id, quantidade, preco_unitario FROM itens_venda WHERE venda_id = $1', [venda.id]);
        expect(itens.map((i) => [i.produto_id, i.quantidade, Number(i.preco_unitario)])).toEqual([[A.p.venda1.id, 2, 80]]);

        const { rows: [pag] } = await db.query('SELECT * FROM pagamentos_venda WHERE venda_id = $1', [venda.id]);
        expect(pag).toMatchObject({ forma_pagamento: 'pix', origem: 'gateway', provedor: 'mercadopago', usuario_id: null, status: 'pago' });
        expect(Number(pag.valor)).toBe(160);

        const { rows: taxas } = await db.query('SELECT percentual, base_calculo, valor FROM taxas_venda WHERE venda_id = $1', [venda.id]);
        expect(taxas).toHaveLength(1);
        expect(Number(taxas[0].base_calculo)).toBe(160);

        expect((await db.query('SELECT COUNT(*)::int AS n FROM comissoes_venda WHERE venda_id = $1', [venda.id])).rows[0].n).toBe(0);
        expect(await cobrancaDoBanco(cobranca.codigo)).toMatchObject({ venda_id: venda.id });

        expect(await estoque(A, 'venda1')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
        expect(await eventos(pedido.id)).toEqual(['criado', 'pagamento_iniciado', 'pago']);

        const final = (await verPedido(A, pedido.codigo)).body.data;
        expect(final).toMatchObject({ status: 'pago', pagamento: null });
    });

    test('o ledger de estoque fecha: reserva, devolução ao Central na mesma transação e a saída da venda', async () => {
        await criarProduto(A, 'ledger1', { saldo: 4 });
        const pedido = await novoPedido(A, ['ledger1']);
        const cobranca = await pedirPix(A, pedido);
        provedorInforma(cobranca);
        await webhook(A, cobranca.id_externo);

        const { rows } = await db.query(
            `SELECT m.tipo, l.tipo AS local FROM movimentacoes_estoque m JOIN locais_estoque l ON l.id = m.local_id WHERE m.produto_id = $1 ORDER BY m.id`,
            [A.p.ledger1.id]
        );

        expect(rows.map((r) => `${r.tipo}:${r.local}`)).toEqual(['saida:central', 'entrada:reserva', 'saida:reserva', 'entrada:central', 'saida:central']);
        expect(await estoque(A, 'ledger1')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });

    test('o preço do pedido vale, não o de hoje: o preço subiu depois do pedido e a venda sai pelo preço pago', async () => {
        await criarProduto(A, 'preco1', { preco: 100, saldo: 5 });
        const pedido = await novoPedido(A, ['preco1']);
        const cobranca = await pedirPix(A, pedido);
        await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, criado_em) VALUES ($1, $2, $3, 150, 1, 1, NOW() + INTERVAL '1 second')`, [A.id, A.p.preco1.id, A.canal]);
        provedorInforma(cobranca);

        await webhook(A, cobranca.id_externo);

        const { venda_id } = await pedidoDoBanco(pedido.id);
        const { rows: [item] } = await db.query('SELECT preco_unitario FROM itens_venda WHERE venda_id = $1', [venda_id]);
        expect(Number(item.preco_unitario)).toBe(100);
        expect(Number((await db.query('SELECT total FROM vendas WHERE id = $1', [venda_id])).rows[0].total)).toBe(100);
    });

    test('webhook DUPLICADO: a segunda entrega não vende de novo nem mexe no estoque', async () => {
        await criarProduto(A, 'dup1', { saldo: 5 });
        const pedido = await novoPedido(A, ['dup1']);
        const cobranca = await pedirPix(A, pedido);
        provedorInforma(cobranca);

        const [r1, r2, r3] = [await webhook(A, cobranca.id_externo), await webhook(A, cobranca.id_externo), await webhook(A, cobranca.id_externo)];

        expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM vendas WHERE id = $1', [(await pedidoDoBanco(pedido.id)).venda_id])).rows[0].n).toBe(1);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM itens_venda iv JOIN vendas v ON v.id = iv.venda_id WHERE iv.produto_id = $1 AND v.empresa_id = $2', [A.p.dup1.id, A.id])).rows[0].n).toBe(1);
        expect(await estoque(A, 'dup1')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
        expect((await eventos(pedido.id)).filter((e) => e === 'pago')).toHaveLength(1);
    });

    test('seis webhooks SIMULTÂNEOS do mesmo pagamento: uma venda só', async () => {
        await criarProduto(A, 'dup2', { saldo: 5 });
        const pedido = await novoPedido(A, ['dup2']);
        const cobranca = await pedirPix(A, pedido);
        provedorInforma(cobranca);

        const res = await Promise.all(Array.from({ length: 6 }, () => webhook(A, cobranca.id_externo)));

        expect(res.every((r) => r.status === 200)).toBe(true);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM vendas WHERE empresa_id = $1 AND id = $2', [A.id, (await pedidoDoBanco(pedido.id)).venda_id])).rows[0].n).toBe(1);
        expect(await estoque(A, 'dup2')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
        expect((await eventos(pedido.id)).filter((e) => e === 'pago')).toHaveLength(1);
    });

    test('assinatura inválida: 401 e NADA muda (nem pedido, nem estoque)', async () => {
        await criarProduto(A, 'assin1', { saldo: 5 });
        const pedido = await novoPedido(A, ['assin1']);
        const cobranca = await pedirPix(A, pedido);
        provedorInforma(cobranca);

        const falsa = await webhook(A, cobranca.id_externo, { cabecalhos: assinar(cobranca.id_externo, { segredo: 'segredo-errado' }) });
        const semCabecalho = await webhook(A, cobranca.id_externo, { cabecalhos: {} });

        expect([falsa.status, semCabecalho.status]).toEqual([401, 401]);
        expect(client.buscarPagamento).not.toHaveBeenCalled();
        expect((await pedidoDoBanco(pedido.id)).status).toBe('aguardando_pagamento');
        expect(await estoque(A, 'assin1')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });
    });

    test('o corpo do webhook não vale: o provedor diz outra coisa (valor ou referência diferentes) e nada é aprovado', async () => {
        await criarProduto(A, 'forja1', { preco: 100, saldo: 5 });
        const pedido = await novoPedido(A, ['forja1']);
        const cobranca = await pedirPix(A, pedido);

        provedorInforma(cobranca, { transaction_amount: 1 });
        await webhook(A, cobranca.id_externo);
        provedorInforma(cobranca, { external_reference: crypto.randomUUID() });
        await webhook(A, cobranca.id_externo);

        expect((await pedidoDoBanco(pedido.id)).status).toBe('aguardando_pagamento');
        expect((await cobrancaDoBanco(cobranca.codigo)).status).toBe('pendente');
        expect(await estoque(A, 'forja1')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });
    });

    test('pagamento PENDENTE: o pedido segue aguardando com a peça reservada', async () => {
        await criarProduto(A, 'pend1', { saldo: 5 });
        const pedido = await novoPedido(A, ['pend1']);
        const cobranca = await pedirPix(A, pedido);

        for (const status of ['pending', 'in_process', 'authorized']) {
            provedorInforma(cobranca, { status });
            expect((await webhook(A, cobranca.id_externo)).status).toBe(200);
        }

        expect((await pedidoDoBanco(pedido.id)).status).toBe('aguardando_pagamento');
        expect(await estoque(A, 'pend1')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });
    });

    test('pagamento RECUSADO: o pedido segue aguardando, a reserva fica e a cliente pode gerar um novo Pix', async () => {
        await criarProduto(A, 'recus1', { saldo: 5 });
        const pedido = await novoPedido(A, ['recus1']);
        const primeira = await pedirPix(A, pedido);
        provedorInforma(primeira, { status: 'rejected' });

        expect((await webhook(A, primeira.id_externo)).status).toBe(200);

        expect((await cobrancaDoBanco(primeira.codigo)).status).toBe('cancelado');
        expect((await pedidoDoBanco(pedido.id)).status).toBe('aguardando_pagamento');
        expect(await estoque(A, 'recus1')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });

        const segunda = await pedirPix(A, pedido);
        expect(segunda.codigo).not.toBe(primeira.codigo);
        provedorInforma(segunda);
        await webhook(A, segunda.id_externo);

        expect((await pedidoDoBanco(pedido.id)).status).toBe('pago');
        expect(await estoque(A, 'recus1')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
    });

    test('cartão de crédito aprovado em 3x: a venda registra crédito, 3 parcelas e origem do gateway', async () => {
        await criarProduto(A, 'cc1', { preco: 300, saldo: 5 });
        const pedido = await novoPedido(A, ['cc1']);
        client.criarPreferenciaCartao.mockResolvedValueOnce({ preferenciaId: `pref-${sufixo}-cc1`, linkUrl: 'https://mp.teste/checkout/cc1' });
        await pagar(A, pedido.codigo, 'cartao');
        const { cobranca_codigo } = await pedidoDoBanco(pedido.id);
        const idPagamento = ++idMp;
        const pagamentoMp = { id: idPagamento, status: 'approved', external_reference: cobranca_codigo, payment_type_id: 'credit_card', transaction_amount: 300, installments: 3 };
        client.buscarPagamento.mockResolvedValue(pagamentoMp);
        client.buscarPagamentosPorReferencia.mockResolvedValue([pagamentoMp]);

        const res = await webhook(A, idPagamento);

        expect(res.status).toBe(200);
        const p = await pedidoDoBanco(pedido.id);
        expect(p.status).toBe('pago');

        const { rows: [pag] } = await db.query('SELECT forma_pagamento, numero_parcelas, origem, usuario_id FROM pagamentos_venda WHERE venda_id = $1', [p.venda_id]);
        expect(pag).toMatchObject({ forma_pagamento: 'credito', numero_parcelas: 3, origem: 'gateway', usuario_id: null });
        expect((await db.query('SELECT COUNT(*)::int AS n FROM parcelas_pagamento pp JOIN pagamentos_venda pv ON pv.id = pp.pagamento_id WHERE pv.venda_id = $1', [p.venda_id])).rows[0].n).toBe(3);
        expect(await estoque(A, 'cc1')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
    });
});

describe('falha do ERP durante a conversão', () => {
    test('a venda falha no meio: tudo é desfeito, o pedido segue aguardando com a peça reservada e a repetição conclui', async () => {
        await criarProduto(A, 'erp1', { saldo: 5 });
        const pedido = await novoPedido(A, ['erp1']);
        const cobranca = await pedirPix(A, pedido);
        provedorInforma(cobranca);
        jest.spyOn(vendasRepository, 'criar').mockRejectedValueOnce(new Error('falha simulada do ERP'));

        const falha = await webhook(A, cobranca.id_externo);

        expect(falha.status).toBe(500);
        expect((await pedidoDoBanco(pedido.id)).status).toBe('aguardando_pagamento');
        expect((await pedidoDoBanco(pedido.id)).venda_id).toBeNull();
        expect(await estoque(A, 'erp1')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });
        expect((await cobrancaDoBanco(cobranca.codigo)).venda_id).toBeNull();
        expect(await eventos(pedido.id)).toContain('conversao_falhou');

        // O Mercado Pago repete a notificação (resposta 500): agora o ERP responde.
        const repetido = await webhook(A, cobranca.id_externo);

        expect(repetido.status).toBe(200);
        expect((await pedidoDoBanco(pedido.id)).status).toBe('pago');
        expect(await estoque(A, 'erp1')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
        expect((await db.query('SELECT COUNT(*)::int AS n FROM vendas WHERE id = $1', [(await pedidoDoBanco(pedido.id)).venda_id])).rows[0].n).toBe(1);
    });

    test('falha que a notificação não repete: o pedido pago não expira e o cron o converte', async () => {
        await criarProduto(A, 'cron1', { saldo: 5 });
        const pedido = await novoPedido(A, ['cron1']);
        const cobranca = await pedirPix(A, pedido);
        // Cobrança já PAGA (como o webhook a deixou) e conversão que não aconteceu; a reserva venceu enquanto isso.
        await db.query(`UPDATE cobrancas_pagamento SET status = 'pago' WHERE codigo = $1`, [cobranca.codigo]);
        await db.query(`UPDATE pedidos_loja SET reserva_expira_em = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [pedido.id]);

        await pedidosRepository.expirarVencidos({ empresa_id: A.id });

        expect((await pedidoDoBanco(pedido.id)).status).toBe('aguardando_pagamento');
        expect(await estoque(A, 'cron1')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });

        const convertidos = await pedidosRepository.converterPendentes();

        expect(convertidos).toBeGreaterThanOrEqual(1);
        expect((await pedidoDoBanco(pedido.id)).status).toBe('pago');
        expect(await estoque(A, 'cron1')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
    });
});

describe('pagamento que chega depois de a reserva expirar', () => {
    async function expirarPedido(pedido) {
        await db.query(`UPDATE pedidos_loja SET reserva_expira_em = NOW() - INTERVAL '1 minute' WHERE id = $1`, [pedido.id]);
        await pedidosRepository.expirarVencidos({ empresa_id: A.id });
        expect((await pedidoDoBanco(pedido.id)).status).toBe('expirado');
    }

    test('com a peça ainda no Central: o pedido é reaberto e vendido (a cliente pagou)', async () => {
        await criarProduto(A, 'tarde1', { saldo: 5 });
        const pedido = await novoPedido(A, ['tarde1']);
        const cobranca = await pedirPix(A, pedido);
        await expirarPedido(pedido);
        provedorInforma(cobranca);

        const res = await webhook(A, cobranca.id_externo);

        expect(res.status).toBe(200);
        const p = await pedidoDoBanco(pedido.id);
        expect(p).toMatchObject({ status: 'pago', encerrado_em: null, motivo_encerramento: null });
        expect(p.venda_id).not.toBeNull();
        expect(await estoque(A, 'tarde1')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
        expect(await eventos(pedido.id)).toEqual(['criado', 'pagamento_iniciado', 'expirado', 'pago']);
    });

    test('sem estoque (outra cliente levou a peça): NÃO vende, o pagamento fica a devolver e nada fica negativo', async () => {
        await criarProduto(A, 'tarde2', { saldo: 1 });
        const pedido = await novoPedido(A, ['tarde2']);
        const cobranca = await pedirPix(A, pedido);
        await expirarPedido(pedido);
        const outra = await novoPedido(A, ['tarde2']);
        expect(await estoque(A, 'tarde2')).toEqual({ central: 0, reserva: 1, total: 1, fecha: true });
        provedorInforma(cobranca);

        const res = await webhook(A, cobranca.id_externo);

        expect(res.status).toBe(200);
        expect((await pedidoDoBanco(pedido.id))).toMatchObject({ status: 'expirado', venda_id: null });
        expect(await eventos(pedido.id)).toContain('pago_sem_estoque');
        expect((await pedidoDoBanco(outra.id)).status).toBe('aguardando_pagamento');
        expect(await estoque(A, 'tarde2')).toEqual({ central: 0, reserva: 1, total: 1, fecha: true });

        // A cobrança paga sem venda aparece na lista de Pix a devolver, para o financeiro estornar.
        const lista = await request(app).get('/pagamentos-gateway/a-devolver').set('Authorization', `Bearer ${A.token}`);
        expect(lista.status).toBe(200);
        expect(lista.body.data.items.map((i) => i.codigo)).toContain(cobranca.codigo);
        expect(lista.body.data.items.find((i) => i.codigo === cobranca.codigo)).toMatchObject({ situacao: 'sem_venda' });
    });
});

describe('isolamento e o PDV', () => {
    test('o webhook de uma loja nunca mexe no pedido de outra, e uma cobrança só liga a um pedido', async () => {
        await criarProduto(A, 'iso1', { saldo: 5 });
        await criarProduto(B, 'iso1', { saldo: 5 });
        const pedidoA = await novoPedido(A, ['iso1']);
        const pedidoB = await novoPedido(B, ['iso1']);
        await pedirPix(A, pedidoA);
        const cobrancaB = await pedirPix(B, pedidoB);
        provedorInforma(cobrancaB);

        await webhook(B, cobrancaB.id_externo);

        expect((await pedidoDoBanco(pedidoB.id)).status).toBe('pago');
        expect((await pedidoDoBanco(pedidoA.id)).status).toBe('aguardando_pagamento');
        expect(await estoque(A, 'iso1')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });

        // Duas linhas da MESMA empresa com a mesma cobrança: recusado pelo índice único.
        await criarProduto(A, 'iso2', { saldo: 5 });
        const pedidoA2 = await novoPedido(A, ['iso2']);
        const { cobranca_codigo } = await pedidoDoBanco(pedidoA.id);
        await expect(db.query('UPDATE pedidos_loja SET cobranca_codigo = $2 WHERE id = $1', [pedidoA2.id, cobranca_codigo])).rejects.toThrow(/uq_pedidos_loja_cobranca/);
    });

    test('o PDV segue igual: Pix cobrado no caixa, pago pelo webhook (sem pedido) e usado numa venda comum', async () => {
        await criarProduto(A, 'pdv1', { preco: 50, saldo: 5 });
        const id = ++idMp;
        client.criarPagamentoPix.mockResolvedValueOnce({ idExterno: String(id), status: 'pending', qrCode: 'QR', qrCodeBase64: 'B64', ticketUrl: 'https://t/x' });
        const criada = await request(app).post('/pagamentos-gateway/pix').set('Authorization', `Bearer ${A.token}`).send({ valor: 50, cliente_email: 'pdv@teste.local' });
        expect(criada.status).toBe(201);
        const cobranca = await cobrancaDoBanco(criada.body.data.codigo);
        expect(cobranca.criado_por).toBe(A.admin);
        provedorInforma(cobranca);

        expect((await webhook(A, cobranca.id_externo)).status).toBe(200);

        const paga = await cobrancaDoBanco(cobranca.codigo);
        expect(paga).toMatchObject({ status: 'pago', venda_id: null });
        expect((await db.query('SELECT COUNT(*)::int AS n FROM pedidos_loja WHERE cobranca_codigo = $1', [cobranca.codigo])).rows[0].n).toBe(0);

        await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 50, 1, 1)`, [A.id, A.p.pdv1.id, A.canalFisico]);
        const venda = await request(app).post('/vendas').set('Authorization', `Bearer ${A.token}`)
            .send({ canal: 'loja_fisica', itens: [{ produto_id: A.p.pdv1.id, quantidade: 1 }], pagamentos: [{ forma_pagamento: 'pix', valor: 50, cobranca_codigo: cobranca.codigo }] });
        expect(venda.status).toBe(201);
        expect(await cobrancaDoBanco(cobranca.codigo)).toMatchObject({ venda_id: venda.body.data.id });
        expect(await estoque(A, 'pdv1')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
    });
});

describe('venda criada dentro da transação de quem chama', () => {
    // Estas duas opções existem só para a loja (clienteExterno e precosFixos); o PDV não as usa.
    async function dentroDeUmaTransacao(fn) {
        const c = await db.connect();
        try {
            await c.query('BEGIN');
            return await fn(c);
        } finally {
            await c.query('ROLLBACK').catch(() => {});
            c.release();
        }
    }

    test('com clienteExterno, vendasRepository.criar NÃO confirma a transação: desfazer de fora desfaz a venda e a baixa', async () => {
        await criarProduto(A, 'ext1', { preco: 30, saldo: 5 });
        let vendaId;

        await dentroDeUmaTransacao(async (c) => {
            const venda = await vendasRepository.criar({
                canal_id: A.canalFisico, usuario_id: null, empresa_id: A.id, clienteExterno: c,
                itens: [{ produto_id: A.p.ext1.id, quantidade: 2 }], precosFixos: { [A.p.ext1.id]: 30 },
                pagamentos: [{ forma_pagamento: 'dinheiro', valor: 60, valor_recebido: 60 }]
            });
            vendaId = venda.id;
            expect(Number(venda.total)).toBe(60);
        });

        expect((await db.query('SELECT 1 FROM vendas WHERE id = $1', [vendaId])).rows).toEqual([]);
        expect(await estoque(A, 'ext1')).toEqual({ central: 5, reserva: 0, total: 5, fecha: true });
    });

    test('precosFixos manda no preço; produto fora do mapa é recusado como sem preço', async () => {
        await criarProduto(A, 'ext2', { preco: 30, saldo: 5 });
        await criarProduto(A, 'ext3', { preco: 30, saldo: 5 });

        await dentroDeUmaTransacao(async (c) => {
            const venda = await vendasRepository.criar({
                canal_id: A.canalFisico, usuario_id: null, empresa_id: A.id, clienteExterno: c,
                itens: [{ produto_id: A.p.ext2.id, quantidade: 1 }], precosFixos: { [A.p.ext2.id]: 99.9 },
                pagamentos: [{ forma_pagamento: 'dinheiro', valor: 99.9, valor_recebido: 100 }]
            });
            expect(Number(venda.total)).toBe(99.9);
        });

        await dentroDeUmaTransacao(async (c) => {
            await expect(vendasRepository.criar({
                canal_id: A.canalFisico, usuario_id: null, empresa_id: A.id, clienteExterno: c,
                itens: [{ produto_id: A.p.ext3.id, quantidade: 1 }], precosFixos: { [A.p.ext2.id]: 10 },
                pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10, valor_recebido: 10 }]
            })).rejects.toMatchObject({ statusCode: 409 });
        });
    });
});

describe('invariantes finais', () => {
    test('cada pedido pago tem exatamente uma venda com o total do pedido, e o estoque fecha em todos os produtos', async () => {
        const { rows: descasados } = await db.query(
            `SELECT p.id FROM pedidos_loja p JOIN vendas v ON v.id = p.venda_id
              WHERE p.empresa_id = ANY($1::int[]) AND (v.total <> p.total OR v.status <> 'finalizada')`,
            [[A.id, B.id]]
        );
        expect(descasados).toEqual([]);

        const { rows: duplicadas } = await db.query(
            `SELECT venda_id FROM pedidos_loja WHERE empresa_id = ANY($1::int[]) AND venda_id IS NOT NULL GROUP BY venda_id HAVING COUNT(*) > 1`,
            [[A.id, B.id]]
        );
        expect(duplicadas).toEqual([]);

        const { rows: pagosSemVenda } = await db.query(`SELECT id FROM pedidos_loja WHERE empresa_id = ANY($1::int[]) AND status = 'pago' AND venda_id IS NULL`, [[A.id, B.id]]);
        expect(pagosSemVenda).toEqual([]);

        const { rows: estoqueDescasado } = await db.query(
            `SELECT p.id FROM produtos p WHERE p.empresa_id = ANY($1::int[])
                AND p.estoque_atual <> COALESCE((SELECT SUM(el.saldo) FROM estoque_locais el WHERE el.produto_id = p.id), 0)`,
            [[A.id, B.id]]
        );
        expect(estoqueDescasado).toEqual([]);

        const { rows: negativos } = await db.query('SELECT 1 FROM estoque_locais WHERE empresa_id = ANY($1::int[]) AND saldo < 0', [[A.id, B.id]]);
        expect(negativos).toEqual([]);

        const { rows: cobrancasUsadasEmDobro } = await db.query(
            `SELECT venda_id FROM cobrancas_pagamento WHERE empresa_id = ANY($1::int[]) AND venda_id IS NOT NULL GROUP BY venda_id HAVING COUNT(*) > 1`,
            [[A.id, B.id]]
        );
        expect(cobrancasUsadasEmDobro).toEqual([]);
    });
});

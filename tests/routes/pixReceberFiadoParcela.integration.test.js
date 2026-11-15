// Integração de verdade (Postgres de testes; cliente do Mercado Pago SIMULADO, sem rede): Pix gerado para RECEBER fiado (Colheita)
// e parcelas do crediário. Prova: (1) o Pix pago quita o fiado/a conta sozinho e UMA vez (consulta repetida, webhook repetido);
// (2) valor maior que a dívida/o restante é recusado antes de gerar o QR; (3) acesso: escopo de clientes, módulo ligado, conta a
// receber só do admin, outra empresa = 404; (4) Pix pago que não pôde ser aplicado (saldo mudou) fica com o motivo e em "a devolver";
// (5) Pix já aplicado não é devolvido nem entra em venda. Empresas "Teste ..." temporárias, removidas no fim.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

jest.mock('../../src/integrations/mercadoPagoClient', () => {
    const real = jest.requireActual('../../src/integrations/mercadoPagoClient');
    return { ...real, trocarCodigo: jest.fn(), renovarToken: jest.fn(), criarPagamentoPix: jest.fn(), buscarPagamento: jest.fn() };
});

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const client = require('../../src/integrations/mercadoPagoClient');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { cifrar } = require('../../src/utils/criptografiaToken');
const { calcularAssinatura } = require('../../src/utils/mercadoPagoAssinatura');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);
const CHAVE = crypto.randomBytes(32);
const SEGREDO_WEBHOOK = `wh-${sufixo}`;
const A = { u: {} };
const B = { u: {} };
const SEM = { u: {} };

const ENV_MP = {
    MP_APP_ID: '123456',
    MP_CLIENT_SECRET: 'segredo-app-teste',
    MP_REDIRECT_URI: 'https://api.test/integracoes/mercadopago/callback',
    MP_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
    MP_WEBHOOK_URL: 'https://api.test/webhooks/mercadopago',
    MP_TOKEN_ENC_KEY: CHAVE.toString('base64'),
    MP_FRONTEND_URL: 'https://front.test'
};

async function criarEmpresa(alvo, rotulo, { fiado = true } = {}) {
    const { rows } = await db.query(
        `INSERT INTO empresas (nome, status, email_contato) VALUES ($1, 'ativa', $2) RETURNING id`,
        [`Teste PixDestino ${rotulo} ${sufixo}`, `loja-${rotulo.toLowerCase()}-${sufixo}@teste.invalid`]
    );
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;

    for (const papel of ['admin', 'vendedor']) {
        alvo.u[papel] = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH, papel]
        )).rows[0].id;
    }

    if (fiado) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'fiado', true, 'teste', 'teste')`, [alvo.empresaId]);
    }
}

const auth = (req, alvo, papel = 'admin') => req.set('Authorization', `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}`);
const chave = () => crypto.randomUUID();

async function conectarLoja(alvo) {
    await db.query(
        `INSERT INTO empresa_mercadopago (empresa_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, token_expira_em, ativo, conectado_por)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [alvo.empresaId, `mp-${alvo.empresaId}-${sufixo}`, cifrar(`AT-${alvo.empresaId}`, CHAVE), cifrar(`RT-${alvo.empresaId}`, CHAVE), new Date(Date.now() + 100 * 24 * 3600 * 1000), alvo.u.admin]
    );
}

let idSeq = 800000000 + Math.floor(Math.random() * 1000000);
const respostaPix = () => { const id = ++idSeq; return { idExterno: String(id), status: 'pending', qrCode: `QR-${id}`, qrCodeBase64: `B64-${id}`, ticketUrl: `https://t/${id}` }; };
const pagamentoMp = (cobranca, extra = {}) => ({ id: Number(cobranca.id_externo), status: 'approved', external_reference: cobranca.codigo, transaction_amount: Number(cobranca.valor), ...extra });
const cobrancaDoBanco = async (codigo) => (await db.query('SELECT * FROM cobrancas_pagamento WHERE codigo = $1', [codigo])).rows[0];

function assinar(dataId) {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `req-${crypto.randomBytes(4).toString('hex')}`;

    return { 'x-signature': `ts=${ts},v1=${calcularAssinatura({ dataId, requestId, ts, segredo: SEGREDO_WEBHOOK })}`, 'x-request-id': requestId };
}

const enviarWebhook = (dataId) => request(app).post(`/webhooks/mercadopago?data.id=${dataId}&type=payment`).set(assinar(dataId)).send({ type: 'payment', data: { id: String(dataId) } });

const gerarPix = (alvo, papel, valor, destino) => {
    client.criarPagamentoPix.mockResolvedValueOnce(respostaPix());

    return auth(request(app).post('/pagamentos-gateway/pix'), alvo, papel).send({ valor, destino });
};

const consultar = (alvo, papel, codigo) => auth(request(app).get(`/pagamentos-gateway/${codigo}`), alvo, papel);

// Marca como pago no provedor e consulta (a consulta espera o intervalo mínimo entre leituras: zera `consultado_em`).
async function pagar(alvo, papel, codigo) {
    const cobranca = await cobrancaDoBanco(codigo);
    await db.query('UPDATE cobrancas_pagamento SET consultado_em = NULL WHERE id = $1', [cobranca.id]);
    client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca));

    return consultar(alvo, papel, codigo);
}

const saldoFiado = async (alvo, clienteId) => Number((await db.query('SELECT saldo FROM fiado_saldos WHERE empresa_id = $1 AND cliente_id = $2', [alvo.empresaId, clienteId])).rows[0]?.saldo ?? 0);
const lancamentos = async (alvo, clienteId) => (await db.query('SELECT tipo, valor, forma, chave_idempotencia FROM fiado_lancamentos WHERE empresa_id = $1 AND cliente_id = $2 ORDER BY id', [alvo.empresaId, clienteId])).rows;
const compraFiado = (alvo, clienteId, valor) => auth(request(app).post(`/fiado/clientes/${clienteId}/compras`), alvo, 'vendedor').set('Idempotency-Key', chave()).send({ valor, descricao: 'Compras' });

async function novoCliente(alvo, nome, dono) {
    return (await db.query(`INSERT INTO clientes (empresa_id, nome, telefone, criado_por) VALUES ($1, $2, '(11) 91234-5678', $3) RETURNING id`, [alvo.empresaId, nome, dono])).rows[0].id;
}

async function vendaCrediario() {
    const res = await auth(request(app).post('/vendas'), A, 'vendedor').send({
        cliente_id: A.clienteCrediario, itens: [{ produto_id: A.produtoId, quantidade: 2 }],
        pagamentos: [{ forma_pagamento: 'crediario', valor: 200, numero_parcelas: 2, meses_prazo: 1 }]
    });

    expect(res.status).toBe(201);

    return (await db.query('SELECT id, parcela_id FROM contas_receber WHERE venda_id = $1 ORDER BY id', [res.body.data.id])).rows;
}

const envOriginal = {};
let logOriginal;

beforeAll(async () => {
    for (const k of Object.keys(ENV_MP)) { envOriginal[k] = process.env[k]; process.env[k] = ENV_MP[k]; }
    logOriginal = console.error;
    console.error = jest.fn();

    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    await criarEmpresa(SEM, 'Sem', { fiado: false });
    await conectarLoja(A);
    await conectarLoja(SEM);

    A.clienteVendedor = await novoCliente(A, 'Cliente do vendedor', A.u.vendedor);
    A.clienteAdmin = await novoCliente(A, 'Cliente do admin', A.u.admin);
    A.clienteCrediario = await novoCliente(A, 'Cliente crediário', A.u.vendedor);
    B.cliente = await novoCliente(B, 'Cliente B', B.u.admin);

    A.produtoId = (await db.query(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 100, 10, 500) RETURNING id`, [A.empresaId, `Produto ${sufixo}`])).rows[0].id;
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [A.empresaId]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) SELECT $1, l.id, $2, 500 FROM locais_estoque l WHERE l.empresa_id = $2 AND l.tipo = 'central'`, [A.produtoId, A.empresaId]);
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`, [A.empresaId, A.produtoId, A.canalId]);
});

afterAll(async () => {
    console.error = logOriginal;
    for (const k of Object.keys(ENV_MP)) { if (envOriginal[k] === undefined) delete process.env[k]; else process.env[k] = envOriginal[k]; }

    try { await registro.limpar(); } finally { await db.end(); }
});

describe('Pix para receber fiado (Colheita)', () => {
    test('Pix pago quita o fiado sozinho, uma vez só (consulta e webhook repetidos)', async () => {
        expect((await compraFiado(A, A.clienteVendedor, 100)).status).toBe(201);

        const criada = await gerarPix(A, 'vendedor', 40, { tipo: 'fiado', cliente_id: A.clienteVendedor });

        expect(criada.status).toBe(201);
        expect(criada.body.data.destino).toEqual({ tipo: 'fiado', aplicado: false, erro: null });
        expect(await saldoFiado(A, A.clienteVendedor)).toBe(100);

        const codigo = criada.body.data.codigo;
        const paga = await pagar(A, 'vendedor', codigo);

        expect(paga.body.data.status).toBe('pago');
        expect(paga.body.data.destino).toEqual({ tipo: 'fiado', aplicado: true, erro: null });
        expect(await saldoFiado(A, A.clienteVendedor)).toBe(60);

        const lancs = (await lancamentos(A, A.clienteVendedor)).filter((l) => l.tipo === 'pagamento');
        expect(lancs).toEqual([{ tipo: 'pagamento', valor: '40.00', forma: 'pix', chave_idempotencia: `pix-${codigo}` }]);

        // repetições: nova consulta e webhook não lançam de novo
        await consultar(A, 'vendedor', codigo);
        const cobranca = await cobrancaDoBanco(codigo);
        expect((await enviarWebhook(cobranca.id_externo)).status).toBe(200);
        expect(await saldoFiado(A, A.clienteVendedor)).toBe(60);
        expect((await lancamentos(A, A.clienteVendedor)).filter((l) => l.tipo === 'pagamento')).toHaveLength(1);
    });

    test('webhook sozinho (sem consulta do operador) também quita', async () => {
        await compraFiado(A, A.clienteVendedor, 50);
        const saldoAntes = await saldoFiado(A, A.clienteVendedor);
        const criada = await gerarPix(A, 'vendedor', 25, { tipo: 'fiado', cliente_id: A.clienteVendedor });
        const cobranca = await cobrancaDoBanco(criada.body.data.codigo);

        client.buscarPagamento.mockResolvedValue(pagamentoMp(cobranca));
        expect((await enviarWebhook(cobranca.id_externo)).status).toBe(200);

        expect(await saldoFiado(A, A.clienteVendedor)).toBe(saldoAntes - 25);
        expect((await cobrancaDoBanco(cobranca.codigo)).destino_aplicado_em).not.toBeNull();
    });

    test('valor maior que a dívida é recusado antes de gerar o QR', async () => {
        client.criarPagamentoPix.mockClear();
        const saldo = await saldoFiado(A, A.clienteVendedor);
        const res = await gerarPix(A, 'vendedor', saldo + 0.01, { tipo: 'fiado', cliente_id: A.clienteVendedor });

        expect(res.status).toBe(409);
        expect(client.criarPagamentoPix).not.toHaveBeenCalled();
    });

    test('escopo: vendedor não gera Pix para cliente de outro; outra empresa = 404; sem o módulo = 403', async () => {
        expect((await gerarPix(A, 'vendedor', 10, { tipo: 'fiado', cliente_id: A.clienteAdmin })).status).toBe(404);
        expect((await gerarPix(A, 'admin', 10, { tipo: 'fiado', cliente_id: B.cliente })).status).toBe(404);
        expect((await gerarPix(SEM, 'admin', 10, { tipo: 'fiado', cliente_id: 1 })).status).toBe(403);
    });

    test('destino inválido é recusado (400)', async () => {
        for (const destino of [{ tipo: 'outro' }, { tipo: 'fiado' }, { tipo: 'fiado', cliente_id: 'x' }, { tipo: 'conta_receber', conta_id: 0 }, { tipo: 'fiado', cliente_id: 1, extra: true }]) {
            expect((await gerarPix(A, 'admin', 10, destino)).status).toBe(400);
        }
    });

    test('saldo mudou antes do pagamento: não aplica, guarda o motivo e a cobrança fica em "a devolver"', async () => {
        const cliente = await novoCliente(A, 'Cliente saldo mudou', A.u.vendedor);
        await compraFiado(A, cliente, 100);
        const criada = await gerarPix(A, 'vendedor', 60, { tipo: 'fiado', cliente_id: cliente });
        expect(criada.status).toBe(201);

        // enquanto o Pix não é pago, o cliente quita 80 por outro meio: saldo 20 < 60
        const manual = await auth(request(app).post(`/fiado/clientes/${cliente}/pagamentos`), A, 'vendedor').set('Idempotency-Key', chave()).send({ valor: 80, forma: 'dinheiro' });
        expect(manual.status).toBe(201);

        const paga = await pagar(A, 'vendedor', criada.body.data.codigo);

        expect(paga.body.data.status).toBe('pago');
        expect(paga.body.data.destino.aplicado).toBe(false);
        expect(paga.body.data.destino.erro).toEqual(expect.any(String));
        expect(await saldoFiado(A, cliente)).toBe(20);

        const aDevolver = await auth(request(app).get('/pagamentos-gateway/a-devolver'), A, 'admin');
        expect(aDevolver.body.data.items.map((i) => i.codigo)).toContain(criada.body.data.codigo);
    });

    test('Pix já aplicado não aparece em "a devolver", não é devolvido e não entra em venda', async () => {
        const cliente = await novoCliente(A, 'Cliente aplicado', A.u.vendedor);
        await compraFiado(A, cliente, 100);
        const criada = await gerarPix(A, 'vendedor', 30, { tipo: 'fiado', cliente_id: cliente });
        const codigo = criada.body.data.codigo;
        await pagar(A, 'vendedor', codigo);

        const aDevolver = await auth(request(app).get('/pagamentos-gateway/a-devolver'), A, 'admin');
        expect(aDevolver.body.data.items.map((i) => i.codigo)).not.toContain(codigo);

        const devolucao = await auth(request(app).post(`/pagamentos-gateway/${codigo}/devolucao`), A, 'admin').send({ motivo: 'teste de devolução' });
        expect(devolucao.status).toBe(409);

        const venda = await auth(request(app).post('/vendas'), A, 'admin').send({
            itens: [{ produto_id: A.produtoId, quantidade: 1 }],
            pagamentos: [{ forma_pagamento: 'pix', valor: 30, cobranca_codigo: codigo }]
        });
        expect([400, 409]).toContain(venda.status);
        expect((await cobrancaDoBanco(codigo)).venda_id).toBeNull();
    });
});

describe('Pix para receber parcela do crediário (conta a receber)', () => {
    test('Pix pago registra o recebimento (parcial) da parcela e a conta segue pendente com o restante', async () => {
        const [c1] = await vendaCrediario();
        const criada = await gerarPix(A, 'admin', 40, { tipo: 'conta_receber', conta_id: c1.id });

        expect(criada.status).toBe(201);

        const codigo = criada.body.data.codigo;
        const paga = await pagar(A, 'admin', codigo);

        expect(paga.body.data.destino).toEqual({ tipo: 'conta_receber', aplicado: true, erro: null });

        const conta = (await auth(request(app).get(`/contas-receber/${c1.id}`), A, 'admin')).body.data;
        expect(conta).toMatchObject({ status: 'pendente', valor_recebido: '40.00', valor_restante: '60.00' });

        // repetir não recebe de novo
        await consultar(A, 'admin', codigo);
        await enviarWebhook((await cobrancaDoBanco(codigo)).id_externo);
        const recebimentos = (await db.query('SELECT valor, forma_pagamento, chave_idempotencia FROM recebimentos_conta WHERE parcela_id = $1', [c1.parcela_id])).rows;
        expect(recebimentos).toEqual([{ valor: '40.00', forma_pagamento: 'pix', chave_idempotencia: `pix-${codigo}` }]);
    });

    test('Pix do restante quita a conta', async () => {
        const [, c2] = await vendaCrediario();
        const criada = await gerarPix(A, 'admin', 100, { tipo: 'conta_receber', conta_id: c2.id });

        await pagar(A, 'admin', criada.body.data.codigo);

        expect((await auth(request(app).get(`/contas-receber/${c2.id}`), A, 'admin')).body.data).toMatchObject({ status: 'recebido', valor_restante: '0.00' });
    });

    test('valor acima do restante é recusado; vendedor não gera (admin only); outra empresa = 404', async () => {
        const [c] = await vendaCrediario();

        expect((await gerarPix(A, 'admin', 100.01, { tipo: 'conta_receber', conta_id: c.id })).status).toBe(409);
        expect((await gerarPix(A, 'vendedor', 10, { tipo: 'conta_receber', conta_id: c.id })).status).toBe(403);
        expect((await gerarPix(B, 'admin', 10, { tipo: 'conta_receber', conta_id: c.id })).status).toBe(404);
    });
});

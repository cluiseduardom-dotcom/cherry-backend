// Integração de verdade (Postgres real; cliente do Mercado Pago SIMULADO, sem rede): devolução de Pix pago.
// Prova RBAC (gerir_financeiro), isolamento por empresa, regras (só Pix pago sem venda ativa), uso único,
// falha do provedor, devolução em processamento e que um Pix em devolução não entra em venda.
// NÃO prova o comportamento do Mercado Pago real (o sandbox não aprova Pix): ver docs/MERCADOPAGO_PIX.md.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

jest.mock('../../src/integrations/mercadoPagoClient', () => {
    const real = jest.requireActual('../../src/integrations/mercadoPagoClient');
    return { ...real, buscarPagamento: jest.fn(), devolverPagamento: jest.fn() };
});

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const client = require('../../src/integrations/mercadoPagoClient');
const AppError = require('../../src/errors/AppError');
const cobrancasService = require('../../src/services/cobrancasPagamentoService');
const { cifrar } = require('../../src/utils/criptografiaToken');
const { criarRegistroDeEmpresas, removerEmpresasPorNome, removerCancelamentosDeTeste } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');
const CHAVE = crypto.randomBytes(32);
const NOME = (rotulo) => `Teste Pix Devolucao ${rotulo} ${SUFIXO}`;

const ENV_MP = {
    MP_APP_ID: '123456',
    MP_CLIENT_SECRET: 'segredo-app-teste',
    MP_REDIRECT_URI: 'https://api.test/integracoes/mercadopago/callback',
    MP_WEBHOOK_SECRET: `wh-${SUFIXO}`,
    MP_WEBHOOK_URL: 'https://api.test/webhooks/mercadopago',
    MP_TOKEN_ENC_KEY: CHAVE.toString('base64'),
    MP_FRONTEND_URL: 'https://front.test'
};
const envOriginal = {};

const empresas = {};

async function criarUsuario(empresaId, papel, rotulo) {
    const email = `pixdev-${rotulo}-${papel}-${SUFIXO}@teste.invalid`;
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [empresaId, `Teste ${papel} ${rotulo}`, email, await bcrypt.hash(SENHA, 4), papel]
    );
    const res = await request(app).post('/auth/login').send({ email, senha: SENHA });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return { id: rows[0].id, token: res.body.data.token };
}

async function criarProduto(token, canalId, nome, preco) {
    const prod = await request(app).post('/produtos').set('Authorization', `Bearer ${token}`)
        .send({ nome, preco_venda: preco, custo: 0.5, estoque_atual: 50, estoque_minimo: 1 });
    if (prod.status !== 201) throw new Error(`produto ${nome}: ${prod.status} ${JSON.stringify(prod.body)}`);
    const id = prod.body.data.id;
    const precoRes = await request(app).put(`/produtos/${id}/precos/${canalId}`).set('Authorization', `Bearer ${token}`).send({ preco_venda: preco });
    if (precoRes.status !== 201) throw new Error(`preço ${nome}: ${precoRes.status} ${JSON.stringify(precoRes.body)}`);
    return id;
}

async function montarEmpresa(rotulo) {
    const emp = await db.query(`INSERT INTO empresas (nome, status, email_contato) VALUES ($1, 'ativa', $2) RETURNING id`, [NOME(rotulo), `loja-${rotulo.toLowerCase()}-${SUFIXO}@teste.invalid`]);
    const id = registro.registrar(emp.rows[0].id);
    const canal = await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [id]);
    const admin = await criarUsuario(id, 'admin', rotulo);
    const vendedor = await criarUsuario(id, 'vendedor', rotulo);
    const produto = await criarProduto(admin.token, canal.rows[0].id, `Produto ${rotulo}`, 120);

    await db.query(
        `INSERT INTO empresa_mercadopago (empresa_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, token_expira_em, ativo, conectado_por)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [id, `mp-${id}-${SUFIXO}`, cifrar(`AT-${id}`, CHAVE), cifrar(`RT-${id}`, CHAVE), new Date(Date.now() + 100 * 24 * 3600 * 1000), admin.id]
    );

    empresas[rotulo] = { id, admin, vendedor, produto };
}

let seq = 800000000 + Math.floor(Math.random() * 1000000);

// Cobrança já paga, como o webhook a deixaria (sem passar pelo Mercado Pago).
async function cobranca(rotulo, { valor = 120, taxa = 0.18, status = 'pago' } = {}) {
    const e = empresas[rotulo];
    const codigo = crypto.randomUUID();
    await db.query(
        `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, taxa_plataforma, status, id_externo, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [codigo, e.id, valor, taxa, status, String(++seq), e.admin.id]
    );
    return codigo;
}

const doBanco = async (codigo) => (await db.query('SELECT * FROM cobrancas_pagamento WHERE codigo = $1', [codigo])).rows[0];
const devolucoesDe = async (codigo) => (await db.query(
    `SELECT d.* FROM cobranca_devolucoes d JOIN cobrancas_pagamento c ON c.id = d.cobranca_id WHERE c.codigo = $1 ORDER BY d.id`, [codigo]
)).rows;

// O que o Mercado Pago "responde" na reconsulta antes de devolver.
async function provedorDiz(codigo, status = 'approved') {
    const c = await doBanco(codigo);
    client.buscarPagamento.mockResolvedValue({
        id: Number(c.id_externo), status, external_reference: c.codigo, transaction_amount: Number(c.valor)
    });
}

const auth = (rotulo, quem = 'admin') => ({ Authorization: `Bearer ${empresas[rotulo][quem].token}` });
const devolver = (rotulo, codigo, corpo = { motivo: 'Cliente desistiu da compra' }, quem = 'admin') =>
    request(app).post(`/pagamentos-gateway/${codigo}/devolucao`).set(auth(rotulo, quem)).send(corpo);

const vender = (rotulo, pagamentos) =>
    request(app).post('/vendas').set(auth(rotulo)).send({
        canal: 'loja_fisica',
        itens: [{ produto_id: empresas[rotulo].produto, quantidade: 1 }],
        pagamentos
    });

beforeAll(async () => {
    for (const k of Object.keys(ENV_MP)) { envOriginal[k] = process.env[k]; process.env[k] = ENV_MP[k]; }
    await montarEmpresa('A');
    await montarEmpresa('B');
});

afterAll(async () => {
    for (const k of Object.keys(ENV_MP)) { if (envOriginal[k] === undefined) delete process.env[k]; else process.env[k] = envOriginal[k]; }
    try {
        for (const id of registro.ids()) {
            await db.query('DELETE FROM cobranca_devolucoes WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM cobrancas_pagamento WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM empresa_mercadopago WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM taxas_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM estornos_pagamento WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM parcelas_pagamento WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM pagamentos_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM idempotency_keys WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM itens_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM movimentacoes_estoque WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM estoque_locais WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM locais_estoque WHERE empresa_id = $1', [id]);
            await removerCancelamentosDeTeste(db, id);
            await db.query('DELETE FROM vendas WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM precos_produto WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM produtos WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM canais_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM empresas WHERE id = $1', [id]);
        }
    } finally {
        try {
            await registro.limpar();
            await removerEmpresasPorNome(db, 'Teste Pix Devolucao % ' + SUFIXO);
        } finally {
            await db.end();
        }
    }
});

beforeEach(() => {
    client.buscarPagamento.mockReset();
    client.devolverPagamento.mockReset();
});

describe('permissão e isolamento', () => {
    test('sem token 401; vendedor sem gerir_financeiro 403 nas três rotas', async () => {
        const codigo = await cobranca('A');

        expect((await request(app).get('/pagamentos-gateway/a-devolver')).status).toBe(401);
        expect((await request(app).get('/pagamentos-gateway/a-devolver').set(auth('A', 'vendedor'))).status).toBe(403);
        expect((await request(app).get('/pagamentos-gateway/devolucoes').set(auth('A', 'vendedor'))).status).toBe(403);
        expect((await devolver('A', codigo, undefined, 'vendedor')).status).toBe(403);
        expect(client.devolverPagamento).not.toHaveBeenCalled();
        expect(await devolucoesDe(codigo)).toHaveLength(0);
    });

    test('outra empresa não vê nem devolve a cobrança (404) e nada é chamado no provedor', async () => {
        const codigo = await cobranca('A');
        const lista = await request(app).get('/pagamentos-gateway/a-devolver').set(auth('B'));

        expect(lista.status).toBe(200);
        expect(lista.body.data.items.find((i) => i.codigo === codigo)).toBeUndefined();

        const res = await devolver('B', codigo);
        expect(res.status).toBe(404);
        expect(client.devolverPagamento).not.toHaveBeenCalled();
        expect((await doBanco(codigo)).status).toBe('pago');
    });

    test('código inválido: 404; motivo ausente ou curto: 400 (nada é chamado)', async () => {
        const codigo = await cobranca('A');

        expect((await devolver('A', 'nao-e-uuid')).status).toBe(404);
        expect((await devolver('A', codigo, {})).status).toBe(400);
        expect((await devolver('A', codigo, { motivo: 'ok' })).status).toBe(400);
        expect((await devolver('A', codigo, { motivo: 'Motivo válido', valor: 1 })).status).toBe(400);
        expect(client.devolverPagamento).not.toHaveBeenCalled();
    });
});

describe('Pix pago sem venda', () => {
    test('aparece em "a devolver" sem expor taxa, ids do provedor ou do banco', async () => {
        const codigo = await cobranca('A', { valor: 77.5 });
        const res = await request(app).get('/pagamentos-gateway/a-devolver').set(auth('A'));

        expect(res.status).toBe(200);

        const item = res.body.data.items.find((i) => i.codigo === codigo);
        expect(item).toMatchObject({ codigo, valor: '77.50', venda_id: null, situacao: 'sem_venda' });
        expect(Object.keys(item).sort()).toEqual(['codigo', 'criado_em', 'situacao', 'valor', 'venda_id']);
        expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    });

    test('devolve: chama o provedor uma vez com chave de idempotência, grava a trilha e a cobrança fica estornada', async () => {
        const codigo = await cobranca('A', { valor: 90 });
        await provedorDiz(codigo);
        client.devolverPagamento.mockResolvedValueOnce({ idExterno: 'R-1', status: 'approved' });

        const res = await devolver('A', codigo, { motivo: '  Cliente desistiu  ' });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ codigo, valor: '90.00', status: 'concluida' });

        const cobrancaAntes = await doBanco(codigo);
        expect(client.devolverPagamento).toHaveBeenCalledTimes(1);
        expect(client.devolverPagamento.mock.calls[0][1]).toEqual({
            accessToken: `AT-${empresas.A.id}`,
            idExterno: cobrancaAntes.id_externo,
            idempotencia: expect.stringMatching(/^devolucao-\d+$/)
        });

        const [devolucao] = await devolucoesDe(codigo);
        expect(devolucao).toMatchObject({
            empresa_id: empresas.A.id, valor: '90.00', status: 'concluida', motivo: 'Cliente desistiu',
            id_externo: 'R-1', solicitado_por: empresas.A.admin.id, erro: null
        });
        expect(cobrancaAntes.status).toBe('estornado');

        const aDevolver = await request(app).get('/pagamentos-gateway/a-devolver').set(auth('A'));
        expect(aDevolver.body.data.items.find((i) => i.codigo === codigo)).toBeUndefined();

        const historico = await request(app).get('/pagamentos-gateway/devolucoes').set(auth('A'));
        expect(historico.body.data.items.find((i) => i.cobranca_codigo === codigo)).toMatchObject({
            valor: '90.00', status: 'concluida', motivo: 'Cliente desistiu', solicitado_por: empresas.A.admin.id
        });
    });

    test('segunda devolução do mesmo Pix: 409 e o provedor não é chamado de novo', async () => {
        const codigo = await cobranca('A');
        await provedorDiz(codigo);
        client.devolverPagamento.mockResolvedValueOnce({ idExterno: 'R-2', status: 'approved' });
        expect((await devolver('A', codigo)).status).toBe(200);

        // Depois de devolvido, o provedor responde "refunded" na reconsulta.
        await provedorDiz(codigo, 'refunded');
        const de_novo = await devolver('A', codigo);

        expect(de_novo.status).toBe(409);
        expect(client.devolverPagamento).toHaveBeenCalledTimes(1);
        expect(await devolucoesDe(codigo)).toHaveLength(1);
    });

    test('já devolvido no painel do Mercado Pago: só reflete (estornado), sem chamar a devolução', async () => {
        const codigo = await cobranca('A');
        await provedorDiz(codigo, 'refunded');

        const res = await devolver('A', codigo);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/já foi devolvido/);
        expect(client.devolverPagamento).not.toHaveBeenCalled();
        expect((await doBanco(codigo)).status).toBe('estornado');
        expect(await devolucoesDe(codigo)).toHaveLength(0);
    });

    test('Pix ainda pendente não é devolvido (409)', async () => {
        const codigo = await cobranca('A', { status: 'pendente' });
        await provedorDiz(codigo, 'pending');

        const res = await devolver('A', codigo);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/foi pago/);
        expect(client.devolverPagamento).not.toHaveBeenCalled();
    });
});

describe('falha e devolução em processamento', () => {
    test('provedor recusa: devolução fica "falhou" (sem expor detalhe), o Pix segue pago e dá para tentar de novo', async () => {
        const codigo = await cobranca('A');
        await provedorDiz(codigo);
        client.devolverPagamento.mockRejectedValueOnce(new AppError('O Mercado Pago recusou a operação.', 424));

        const falha = await devolver('A', codigo);
        expect(falha.status).toBe(424);

        const [primeira] = await devolucoesDe(codigo);
        expect(primeira).toMatchObject({ status: 'falhou', erro: 'O Mercado Pago recusou a operação.' });
        expect((await doBanco(codigo)).status).toBe('pago');

        const lista = await request(app).get('/pagamentos-gateway/a-devolver').set(auth('A'));
        expect(lista.body.data.items.find((i) => i.codigo === codigo)).toBeDefined();

        client.devolverPagamento.mockResolvedValueOnce({ idExterno: 'R-3', status: 'approved' });
        expect((await devolver('A', codigo)).status).toBe(200);

        const todas = await devolucoesDe(codigo);
        expect(todas.map((d) => d.status)).toEqual(['falhou', 'concluida']);
        expect(client.devolverPagamento.mock.calls[0][1].idempotencia).not.toBe(client.devolverPagamento.mock.calls[1][1].idempotencia);
    });

    test('em processamento no provedor: fica "solicitada", bloqueia novo pedido e a consulta seguinte conclui', async () => {
        const codigo = await cobranca('A');
        await provedorDiz(codigo);
        client.devolverPagamento.mockResolvedValueOnce({ idExterno: 'R-4', status: 'in_process' });

        const res = await devolver('A', codigo);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('solicitada');
        expect((await doBanco(codigo)).status).toBe('pago');

        const repetido = await devolver('A', codigo);
        expect(repetido.status).toBe(409);
        expect(repetido.body.message).toMatch(/devolução em andamento/);
        expect(client.devolverPagamento).toHaveBeenCalledTimes(1);

        // O Pix em devolução também não entra em venda.
        const venda = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        expect(venda.status).toBe(409);
        expect(venda.body.message).toMatch(/sendo devolvido/);

        // Webhook/consulta: o provedor passa a informar "refunded".
        await provedorDiz(codigo, 'refunded');
        const c = await doBanco(codigo);
        await cobrancasService.processarNotificacao(c.id_externo);

        expect((await doBanco(codigo)).status).toBe('estornado');
        expect((await devolucoesDe(codigo))[0].status).toBe('concluida');
    });
});

describe('Pix de venda', () => {
    test('venda ativa: não devolve (409) e não aparece em "a devolver"; cancelada: aparece e devolve', async () => {
        const codigo = await cobranca('A', { valor: 120 });
        const venda = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        expect(venda.status).toBe(201);

        await provedorDiz(codigo);

        const ativa = await devolver('A', codigo);
        expect(ativa.status).toBe(409);
        expect(ativa.body.message).toMatch(/venda ativa/);
        expect(client.devolverPagamento).not.toHaveBeenCalled();

        const antes = await request(app).get('/pagamentos-gateway/a-devolver').set(auth('A'));
        expect(antes.body.data.items.find((i) => i.codigo === codigo)).toBeUndefined();

        const cancelada = await request(app).patch(`/vendas/${venda.body.data.id}/cancelar`)
            .set(auth('A')).send({ motivo: 'teste de cancelamento' });
        expect([200, 201]).toContain(cancelada.status);

        const depois = await request(app).get('/pagamentos-gateway/a-devolver').set(auth('A'));
        expect(depois.body.data.items.find((i) => i.codigo === codigo)).toMatchObject({
            situacao: 'venda_cancelada', venda_id: venda.body.data.id
        });

        client.devolverPagamento.mockResolvedValueOnce({ idExterno: 'R-5', status: 'approved' });
        expect((await devolver('A', codigo, { motivo: 'Venda cancelada pelo operador' })).status).toBe(200);
        expect((await doBanco(codigo)).status).toBe('estornado');
    });
});

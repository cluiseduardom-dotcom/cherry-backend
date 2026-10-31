// Integração de verdade (Postgres real): a venda consome a cobrança de LINK DE CARTÃO paga do Mercado Pago.
// Prova que forma de pagamento e parcelas vêm do pagamento confirmado (não do PDV), uso único, empresa e status.
// Cria empresas próprias e remove tudo no afterAll; não chama o Mercado Pago (cobranças inseridas no banco).
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const plataformaService = require('../../src/services/plataformaService');
const { criarRegistroDeEmpresas, removerEmpresasPorNome, removerCancelamentosDeTeste } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');
const NOME = (rotulo) => `Teste Cartao Link ${rotulo} ${SUFIXO}`;

const empresas = {};

async function criarUsuario(empresaId, papel, rotulo) {
    const email = `cartaolink-${rotulo}-${papel}-${SUFIXO}@teste.invalid`;
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
    const emp = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [NOME(rotulo)]);
    const id = registro.registrar(emp.rows[0].id);
    const canal = await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [id]);
    const admin = await criarUsuario(id, 'admin', rotulo);
    const produto = await criarProduto(admin.token, canal.rows[0].id, `Produto ${rotulo}`, 120);
    empresas[rotulo] = { id, admin, produto };
}

let seq = 700000000 + Math.floor(Math.random() * 1000000);

// Cobrança já paga, como o webhook a deixaria (sem passar pelo Mercado Pago).
async function cobrancaCartao(rotulo, { valor = 120, status = 'pago', tipo = 'credito', parcelas = 3 } = {}) {
    const e = empresas[rotulo];
    const codigo = crypto.randomUUID();
    const pago = status === 'pago';
    await db.query(
        `INSERT INTO cobrancas_pagamento
            (codigo, empresa_id, metodo, valor, taxa_plataforma, status, id_externo, criado_por,
             preferencia_id, link_url, tipo_cartao, parcelas, parcelas_maximas)
         VALUES ($1, $2, 'cartao_link', $3, 0, $4, $5, $6, $7, 'https://mp.exemplo/checkout', $8, $9, 12)`,
        [codigo, e.id, valor, status, pago ? String(++seq) : null, e.admin.id, `pref-${codigo}`, pago ? tipo : null, pago ? parcelas : null]
    );
    return codigo;
}

const doBanco = async (codigo) => (await db.query('SELECT * FROM cobrancas_pagamento WHERE codigo = $1', [codigo])).rows[0];

const vender = (rotulo, pagamentos, extra = {}) =>
    request(app).post('/vendas').set('Authorization', `Bearer ${empresas[rotulo].admin.token}`).send({
        canal: 'loja_fisica',
        itens: [{ produto_id: empresas[rotulo].produto, quantidade: 1 }],
        pagamentos,
        ...extra
    });

const estoqueDe = async (produtoId) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual;

beforeAll(async () => {
    await montarEmpresa('A');
    await montarEmpresa('B');
});

afterAll(async () => {
    try {
        for (const id of registro.ids()) {
            await db.query('DELETE FROM cobrancas_pagamento WHERE empresa_id = $1', [id]);
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
            await removerEmpresasPorNome(db, 'Teste Cartao Link % ' + SUFIXO);
        } finally {
            await db.end();
        }
    }
});

describe('venda com link de cartão do Mercado Pago', () => {
    test('crédito 3x: consome a cobrança, grava origem gateway, 3 parcelas e usa a cobrança', async () => {
        const codigo = await cobrancaCartao('A', { tipo: 'credito', parcelas: 3 });
        const res = await vender('A', [{ forma_pagamento: 'credito', valor: 120, numero_parcelas: 3, cobranca_codigo: codigo }]);
        expect(res.status).toBe(201);

        const cobranca = await doBanco(codigo);
        const { rows } = await db.query('SELECT * FROM pagamentos_venda WHERE venda_id = $1', [res.body.data.id]);
        expect(rows[0]).toMatchObject({
            forma_pagamento: 'credito', numero_parcelas: 3, origem: 'gateway', provedor: 'mercadopago',
            transacao_externa_id: cobranca.id_externo, empresa_id: empresas.A.id
        });
        const parcelas = await db.query('SELECT 1 FROM parcelas_pagamento WHERE pagamento_id = $1', [rows[0].id]);
        expect(parcelas.rowCount).toBe(3);
        expect(cobranca.venda_id).toBe(res.body.data.id);
        expect(cobranca.usada_em).not.toBeNull();
    });

    test('débito à vista: consome a cobrança', async () => {
        const codigo = await cobrancaCartao('A', { tipo: 'debito', parcelas: 1 });
        const res = await vender('A', [{ forma_pagamento: 'debito', valor: 120, cobranca_codigo: codigo }]);
        expect(res.status).toBe(201);
        expect((await doBanco(codigo)).venda_id).toBe(res.body.data.id);
    });

    test('a forma de pagamento tem de ser a do cartão confirmado: o PDV não escolhe', async () => {
        const codigo = await cobrancaCartao('A', { tipo: 'credito', parcelas: 3 });
        const comoPix = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        const comoDebito = await vender('A', [{ forma_pagamento: 'debito', valor: 120, cobranca_codigo: codigo }]);
        expect(comoPix.status).toBe(400);
        expect(comoDebito.status).toBe(400);
        expect((await doBanco(codigo)).venda_id).toBeNull();
    });

    test('parcelas diferentes das confirmadas: 400 e a cobrança continua livre', async () => {
        const codigo = await cobrancaCartao('A', { tipo: 'credito', parcelas: 3 });
        const res = await vender('A', [{ forma_pagamento: 'credito', valor: 120, numero_parcelas: 6, cobranca_codigo: codigo }]);
        expect(res.status).toBe(400);
        const semParcelas = await vender('A', [{ forma_pagamento: 'credito', valor: 120, cobranca_codigo: codigo }]);
        expect(semParcelas.status).toBe(400);
        expect((await doBanco(codigo)).venda_id).toBeNull();
    });

    test('link ainda não pago: 409 e a cobrança continua livre', async () => {
        const codigo = await cobrancaCartao('A', { status: 'pendente' });
        const res = await vender('A', [{ forma_pagamento: 'credito', valor: 120, numero_parcelas: 1, cobranca_codigo: codigo }]);
        expect(res.status).toBe(409);
        expect((await doBanco(codigo)).venda_id).toBeNull();
    });

    test('valor diferente do da cobrança: 400', async () => {
        const codigo = await cobrancaCartao('A', { valor: 120, tipo: 'debito', parcelas: 1 });
        const res = await vender('A', [{ forma_pagamento: 'debito', valor: 100, cobranca_codigo: codigo }, { forma_pagamento: 'dinheiro', valor: 20 }]);
        expect(res.status).toBe(400);
        expect((await doBanco(codigo)).venda_id).toBeNull();
    });

    test('mesma cobrança não entra em duas vendas e outra empresa não a enxerga', async () => {
        const codigo = await cobrancaCartao('A', { tipo: 'debito', parcelas: 1 });
        const deOutra = await vender('B', [{ forma_pagamento: 'debito', valor: 120, cobranca_codigo: codigo }]);
        expect(deOutra.status).toBe(404);

        expect((await vender('A', [{ forma_pagamento: 'debito', valor: 120, cobranca_codigo: codigo }])).status).toBe(201);
        expect((await vender('A', [{ forma_pagamento: 'debito', valor: 120, cobranca_codigo: codigo }])).status).toBe(409);
    });

    test('cobranca_codigo não vale para dinheiro nem crediário', async () => {
        const codigo = await cobrancaCartao('A');
        expect((await vender('A', [{ forma_pagamento: 'dinheiro', valor: 120, cobranca_codigo: codigo }])).status).toBe(400);
    });

    test('cobrança Pix não vale como cartão', async () => {
        const e = empresas.A;
        const codigo = crypto.randomUUID();
        await db.query(
            `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, taxa_plataforma, status, id_externo, criado_por)
             VALUES ($1, $2, 120, 0.18, 'pago', $3, $4)`,
            [codigo, e.id, String(++seq), e.admin.id]
        );
        const res = await vender('A', [{ forma_pagamento: 'credito', valor: 120, numero_parcelas: 1, cobranca_codigo: codigo }]);
        expect(res.status).toBe(400);
    });

    test('venda só no cartão não gera taxa da plataforma (base Pix = 0)', async () => {
        const codigo = await cobrancaCartao('A', { tipo: 'debito', parcelas: 1 });
        const res = await vender('A', [{ forma_pagamento: 'debito', valor: 120, cobranca_codigo: codigo }]);
        expect(res.status).toBe(201);
        const { rows } = await db.query('SELECT base_calculo, valor FROM taxas_venda WHERE venda_id = $1', [res.body.data.id]);
        expect(rows[0]).toMatchObject({ base_calculo: '0.00', valor: '0.00' });
    });
});

describe('link de cartão não entra no fluxo de devolução de Pix', () => {
    test('não aparece em "Pix a devolver" e a devolução é recusada (409)', async () => {
        const codigo = await cobrancaCartao('A', { tipo: 'credito', parcelas: 2 });

        const lista = await request(app).get('/pagamentos-gateway/a-devolver').set('Authorization', `Bearer ${empresas.A.admin.token}`);
        expect(lista.status).toBe(200);
        expect(JSON.stringify(lista.body)).not.toContain(codigo);

        const devolucao = await request(app).post(`/pagamentos-gateway/${codigo}/devolucao`)
            .set('Authorization', `Bearer ${empresas.A.admin.token}`).send({ motivo: 'teste de devolução' });
        expect(devolucao.status).toBe(409);
        expect(devolucao.body.message).toMatch(/cartão/);
    });
});

describe('POST /pagamentos-gateway/cartao', () => {
    test.each([[{ valor: 0 }], [{ valor: -5 }], [{ valor: 10.123 }], [{ valor: 10, extra: 1 }], [{}]])('corpo inválido %j: 400', async (corpo) => {
        const res = await request(app).post('/pagamentos-gateway/cartao').set('Authorization', `Bearer ${empresas.A.admin.token}`).send(corpo);
        expect(res.status).toBe(400);
    });

    test('exige autenticação', async () => {
        expect((await request(app).post('/pagamentos-gateway/cartao').send({ valor: 10 })).status).toBe(401);
    });
});

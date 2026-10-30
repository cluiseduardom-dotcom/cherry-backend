// Integração de verdade (Postgres real): a venda consome a cobrança Pix paga do Mercado Pago.
// Prova empresa/status/valor/uso único dentro da transação da venda, a origem "gateway" gravada
// só pelo backend e o abatimento da comissão já retida em "taxas a receber" (/plataforma/taxas).
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
const NOME = (rotulo) => `Teste Pix Gateway ${rotulo} ${SUFIXO}`;

const empresas = {};

async function criarUsuario(empresaId, papel, rotulo) {
    const email = `pixgw-${rotulo}-${papel}-${SUFIXO}@teste.invalid`;
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
            await removerEmpresasPorNome(db, 'Teste Pix Gateway % ' + SUFIXO);
        } finally {
            await db.end();
        }
    }
});

describe('venda com Pix cobrado pelo Mercado Pago', () => {
    test('consome a cobrança paga: pagamento nasce gateway/mercadopago e a cobrança fica usada', async () => {
        const codigo = await cobranca('A');
        const res = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        expect(res.status).toBe(201);

        const antes = await doBanco(codigo);
        const { rows } = await db.query('SELECT * FROM pagamentos_venda WHERE venda_id = $1', [res.body.data.id]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            forma_pagamento: 'pix', status: 'pago', origem: 'gateway', provedor: 'mercadopago',
            transacao_externa_id: antes.id_externo, empresa_id: empresas.A.id
        });
        expect(antes.venda_id).toBe(res.body.data.id);
        expect(antes.usada_em).not.toBeNull();
    });

    test('a mesma cobrança não entra em uma segunda venda (409) e a venda não é criada', async () => {
        const codigo = await cobranca('A');
        expect((await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }])).status).toBe(201);

        const estoque = await estoqueDe(empresas.A.produto);
        const res = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/já foi usada/);
        expect(await estoqueDe(empresas.A.produto)).toBe(estoque);
    });

    test('cobrança ainda pendente: 409, a venda inteira é desfeita e a cobrança continua livre', async () => {
        const codigo = await cobranca('A', { status: 'pendente' });
        const estoque = await estoqueDe(empresas.A.produto);
        const res = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/ainda não foi confirmado/);
        expect(await estoqueDe(empresas.A.produto)).toBe(estoque);
        expect((await doBanco(codigo)).venda_id).toBeNull();
    });

    test('valor diferente do da cobrança: 400 e a cobrança continua livre', async () => {
        const codigo = await cobranca('A', { valor: 100, taxa: 0.15 });
        const res = await vender('A', [
            { forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }
        ]);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/não confere/);
        expect((await doBanco(codigo)).venda_id).toBeNull();
    });

    test('cobrança de outra empresa ou inexistente: 404', async () => {
        const deB = await cobranca('B');
        const cruzada = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: deB }]);
        expect(cruzada.status).toBe(404);
        expect((await doBanco(deB)).venda_id).toBeNull();

        const inexistente = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: crypto.randomUUID() }]);
        expect(inexistente.status).toBe(404);
    });

    test('cobranca_codigo só vale para Pix, deve ser UUID e não pode repetir na mesma venda', async () => {
        const codigo = await cobranca('A');
        const naoPix = await vender('A', [{ forma_pagamento: 'dinheiro', valor: 120, cobranca_codigo: codigo }]);
        expect(naoPix.status).toBe(400);

        const invalido = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: 'abc' }]);
        expect(invalido.status).toBe(400);

        const repetido = await vender('A', [
            { forma_pagamento: 'pix', valor: 60, cobranca_codigo: codigo },
            { forma_pagamento: 'pix', valor: 60, cobranca_codigo: codigo }
        ]);
        expect(repetido.status).toBe(400);
        expect((await doBanco(codigo)).venda_id).toBeNull();
    });

    test('o cliente não consegue declarar origem/provedor: Pix sem cobrança segue manual', async () => {
        const manual = await vender('A', [{ forma_pagamento: 'pix', valor: 120 }]);
        expect(manual.status).toBe(201);
        const { rows } = await db.query('SELECT origem, provedor, transacao_externa_id FROM pagamentos_venda WHERE venda_id = $1', [manual.body.data.id]);
        expect(rows[0]).toEqual({ origem: 'manual', provedor: null, transacao_externa_id: null });

        const forjado = await vender('A', [{ forma_pagamento: 'pix', valor: 120, origem: 'gateway', provedor: 'mercadopago' }]);
        expect(forjado.status).toBe(400);
    });

    test('Pix do gateway + dinheiro na mesma venda', async () => {
        const codigo = await cobranca('A', { valor: 70, taxa: 0.1 });
        const res = await vender('A', [
            { forma_pagamento: 'pix', valor: 70, cobranca_codigo: codigo },
            { forma_pagamento: 'dinheiro', valor: 50 }
        ]);
        expect(res.status).toBe(201);
        const { rows } = await db.query('SELECT forma_pagamento, origem FROM pagamentos_venda WHERE venda_id = $1 ORDER BY id', [res.body.data.id]);
        expect(rows).toEqual([
            { forma_pagamento: 'pix', origem: 'gateway' },
            { forma_pagamento: 'dinheiro', origem: 'manual' }
        ]);
    });

    test('a resposta da venda não expõe a taxa da plataforma', async () => {
        const codigo = await cobranca('A');
        const res = await vender('A', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        expect(res.status).toBe(201);
        expect(JSON.stringify(res.body)).not.toMatch(/taxa_plataforma|taxas_venda/);
    });
});

describe('taxas a receber abatem a comissão já retida pelo Mercado Pago', () => {
    async function linhaDoMes(rotulo) {
        const { items } = await plataformaService.taxasPorEmpresa();
        return items.find((i) => i.empresa_id === empresas[rotulo].id);
    }

    test('Pix lançado manualmente (sem gateway): nada abatido, a taxa inteira fica a receber', async () => {
        await montarEmpresa('C');
        const venda = await vender('C', [{ forma_pagamento: 'pix', valor: 120 }]);
        expect(venda.status).toBe(201);
        expect(await linhaDoMes('C')).toMatchObject({ total_taxa: '0.18', total_cobrado_gateway: '0.00', total_a_receber: '0.18' });
    });

    test('venda sem Pix (dinheiro): a taxa da plataforma é zero e nada fica a receber', async () => {
        await montarEmpresa('G');
        const venda = await vender('G', [{ forma_pagamento: 'dinheiro', valor: 120 }]);
        expect(venda.status).toBe(201);
        expect(await linhaDoMes('G')).toMatchObject({ total_base: '0.00', total_taxa: '0.00', total_cobrado_gateway: '0.00', total_a_receber: '0.00' });
    });

    test('Pix integral no gateway: a taxa da venda já foi retida, a receber zera', async () => {
        await montarEmpresa('D');
        const codigo = await cobranca('D', { valor: 120, taxa: 0.18 });
        expect((await vender('D', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }])).status).toBe(201);
        expect(await linhaDoMes('D')).toMatchObject({ total_taxa: '0.18', total_cobrado_gateway: '0.18', total_a_receber: '0.00' });
    });

    test('venda mista (Pix no gateway + dinheiro): a taxa incide só no Pix, já retido, e nada fica a receber', async () => {
        await montarEmpresa('E');
        const codigo = await cobranca('E', { valor: 60, taxa: 0.09 });
        const res = await vender('E', [
            { forma_pagamento: 'pix', valor: 60, cobranca_codigo: codigo },
            { forma_pagamento: 'dinheiro', valor: 60 }
        ]);
        expect(res.status).toBe(201);
        expect(await linhaDoMes('E')).toMatchObject({ total_base: '60.00', total_taxa: '0.09', total_cobrado_gateway: '0.09', total_a_receber: '0.00' });
    });

    test('venda cancelada sai do a receber e do abatimento (a taxa estorna)', async () => {
        await montarEmpresa('F');
        const codigo = await cobranca('F', { valor: 120, taxa: 0.18 });
        const venda = await vender('F', [{ forma_pagamento: 'pix', valor: 120, cobranca_codigo: codigo }]);
        expect(venda.status).toBe(201);

        const cancelada = await request(app).patch(`/vendas/${venda.body.data.id}/cancelar`)
            .set('Authorization', `Bearer ${empresas.F.admin.token}`).send({ motivo: 'teste de cancelamento' });
        expect([200, 201]).toContain(cancelada.status);

        expect(await linhaDoMes('F')).toMatchObject({ total_taxa: '0.00', total_cobrado_gateway: '0.00', total_a_receber: '0.00', qtd_estornadas: 1 });
    });
});

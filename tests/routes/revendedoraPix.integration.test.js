// Integração de verdade (Postgres de testes): a REVENDEDORA vende com Pix cobrado pelo Mercado Pago. Prova: (1) vendedora com
// estoque próprio (maleta) vende com a cobrança Pix paga: a peça sai da maleta (não do Central), o pagamento nasce
// gateway/mercadopago e a comissão é dela; (2) a cobrança é de quem a criou: outra vendedora da mesma empresa não a consulta
// (404) nem a usa em venda (403); admin e quem gere o financeiro podem; (3) a venda recusada não grava nada e a cobrança
// continua livre. O Mercado Pago não é chamado: a cobrança é inserida já paga, como o webhook a deixaria.
// Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const E = { u: {}, maleta: {}, cliente: {} };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const token = (quem) => ({ Authorization: `Bearer ${makeToken({ id: E.u[quem], role: quem === 'admin' ? 'admin' : 'vendedor', empresa_id: E.id, tv: 0 })}` });
let seq = 800000000 + Math.floor(Math.random() * 1000000);

// Cobrança Pix já paga, criada por `quem` (criado_por).
async function cobranca(quem, valor = 100) {
    const codigo = crypto.randomUUID();

    await db.query(
        `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, taxa_plataforma, status, id_externo, criado_por) VALUES ($1, $2, $3, 0.15, 'pago', $4, $5)`,
        [codigo, E.id, valor, String(++seq), E.u[quem]]
    );

    return codigo;
}

const vender = (quem, codigo, valor = 100) => request(app).post('/vendas').set(token(quem)).send({
    canal: 'loja_fisica',
    ...(E.cliente[quem] ? { cliente_id: E.cliente[quem] } : {}),
    itens: [{ produto_id: E.produto, quantidade: 1 }],
    pagamentos: [{ forma_pagamento: 'pix', valor, cobranca_codigo: codigo }]
});

const saldo = async (localId) => (await db.query('SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2', [E.produto, localId])).rows[0].saldo;
const daCobranca = async (codigo) => (await db.query('SELECT venda_id, usada_em FROM cobrancas_pagamento WHERE codigo = $1', [codigo])).rows[0];

beforeAll(async () => {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Revendedora Pix ${sufixo}`]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [E.id]);

    for (const papel of ['admin', 'ana', 'bia']) {
        E.u[papel] = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
            [E.id, `Teste ${papel}`, `${papel}-${E.id}-${sufixo}@teste.invalid`, papel === 'admin' ? 'admin' : 'vendedor']);
    }

    await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [E.id]);

    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    E.produto = await um(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'Anel', 100, 10, 30) RETURNING id`, [E.id]);
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`, [E.id, E.produto, E.canal]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 20)`, [E.produto, E.central, E.id]);

    for (const quem of ['ana', 'bia']) {
        E.maleta[quem] = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', $2, $3) RETURNING id`, [E.id, `Maleta de ${quem}`, E.u[quem]]);
        await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 5)`, [E.produto, E.maleta[quem], E.id]);
        E.cliente[quem] = await um(`INSERT INTO clientes (empresa_id, nome, telefone, criado_por) VALUES ($1, $2, '(11) 91234-5678', $3) RETURNING id`, [E.id, `Cliente da ${quem}`, E.u[quem]]);
    }
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('a revendedora vende com a cobrança Pix dela', () => {
    test('a peça sai da maleta dela, o pagamento é do gateway e a comissão é dela', async () => {
        const codigo = await cobranca('ana');
        const res = await vender('ana', codigo);

        expect(res.status).toBe(201);
        expect(res.body.data.itens[0].local_id).toBe(E.maleta.ana);
        expect(await saldo(E.maleta.ana)).toBe(4);
        expect(await saldo(E.central)).toBe(20);
        expect(await saldo(E.maleta.bia)).toBe(5);

        const { rows: [pag] } = await db.query('SELECT forma_pagamento, status, origem, provedor FROM pagamentos_venda WHERE venda_id = $1', [res.body.data.id]);

        expect(pag).toEqual({ forma_pagamento: 'pix', status: 'pago', origem: 'gateway', provedor: 'mercadopago' });
        expect((await daCobranca(codigo)).venda_id).toBe(res.body.data.id);

        const { rows: [com] } = await db.query('SELECT usuario_id, valor, valor_liberado, status FROM comissoes_venda WHERE venda_id = $1', [res.body.data.id]);

        expect(com.usuario_id).toBe(E.u.ana);
        expect(Number(com.valor)).toBe(10);
        expect(Number(com.valor_liberado)).toBe(10);
    });

    test('a resposta da venda não traz custo, margem nem a taxa da plataforma', async () => {
        const res = await vender('ana', await cobranca('ana'));
        const texto = JSON.stringify(res.body);

        expect(res.status).toBe(201);
        expect(texto).not.toMatch(/custo|margem|lucro|taxa_plataforma|taxa/i);
    });
});

describe('a cobrança é de quem a criou', () => {
    test('outra vendedora da mesma empresa não consulta a cobrança (404) e a dona e o admin consultam', async () => {
        const codigo = await cobranca('ana');

        expect((await request(app).get(`/pagamentos-gateway/${codigo}`).set(token('bia'))).status).toBe(404);
        expect((await request(app).get(`/pagamentos-gateway/${codigo}`).set(token('ana'))).status).toBe(200);
        expect((await request(app).get(`/pagamentos-gateway/${codigo}`).set(token('admin'))).status).toBe(200);
    });

    test('outra vendedora não usa a cobrança numa venda (403): nada é gravado e a cobrança continua livre', async () => {
        const codigo = await cobranca('ana');
        const antesBia = await saldo(E.maleta.bia);
        const vendasAntes = Number((await db.query('SELECT COUNT(*)::int AS n FROM vendas WHERE empresa_id = $1', [E.id])).rows[0].n);

        const res = await vender('bia', codigo);

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/criada por outro usuário/);
        expect(await saldo(E.maleta.bia)).toBe(antesBia);
        expect(Number((await db.query('SELECT COUNT(*)::int AS n FROM vendas WHERE empresa_id = $1', [E.id])).rows[0].n)).toBe(vendasAntes);
        expect((await daCobranca(codigo)).venda_id).toBeNull();

        // A dona ainda consegue usar a mesma cobrança.
        expect((await vender('ana', codigo)).status).toBe(201);
    });

    test('o admin pode usar a cobrança de uma vendedora (ex.: ela pediu ajuda para lançar a venda)', async () => {
        const codigo = await cobranca('bia');
        const res = await vender('admin', codigo);

        expect(res.status).toBe(201);
        expect((await daCobranca(codigo)).venda_id).toBe(res.body.data.id);
    });

    test('cobrança sem dono (criada pela loja online) não é afetada pela regra', async () => {
        const codigo = crypto.randomUUID();

        await db.query(`INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, taxa_plataforma, status, id_externo, criado_por) VALUES ($1, $2, 100, 0, 'pago', $3, NULL)`, [codigo, E.id, String(++seq)]);

        expect((await request(app).get(`/pagamentos-gateway/${codigo}`).set(token('bia'))).status).toBe(200);
    });
});

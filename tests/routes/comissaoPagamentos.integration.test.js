// Integração de verdade (Postgres da CI/dev): migration 062 + vendas reais + pagamento de comissão
// ao vendedor. Prova que só admin paga, que o valor é conferido sob trava (tela desatualizada = 409),
// que estorno depois de pago vira desconto no pagamento seguinte, que dois pagamentos simultâneos
// não pagam em dobro, o isolamento entre empresas e a imutabilidade. Empresas e usuários
// próprios e temporários; remove tudo no fim.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const A = { u: {} };
const B = { u: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ComissaoPag ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, papel, rotulo = papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[rotulo] = rows[0].id;
}

const ligarCargo = (alvo, cargo, nivel, capacidades) => db.query(
    `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (empresa_id, cargo) DO UPDATE SET nivel = $3, ativo = true, capacidades = $4`,
    [alvo.empresaId, cargo, nivel, capacidades]
);

async function criarProduto(alvo, preco = 100) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, $3, 10, 500) RETURNING id`,
        [alvo.empresaId, `Produto ${sufixo}`, preco]
    );
    // Estoque por local: o saldo inserido direto precisa existir também no Central.
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [alvo.empresaId]);
    await db.query(
        `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
         SELECT $1, l.id, $2, 500 FROM locais_estoque l WHERE l.empresa_id = $2 AND l.tipo = 'central'`,
        [rows[0].id, alvo.empresaId]
    );
    await db.query(
        `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 900, 90)`,
        [alvo.empresaId, rows[0].id, alvo.canalId, preco]
    );

    return rows[0].id;
}

// O JWT diz sempre "vendedor" de propósito: quem vale é o banco.
const auth = (alvo, rotulo) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[rotulo], role: 'vendedor', empresa_id: alvo.empresaId, tv: 0 })}` });

const vender = (alvo, rotulo, corpo) =>
    request(app).post('/vendas').set(auth(alvo, rotulo)).send({ itens: [{ produto_id: alvo.produtoId, quantidade: 1 }], ...corpo });

const comissaoDaVenda = async (vendaId) => (await db.query('SELECT * FROM comissoes_venda WHERE venda_id = $1', [vendaId])).rows[0];
const eventosDaComissao = async (comissaoId) => (await db.query('SELECT * FROM comissoes_eventos WHERE comissao_id = $1 ORDER BY id', [comissaoId])).rows;
const repassesDaVenda = async (vendaId) => (await db.query('SELECT * FROM comissao_repasses WHERE venda_id = $1 ORDER BY id', [vendaId])).rows;

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    for (const papel of ['admin', 'gerente', 'vendedor']) await criarUsuario(A, papel);
    await criarUsuario(A, 'vendedor', 'vendedor2');
    await criarUsuario(B, 'gerente');
    await criarUsuario(B, 'vendedor');

    // Gerente vem desligado por padrão: a empresa liga e ele passa a ver a equipe.
    await ligarCargo(A, 'gerente', 70, ['ver_vendas_de_todos']);
    await ligarCargo(B, 'gerente', 70, ['ver_vendas_de_todos']);

    for (const alvo of [A, B]) {
        await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [alvo.empresaId]);
        alvo.produtoId = await criarProduto(alvo, 100);
        alvo.clienteId = (await db.query(`INSERT INTO clientes (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [alvo.empresaId, `Cliente ${sufixo}`])).rows[0].id;
    }
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});


const pagar = (alvo, quem, corpo) => request(app).post('/comissoes/pagamentos').set(auth(alvo, quem)).send(corpo);
const aPagar = (alvo, quem) => request(app).get('/comissoes/a-pagar').set(auth(alvo, quem));
const hoje = () => new Date().toISOString().slice(0, 10);
const pagamento = (vendedor, valor, extra = {}) => ({ vendedor_id: A.u[vendedor], valor_esperado: valor, forma: 'pix', pago_em: hoje(), ...extra });
const linhaDo = (res, vendedor) => res.body.data.items.find((i) => i.vendedor_id === A.u[vendedor]);
// Produto custa 100: valor 200 = 2 unidades.
const venderPix = (rotulo, valor = 100) => vender(A, rotulo, { itens: [{ produto_id: A.produtoId, quantidade: valor / 100 }], pagamentos: [{ forma_pagamento: 'pix', valor }] });

describe('permissões e validação', () => {
    test('só admin vê o que há a pagar e registra pagamento; vendedor e gerente = 403', async () => {
        await venderPix('vendedor');

        for (const quem of ['vendedor', 'gerente']) {
            expect((await aPagar(A, quem)).status).toBe(403);
            expect((await pagar(A, quem, pagamento('vendedor', 10))).status).toBe(403);
        }
        expect((await aPagar(A, 'admin')).status).toBe(200);
    });

    test.each([
        ['forma inválida', { forma: 'cripto' }],
        ['data futura', { pago_em: '2999-01-01' }],
        ['valor zero', { valor_esperado: 0 }],
        ['valor com 3 casas', { valor_esperado: 10.005 }],
        ['campo extra (empresa_id do cliente)', { empresa_id: 1 }],
        ['observação enorme', { observacao: 'x'.repeat(301) }]
    ])('400 para %s', async (_, extra) => {
        const res = await pagar(A, 'admin', { ...pagamento('vendedor', 10), ...extra });

        expect(res.status).toBe(400);
        expect((await db.query('SELECT 1 FROM comissao_pagamentos WHERE empresa_id = $1', [A.empresaId])).rows.length).toBe(0);
    });

    test('ninguém paga a própria comissão (403)', async () => {
        const res = await pagar(A, 'admin', { ...pagamento('admin', 10) });

        expect(res.status).toBe(403);
    });
});

describe('pagamento de ponta a ponta (vendedor)', () => {
    let vendaId;

    test('a comissão liberada aparece em "a pagar"; só líquido liberado conta (pendente não)', async () => {
        const pendente = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100, valor_recebido: 100 }] });
        expect(pendente.status).toBe(201);

        const res = await aPagar(A, 'admin');

        // Já havia 10,00 liberados da venda PIX do teste anterior; o dinheiro (repasse a confirmar) não entra.
        expect(linhaDo(res, 'vendedor')).toMatchObject({ a_pagar: '10.00', bruto_a_pagar: '10.00', descontos: '0.00', quantidade_comissoes: 1 });
        expect(res.body.data.totais.a_pagar).toBe('10.00');
    });

    test('valor da tela diferente do atual = 409 e nada é gravado', async () => {
        const res = await pagar(A, 'admin', pagamento('vendedor', 25));

        expect(res.status).toBe(409);
        expect((await db.query('SELECT 1 FROM comissao_pagamentos WHERE empresa_id = $1', [A.empresaId])).rows.length).toBe(0);
    });

    test('admin paga: grava pagamento + itens, zera o a pagar e o vendedor vê pago', async () => {
        const res = await pagar(A, 'admin', pagamento('vendedor', 10, { forma: 'pix', observacao: 'Pix de outubro' }));

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ valor: '10.00', forma: 'pix', pago_em: hoje(), criado_por: A.u.admin, quantidade_comissoes: 1 });

        const itens = (await db.query('SELECT valor FROM comissao_pagamento_itens WHERE pagamento_id = $1', [res.body.data.id])).rows;
        expect(itens.map((i) => i.valor)).toEqual(['10.00']);

        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toBeUndefined();

        const minhas = await request(app).get('/comissoes/minhas').set(auth(A, 'vendedor'));
        expect(minhas.body.data.totais).toMatchObject({ total_liberado: '10.00', total_pago: '10.00', a_receber: '0.00' });
        expect(minhas.body.data.items.find((i) => i.valor_pago === '10.00')).toBeDefined();
    });

    test('pagar de novo (duplo clique) = 409', async () => {
        expect((await pagar(A, 'admin', pagamento('vendedor', 10))).status).toBe(409);
    });

    test('histórico: admin vê todos, vendedor só os seus (filtro de outro vendedor é ignorado)', async () => {
        const admin = await request(app).get('/comissoes/pagamentos').set(auth(A, 'admin'));
        expect(admin.body.data.items).toHaveLength(1);
        expect(admin.body.data.items[0]).toMatchObject({ vendedor_nome: `vendedor ${sufixo}`, valor: '10.00', criado_por_nome: `admin ${sufixo}` });
        expect(admin.body.data.items[0].itens).toHaveLength(1);

        const proprio = await request(app).get(`/comissoes/pagamentos?vendedor_id=${A.u.vendedor2}`).set(auth(A, 'vendedor'));
        expect(proprio.body.data.items.every((p) => p.vendedor_id === A.u.vendedor)).toBe(true);
        expect(proprio.body.data.total).toBe(1);

        const outro = await request(app).get('/comissoes/pagamentos').set(auth(A, 'vendedor2'));
        expect(outro.body.data.items).toHaveLength(0);
    });

    test('venda cancelada DEPOIS de paga vira desconto: nada a pagar até cobrir, depois paga só o líquido', async () => {
        const [{ id: comissaoId, venda_id }] = (await db.query(
            `SELECT c.id, c.venda_id FROM comissoes_venda c WHERE c.empresa_id = $1 AND c.usuario_id = $2 AND c.valor_liberado = 10 ORDER BY c.id LIMIT 1`,
            [A.empresaId, A.u.vendedor]
        )).rows;
        vendaId = venda_id;

        const cancelamento = await request(app).patch(`/vendas/${vendaId}/cancelar`).set(auth(A, 'admin')).send({ motivo: 'Cliente devolveu tudo' });
        expect(cancelamento.status).toBeLessThan(300);

        const resumo = linhaDo(await aPagar(A, 'admin'), 'vendedor');
        expect(resumo).toMatchObject({ a_pagar: '-10.00', bruto_a_pagar: '0.00', descontos: '-10.00' });

        // Nova venda de 100 (10 de comissão) só cobre o desconto: líquido 0 = nada a pagar.
        await venderPix('vendedor', 100);
        expect((await pagar(A, 'admin', pagamento('vendedor', 10))).status).toBe(409);

        // Outra venda de 200 (20): líquido = 20 + 10 - 10 = 20.
        await venderPix('vendedor', 200);
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '20.00', bruto_a_pagar: '30.00', descontos: '-10.00' });

        const res = await pagar(A, 'admin', pagamento('vendedor', 20, { forma: 'transferencia' }));
        expect(res.status).toBe(201);

        const itens = (await db.query('SELECT comissao_id, valor FROM comissao_pagamento_itens WHERE pagamento_id = $1 ORDER BY valor', [res.body.data.id])).rows;
        expect(itens.map((i) => i.valor)).toEqual(['-10.00', '10.00', '20.00']);
        expect(itens.find((i) => i.valor === '-10.00').comissao_id).toBe(comissaoId);
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toBeUndefined();
    });
});

describe('concorrência', () => {
    test('oito pagamentos simultâneos do mesmo valor: exatamente um é gravado', async () => {
        await venderPix('vendedor2', 100);

        const respostas = await Promise.all(Array.from({ length: 8 }, () => pagar(A, 'admin', pagamento('vendedor2', 10))));

        expect(respostas.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM comissao_pagamentos WHERE vendedor_id = $1', [A.u.vendedor2])).rows[0].n).toBe(1);
    });
});

describe('isolamento entre empresas e imutabilidade', () => {
    test('admin de A não paga vendedor de B (404) e não vê B no a pagar', async () => {
        await criarUsuario(B, 'admin');
        await vender(B, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });

        const res = await request(app).post('/comissoes/pagamentos').set(auth(A, 'admin'))
            .send({ vendedor_id: B.u.vendedor, valor_esperado: 10, forma: 'pix', pago_em: hoje() });
        expect(res.status).toBe(404);

        expect((await aPagar(A, 'admin')).body.data.items.some((i) => i.vendedor_id === B.u.vendedor)).toBe(false);
        expect((await aPagar(B, 'admin')).body.data.items.some((i) => i.vendedor_id === B.u.vendedor)).toBe(true);
    });

    test('pagamento e itens são imutáveis; admin não paga a si mesmo nem por SQL', async () => {
        const { rows: [p] } = await db.query('SELECT id FROM comissao_pagamentos WHERE empresa_id = $1 LIMIT 1', [A.empresaId]);

        await expect(db.query('UPDATE comissao_pagamentos SET valor = 1 WHERE id = $1', [p.id])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query('DELETE FROM comissao_pagamentos WHERE id = $1', [p.id])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query('DELETE FROM comissao_pagamento_itens WHERE pagamento_id = $1', [p.id])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query(
            `INSERT INTO comissao_pagamentos (empresa_id, vendedor_id, valor, forma, pago_em, criado_por) VALUES ($1, $2, 1, 'pix', CURRENT_DATE, $2)`,
            [A.empresaId, A.u.vendedor]
        )).rejects.toMatchObject({ code: '23514' });
    });

    test('item de pagamento não aponta para comissão de outra empresa (FK composta)', async () => {
        const { rows: [p] } = await db.query('SELECT id FROM comissao_pagamentos WHERE empresa_id = $1 LIMIT 1', [A.empresaId]);
        const { rows: [c] } = await db.query('SELECT id FROM comissoes_venda WHERE empresa_id = $1 LIMIT 1', [B.empresaId]);

        await expect(db.query(
            `INSERT INTO comissao_pagamento_itens (empresa_id, pagamento_id, comissao_id, valor) VALUES ($1, $2, $3, 1)`,
            [A.empresaId, p.id, c.id]
        )).rejects.toMatchObject({ code: '23503' });
    });
});

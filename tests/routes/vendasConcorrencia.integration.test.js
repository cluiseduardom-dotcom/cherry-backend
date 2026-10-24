// Integração de verdade (Postgres da CI/dev): concorrência de POST /vendas.
//  1) Pool: a venda não pode pedir uma 2ª conexão do pool enquanto segura a da transação; com
//     mais vendas simultâneas que conexões (pool padrão = 10) o servidor travava para sempre.
//  2) Deadlock: duas vendas com os MESMOS produtos em ordem inversa travavam uma à outra.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

jest.setTimeout(60000);

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const A = { usuarios: [], produtos: [] };

async function criarProduto(estoque) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 100, 10, $3) RETURNING id`,
        [A.empresaId, `Produto ${sufixo}`, estoque]
    );
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [rows[0].id, A.centralId, A.empresaId, estoque]);
    await db.query(
        `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`,
        [A.empresaId, rows[0].id, A.canalId]
    );
    return rows[0].id;
}

const vender = (usuarioId, itens) =>
    request(app).post('/vendas')
        .set({ Authorization: `Bearer ${makeToken({ id: usuarioId, role: 'vendedor', empresa_id: A.empresaId, tv: 0 })}` })
        .send({ itens, pagamentos: [{ forma_pagamento: 'pix', valor: 100 * itens.reduce((a, i) => a + i.quantidade, 0) }] });

beforeAll(async () => {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste VendasConc ${sufixo}`]);
    A.empresaId = registro.registrar(rows[0].id);
    A.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [A.empresaId])).rows[0].id;
    A.centralId = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [A.empresaId])).rows[0].id;
    await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [A.empresaId]);

    for (let i = 0; i < 3; i += 1) {
        const u = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, 'vendedor', true) RETURNING id`,
            [A.empresaId, `Vendedor ${i} ${sufixo}`, `v${i}-${A.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH]
        );
        A.usuarios.push(u.rows[0].id);
    }
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('POST /vendas concorrente', () => {
    test('30 vendas simultâneas (3x o pool) terminam todas, sem travar, e o estoque fecha', async () => {
        const produtoId = await criarProduto(100);

        const respostas = await Promise.all(
            Array.from({ length: 30 }, (_, i) => vender(A.usuarios[i % 3], [{ produto_id: produtoId, quantidade: 1 }]))
        );

        expect(respostas.map((r) => r.status)).toEqual(Array(30).fill(201));
        const { rows } = await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId]);
        expect(rows[0].estoque_atual).toBe(70);
        const soma = await db.query('SELECT SUM(saldo)::int AS s FROM estoque_locais WHERE produto_id = $1', [produtoId]);
        expect(soma.rows[0].s).toBe(70);
    });

    test('vendas com os mesmos produtos em ordem inversa não geram deadlock', async () => {
        const p1 = await criarProduto(100);
        const p2 = await criarProduto(100);
        const p3 = await criarProduto(100);

        const respostas = await Promise.all(
            Array.from({ length: 12 }, (_, i) => vender(A.usuarios[i % 3], i % 2 === 0
                ? [{ produto_id: p1, quantidade: 1 }, { produto_id: p2, quantidade: 1 }, { produto_id: p3, quantidade: 1 }]
                : [{ produto_id: p3, quantidade: 1 }, { produto_id: p2, quantidade: 1 }, { produto_id: p1, quantidade: 1 }]))
        );

        expect(respostas.map((r) => r.status)).toEqual(Array(12).fill(201));
        for (const p of [p1, p2, p3]) {
            const { rows } = await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [p]);
            expect(rows[0].estoque_atual).toBe(88);
        }
    });
});

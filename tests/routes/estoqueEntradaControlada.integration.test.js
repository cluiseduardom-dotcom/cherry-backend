// Integração de verdade (Postgres): entrada de estoque só por documento; entrada avulsa, ajuste para mais e
// estoque inicial dependem de permissão e deixam origem. Empresas e usuários temporários, removidos no fim.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const E = {};

async function criarUsuario(papel, rotulo = papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id, token_version`,
        [E.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${E.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    return { id: rows[0].id, tv: rows[0].token_version, papel };
}

const chamar = (usuario, metodo, url, corpo) =>
    request(app)[metodo](url)
        .set('Authorization', `Bearer ${makeToken({ id: usuario.id, role: usuario.papel, empresa_id: E.empresaId, tv: usuario.tv })}`)
        .send(corpo);

const criarProduto = async (estoque = 0) => {
    const res = await chamar(E.admin, 'post', '/produtos', {
        nome: `Prod ${crypto.randomBytes(3).toString('hex')}`, preco_venda: 100, custo: 10, estoque_atual: estoque
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
};

const mov = (usuario, produtoId, corpo) => chamar(usuario, 'post', `/produtos/${produtoId}/movimentacoes`, corpo);
const total = async (produtoId) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual;
const movimentos = async (produtoId) => (await db.query(
    'SELECT tipo, quantidade, motivo, origem FROM movimentacoes_estoque WHERE produto_id = $1 ORDER BY id', [produtoId]
)).rows;

beforeAll(async () => {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste EntradaControlada ${sufixo}`]);
    E.empresaId = registro.registrar(rows[0].id);
    E.admin = await criarUsuario('admin');
    E.estoquista = await criarUsuario('estoquista');
    E.comprador = await criarUsuario('estoquista', 'comprador');
    // A empresa decide quem recebe sem compra e quem ajusta para mais: aqui, o cargo estoquista inteiro.
    // O estoquista "comum" é um segundo comércio sem concessão (padrão do catálogo = sem capacidade).
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('entrada livre não existe mais', () => {
    test.each([
        [{ tipo: 'entrada', quantidade: 50 }],
        [{ tipo: 'entrada', quantidade: 50, motivo: 'Reposição' }],
        [{ tipo: 'entrada', quantidade: 50, motivo_codigo: 'reposicao' }]
    ])('admin e estoquista recebem 400 e o estoque não muda: %j', async (corpo) => {
        const produto = await criarProduto(3);

        expect((await mov(E.admin, produto, corpo)).status).toBe(400);
        expect((await mov(E.estoquista, produto, corpo)).status).toBe(400);
        expect(await total(produto)).toBe(3);
    });
});

describe('sem concessão (padrão do catálogo)', () => {
    test('estoquista não recebe sem compra nem ajusta para mais; saída e ajuste para menos continuam', async () => {
        const produto = await criarProduto(10);

        const semCompra = await mov(E.estoquista, produto, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'recebimento_sem_compra', observacao: 'Bonificação' });
        expect(semCompra.status).toBe(403);

        const paraMais = await mov(E.estoquista, produto, { tipo: 'ajuste', quantidade: 99, motivo_codigo: 'contagem' });
        expect(paraMais.status).toBe(403);
        expect(await total(produto)).toBe(10);

        expect((await mov(E.estoquista, produto, { tipo: 'saida', quantidade: 2, motivo_codigo: 'perda' })).status).toBe(201);
        expect((await mov(E.estoquista, produto, { tipo: 'ajuste', quantidade: 5, motivo_codigo: 'contagem' })).status).toBe(201);
        expect((await mov(E.estoquista, produto, { tipo: 'ajuste', quantidade: 5, motivo_codigo: 'contagem' })).status).toBe(201); // igual ao saldo: não aumenta
        expect(await total(produto)).toBe(5);

        expect(await movimentos(produto)).toEqual([
            { tipo: 'entrada', quantidade: 10, motivo: 'Estoque inicial', origem: 'estoque_inicial' },
            { tipo: 'saida', quantidade: 2, motivo: 'Perda', origem: 'perda' },
            { tipo: 'ajuste', quantidade: 5, motivo: 'Contagem de estoque', origem: 'contagem' },
            { tipo: 'ajuste', quantidade: 5, motivo: 'Contagem de estoque', origem: 'contagem' }
        ]);
    });

    test('estoquista não lança estoque inicial', async () => {
        const produto = await criarProduto(0);
        expect((await mov(E.estoquista, produto, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'estoque_inicial' })).status).toBe(403);
        expect(await total(produto)).toBe(0);
    });

    test('saída sem motivo é recusada', async () => {
        const produto = await criarProduto(4);
        expect((await mov(E.estoquista, produto, { tipo: 'saida', quantidade: 1 })).status).toBe(400);
        expect(await total(produto)).toBe(4);
    });
});

describe('estoque inicial (só admin, só produto sem movimentação)', () => {
    test('admin lança uma vez; a segunda é 409 e o histórico mostra a origem', async () => {
        const produto = await criarProduto(0);

        const primeira = await mov(E.admin, produto, { tipo: 'entrada', quantidade: 12, motivo_codigo: 'estoque_inicial' });
        expect(primeira.status).toBe(201);
        expect(await total(produto)).toBe(12);

        const segunda = await mov(E.admin, produto, { tipo: 'entrada', quantidade: 12, motivo_codigo: 'estoque_inicial' });
        expect(segunda.status).toBe(409);
        expect(await total(produto)).toBe(12);

        expect(await movimentos(produto)).toEqual([{ tipo: 'entrada', quantidade: 12, motivo: 'Estoque inicial', origem: 'estoque_inicial' }]);
    });

    test('produto cadastrado já com estoque conta como inicial feito: não dá para somar de novo', async () => {
        const produto = await criarProduto(5);
        expect((await mov(E.admin, produto, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'estoque_inicial' })).status).toBe(409);
        expect(await total(produto)).toBe(5);
    });

    test('concorrência: dois lançamentos simultâneos de estoque inicial, só um vale', async () => {
        const produto = await criarProduto(0);

        const respostas = await Promise.all(
            Array.from({ length: 6 }, () => mov(E.admin, produto, { tipo: 'entrada', quantidade: 10, motivo_codigo: 'estoque_inicial' }))
        );

        expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(5);
        expect(await total(produto)).toBe(10);
    });
});

describe('com concessão pela empresa (cargos_empresa)', () => {
    beforeAll(async () => {
        await db.query(
            `INSERT INTO cargos_empresa (empresa_id, cargo, ativo, capacidades) VALUES ($1, 'estoquista', true, ARRAY['receber_sem_compra'])
             ON CONFLICT (empresa_id, cargo) DO UPDATE SET capacidades = EXCLUDED.capacidades`,
            [E.empresaId]
        );
    });

    test('receber_sem_compra libera a entrada avulsa, com observação obrigatória, e grava a origem', async () => {
        const produto = await criarProduto(0);

        const semObservacao = await mov(E.comprador, produto, { tipo: 'entrada', quantidade: 3, motivo_codigo: 'recebimento_sem_compra' });
        expect(semObservacao.status).toBe(400);

        const ok = await mov(E.comprador, produto, { tipo: 'entrada', quantidade: 3, motivo_codigo: 'recebimento_sem_compra', observacao: 'Bonificação Brazzan' });
        expect(ok.status).toBe(201);
        expect(await total(produto)).toBe(3);
        expect(await movimentos(produto)).toEqual([
            { tipo: 'entrada', quantidade: 3, motivo: 'Recebimento sem compra — Bonificação Brazzan', origem: 'recebimento_sem_compra' }
        ]);
    });

    test('receber_sem_compra não libera ajuste para mais nem estoque inicial', async () => {
        const produto = await criarProduto(2);

        expect((await mov(E.comprador, produto, { tipo: 'ajuste', quantidade: 50, motivo_codigo: 'contagem' })).status).toBe(403);
        expect((await mov(E.comprador, produto, { tipo: 'entrada', quantidade: 5, motivo_codigo: 'estoque_inicial' })).status).toBe(403);
        expect(await total(produto)).toBe(2);
    });

    test('ajustar_estoque libera o ajuste para mais', async () => {
        await db.query(`UPDATE cargos_empresa SET capacidades = ARRAY['ajustar_estoque'] WHERE empresa_id = $1 AND cargo = 'estoquista'`, [E.empresaId]);
        const produto = await criarProduto(2);

        const res = await mov(E.comprador, produto, { tipo: 'ajuste', quantidade: 8, motivo_codigo: 'contagem' });
        expect(res.status).toBe(201);
        expect(await total(produto)).toBe(8);
    });

    test('admin tem todas as capacidades de estoque, menos o que é regra de produto (estoque inicial só 1x)', async () => {
        const produto = await criarProduto(1);

        expect((await mov(E.admin, produto, { tipo: 'ajuste', quantidade: 30, motivo_codigo: 'correcao', observacao: 'Contagem errada' })).status).toBe(201);
        expect((await mov(E.admin, produto, { tipo: 'entrada', quantidade: 2, motivo_codigo: 'recebimento_sem_compra', observacao: 'Devolução de cliente' })).status).toBe(201);
        expect(await total(produto)).toBe(32);
    });
});

describe('concorrência no ajuste para mais', () => {
    test('vários ajustes simultâneos sem permissão: nenhum aumenta o estoque', async () => {
        await db.query(`UPDATE cargos_empresa SET capacidades = '{}' WHERE empresa_id = $1 AND cargo = 'estoquista'`, [E.empresaId]);
        const produto = await criarProduto(5);

        const respostas = await Promise.all(
            Array.from({ length: 8 }, (_, i) => mov(E.comprador, produto, { tipo: 'ajuste', quantidade: 6 + i, motivo_codigo: 'contagem' }))
        );

        expect(respostas.every((r) => r.status === 403)).toBe(true);
        expect(await total(produto)).toBe(5);
    });
});

describe('Compra continua dando entrada e grava a origem', () => {
    test('compra direta com 2 itens: entrada nos dois produtos, origem compra e compra_id preenchido', async () => {
        const [p1, p2] = [await criarProduto(0), await criarProduto(0)];
        const { rows } = await db.query(
            `INSERT INTO fornecedores (empresa_id, nome) VALUES ($1, 'Fornecedor teste') RETURNING id`, [E.empresaId]
        );

        const res = await chamar(E.admin, 'post', '/compras', {
            fornecedor_id: rows[0].id,
            data_compra: '2026-10-31',
            forma_pagamento: 'a_vista',
            itens: [
                { produto_id: p1, quantidade: 4, custo_unitario: 10 },
                { produto_id: p2, quantidade: 6, custo_unitario: 5 }
            ]
        });

        expect(res.status).toBe(201);
        expect(await total(p1)).toBe(4);
        expect(await total(p2)).toBe(6);
        const { rows: movs } = await db.query(
            `SELECT origem, compra_id FROM movimentacoes_estoque WHERE produto_id = ANY($1) ORDER BY produto_id`, [[p1, p2]]
        );
        expect(movs).toEqual([
            { origem: 'compra', compra_id: res.body.data.id },
            { origem: 'compra', compra_id: res.body.data.id }
        ]);
    });
});

describe('migration 080', () => {
    test('é idempotente e classifica só o que tem marca inequívoca', async () => {
        const produto = await criarProduto(0);
        const { rows: [{ id: central }] } = await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [E.empresaId]);
        const linhas = [
            ['entrada', 'Recebimento #9'], ['entrada', 'Estoque inicial'], ['entrada', 'Reposição qualquer'], ['saida', 'cancelamento_compra']
        ];
        for (const [tipo, motivo] of linhas) {
            await db.query(
                `INSERT INTO movimentacoes_estoque (empresa_id, produto_id, tipo, quantidade, estoque_resultante, motivo, local_id, saldo_local_resultante, origem)
                 VALUES ($1, $2, $3, 1, 1, $4, $5, 1, NULL)`,
                [E.empresaId, produto, tipo, motivo, central]
            );
        }

        const sql = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/080_movimentacoes_estoque_origem.sql'), 'utf8');
        await db.query(sql);
        await db.query(sql);

        expect(await movimentos(produto)).toEqual([
            { tipo: 'entrada', quantidade: 1, motivo: 'Recebimento #9', origem: 'recebimento' },
            { tipo: 'entrada', quantidade: 1, motivo: 'Estoque inicial', origem: 'estoque_inicial' },
            { tipo: 'entrada', quantidade: 1, motivo: 'Reposição qualquer', origem: null },
            { tipo: 'saida', quantidade: 1, motivo: 'cancelamento_compra', origem: 'cancelamento_compra' }
        ]);
    });
});

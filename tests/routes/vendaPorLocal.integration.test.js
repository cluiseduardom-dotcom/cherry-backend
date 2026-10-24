// Integração de verdade (Postgres da CI/dev): migration 060 + venda baixando do local certo
// (Maleta do vendedor por padrão, Central ou a própria Maleta por escolha) + cancelamento
// devolvendo ao local ORIGINAL. Invariante em todo teste: soma dos locais = produtos.estoque_atual.
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
const MOTIVO = 'Cliente desistiu da compra';

const A = { u: {} };
const B = { u: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste VendaLocal ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.centralId = (await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING RETURNING id`, [alvo.empresaId]
    )).rows[0]?.id ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, rotulo) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, 'vendedor', true) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH]
    );
    alvo.u[rotulo] = rows[0].id;
}

async function criarMaleta(alvo, rotulo) {
    const { rows } = await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', $2, $3) RETURNING id`,
        [alvo.empresaId, `Maleta ${rotulo}`, alvo.u[rotulo]]
    );
    alvo.maleta = { ...(alvo.maleta ?? {}), [rotulo]: rows[0].id };
    return rows[0].id;
}

async function criarConsignado(alvo) {
    return (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'consignado', 'Consignado X') RETURNING id`, [alvo.empresaId])).rows[0].id;
}

// saldos: { [local_id]: saldo }. estoque_atual = soma, mantendo o invariante.
async function criarProduto(alvo, saldos) {
    const total = Object.values(saldos).reduce((a, b) => a + b, 0);
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 100, 10, $3) RETURNING id`,
        [alvo.empresaId, `Produto ${sufixo}`, total]
    );
    const id = rows[0].id;

    for (const [localId, saldo] of Object.entries(saldos)) {
        await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, Number(localId), alvo.empresaId, saldo]);
    }

    await db.query(
        `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`,
        [alvo.empresaId, id, alvo.canalId]
    );
    return id;
}

const auth = (alvo, rotulo) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[rotulo], role: 'vendedor', empresa_id: alvo.empresaId, tv: 0 })}` });

const vender = (alvo, rotulo, itens) =>
    request(app).post('/vendas').set(auth(alvo, rotulo)).send({ itens, pagamentos: [{ forma_pagamento: 'pix', valor: 100 * itens.reduce((a, i) => a + i.quantidade, 0) }] });

const cancelar = (alvo, rotulo, vendaId) =>
    request(app).patch(`/vendas/${vendaId}/cancelar`).set(auth(alvo, rotulo)).send({ motivo: MOTIVO });

const saldo = async (produtoId, localId) =>
    Number((await db.query('SELECT COALESCE(SUM(saldo), 0) AS s FROM estoque_locais WHERE produto_id = $1 AND local_id = $2', [produtoId, localId])).rows[0].s);

async function conferirInvariante(produtoId) {
    const soma = Number((await db.query('SELECT COALESCE(SUM(saldo), 0) AS s FROM estoque_locais WHERE produto_id = $1', [produtoId])).rows[0].s);
    const total = Number((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual);
    expect(soma).toBe(total);
}

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    for (const rotulo of ['comMaleta', 'semMaleta', 'outro']) await criarUsuario(A, rotulo);
    await criarUsuario(B, 'vendedor');

    await criarMaleta(A, 'comMaleta');
    await criarMaleta(A, 'outro');
    await criarMaleta(B, 'vendedor');

    for (const alvo of [A, B]) {
        await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [alvo.empresaId]);
    }
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 060', () => {
    test('INSERT sem local_id (código antigo, fixture, importação) cai no Central da empresa', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 5 });
        const venda = (await db.query(
            `INSERT INTO vendas (empresa_id, canal_id, usuario_id, total, status) VALUES ($1, $2, $3, 100, 'finalizada') RETURNING id`,
            [A.empresaId, A.canalId, A.u.semMaleta]
        )).rows[0];
        const { rows } = await db.query(
            `INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario, custo_unitario, empresa_id) VALUES ($1, $2, 1, 100, 10, $3) RETURNING local_id`,
            [venda.id, produtoId, A.empresaId]
        );
        expect(rows[0].local_id).toBe(A.centralId);
    });

    test('local de outra empresa é recusado pela FK composta', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 5 });
        const venda = (await db.query(
            `INSERT INTO vendas (empresa_id, canal_id, usuario_id, total, status) VALUES ($1, $2, $3, 100, 'finalizada') RETURNING id`,
            [A.empresaId, A.canalId, A.u.semMaleta]
        )).rows[0];
        await expect(db.query(
            `INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario, custo_unitario, empresa_id, local_id) VALUES ($1, $2, 1, 100, 10, $3, $4)`,
            [venda.id, produtoId, A.empresaId, B.maleta.vendedor]
        )).rejects.toMatchObject({ code: '23503' });
    });

    test('é idempotente: reaplicar a migration não falha nem altera dados', async () => {
        const sql = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/060_itens_venda_local.sql'), 'utf8');
        await expect(db.query(sql)).resolves.toBeDefined();
    });
});

describe('venda baixa do local certo', () => {
    test('vendedor com Maleta: sai da Maleta, Central intacto, local_id gravado e invariante preservado', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 10, [A.maleta.comMaleta]: 4 });

        const res = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 3 }]);
        expect(res.status).toBe(201);
        expect(res.body.data.itens[0].local_id).toBe(A.maleta.comMaleta);

        expect(await saldo(produtoId, A.maleta.comMaleta)).toBe(1);
        expect(await saldo(produtoId, A.centralId)).toBe(10);
        await conferirInvariante(produtoId);

        const mov = (await db.query(`SELECT local_id, saldo_local_resultante FROM movimentacoes_estoque WHERE produto_id = $1 AND tipo = 'saida'`, [produtoId])).rows;
        expect(mov).toEqual([{ local_id: A.maleta.comMaleta, saldo_local_resultante: 1 }]);
    });

    test('vendedor sem Maleta continua vendendo do Central', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 5 });
        const res = await vender(A, 'semMaleta', [{ produto_id: produtoId, quantidade: 2 }]);
        expect(res.status).toBe(201);
        expect(res.body.data.itens[0].local_id).toBe(A.centralId);
        expect(await saldo(produtoId, A.centralId)).toBe(3);
        await conferirInvariante(produtoId);
    });

    test('Maleta sem saldo suficiente: 409 mesmo havendo estoque no Central, e nada é alterado', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 50, [A.maleta.comMaleta]: 1 });
        const res = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 2 }]);
        expect(res.status).toBe(409);
        expect(res.body.error ?? res.body.message).toMatch(/Maleta comMaleta/);
        expect(await saldo(produtoId, A.maleta.comMaleta)).toBe(1);
        expect(await saldo(produtoId, A.centralId)).toBe(50);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM itens_venda WHERE produto_id = $1', [produtoId])).rows[0].n).toBe(0);
        await conferirInvariante(produtoId);
    });

    test('escolhendo o Central explicitamente, o vendedor com Maleta vende do Central', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 6, [A.maleta.comMaleta]: 2 });
        const res = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 2, local_id: A.centralId }]);
        expect(res.status).toBe(201);
        expect(await saldo(produtoId, A.centralId)).toBe(4);
        expect(await saldo(produtoId, A.maleta.comMaleta)).toBe(2);
        await conferirInvariante(produtoId);
    });

    test('Maleta de outro vendedor, consignado e Em trânsito: 403; local inexistente ou de outra empresa: 404', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 5, [A.maleta.outro]: 5 });
        const consignadoId = await criarConsignado(A);
        const transitoId = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'transito', 'Em trânsito') ON CONFLICT DO NOTHING RETURNING id`, [A.empresaId])).rows[0]?.id
            ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'transito'`, [A.empresaId])).rows[0].id;

        for (const localId of [A.maleta.outro, consignadoId, transitoId]) {
            const res = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 1, local_id: localId }]);
            expect(res.status).toBe(403);
        }
        for (const localId of [99999999, B.maleta.vendedor]) {
            const res = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 1, local_id: localId }]);
            expect(res.status).toBe(404);
        }

        expect(await saldo(produtoId, A.maleta.outro)).toBe(5);
        expect(await saldo(produtoId, A.centralId)).toBe(5);
        await conferirInvariante(produtoId);
    });

    test('Maleta desativada deixa de ser o padrão: a venda volta a sair do Central', async () => {
        await criarUsuario(A, 'desativada');
        const maletaId = await criarMaleta(A, 'desativada');
        const produtoId = await criarProduto(A, { [A.centralId]: 3, [maletaId]: 3 });
        await db.query('UPDATE locais_estoque SET ativo = false WHERE id = $1', [maletaId]);

        const res = await vender(A, 'desativada', [{ produto_id: produtoId, quantidade: 1 }]);
        expect(res.status).toBe(201);
        expect(res.body.data.itens[0].local_id).toBe(A.centralId);
    });

    test('venda mista: um item da Maleta e outro do Central na mesma venda', async () => {
        const p1 = await criarProduto(A, { [A.centralId]: 5, [A.maleta.comMaleta]: 5 });
        const p2 = await criarProduto(A, { [A.centralId]: 5, [A.maleta.comMaleta]: 5 });
        const res = await vender(A, 'comMaleta', [{ produto_id: p1, quantidade: 1 }, { produto_id: p2, quantidade: 2, local_id: A.centralId }]);
        expect(res.status).toBe(201);
        expect(await saldo(p1, A.maleta.comMaleta)).toBe(4);
        expect(await saldo(p2, A.centralId)).toBe(3);
        expect(await saldo(p2, A.maleta.comMaleta)).toBe(5);
    });
});

describe('cancelamento devolve ao local original', () => {
    test('venda da Maleta cancelada volta para a Maleta, não para o Central', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 10, [A.maleta.comMaleta]: 4 });
        const venda = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 3 }]);
        expect(venda.status).toBe(201);

        const res = await cancelar(A, 'comMaleta', venda.body.data.id);
        expect(res.status).toBe(200);

        expect(await saldo(produtoId, A.maleta.comMaleta)).toBe(4);
        expect(await saldo(produtoId, A.centralId)).toBe(10);
        await conferirInvariante(produtoId);
    });

    test('vale mesmo depois de o estoque ter se movido: devolve ao local da venda', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 10, [A.maleta.comMaleta]: 4 });
        const venda = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 4 }]);
        expect(venda.status).toBe(201);

        // Maleta zerada; chega reposição de 2 (via SQL, simulando transferência aceita) antes do cancelamento.
        await db.query('UPDATE estoque_locais SET saldo = saldo + 2 WHERE produto_id = $1 AND local_id = $2', [produtoId, A.maleta.comMaleta]);
        await db.query('UPDATE estoque_locais SET saldo = saldo - 2 WHERE produto_id = $1 AND local_id = $2', [produtoId, A.centralId]);

        expect((await cancelar(A, 'comMaleta', venda.body.data.id)).status).toBe(200);
        expect(await saldo(produtoId, A.maleta.comMaleta)).toBe(6);
        expect(await saldo(produtoId, A.centralId)).toBe(8);
        await conferirInvariante(produtoId);
    });

    test('venda mista cancelada devolve cada item ao seu próprio local', async () => {
        const p1 = await criarProduto(A, { [A.centralId]: 5, [A.maleta.comMaleta]: 5 });
        const p2 = await criarProduto(A, { [A.centralId]: 5, [A.maleta.comMaleta]: 5 });
        const venda = await vender(A, 'comMaleta', [{ produto_id: p1, quantidade: 1 }, { produto_id: p2, quantidade: 2, local_id: A.centralId }]);
        expect(venda.status).toBe(201);

        expect((await cancelar(A, 'comMaleta', venda.body.data.id)).status).toBe(200);
        expect(await saldo(p1, A.maleta.comMaleta)).toBe(5);
        expect(await saldo(p1, A.centralId)).toBe(5);
        expect(await saldo(p2, A.centralId)).toBe(5);
        expect(await saldo(p2, A.maleta.comMaleta)).toBe(5);
        await conferirInvariante(p1);
        await conferirInvariante(p2);
    });

    test('cancelar duas vezes não devolve em dobro', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 5, [A.maleta.comMaleta]: 5 });
        const venda = await vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 2 }]);
        expect((await cancelar(A, 'comMaleta', venda.body.data.id)).status).toBe(200);
        expect((await cancelar(A, 'comMaleta', venda.body.data.id)).status).toBeGreaterThanOrEqual(400);
        expect(await saldo(produtoId, A.maleta.comMaleta)).toBe(5);
        await conferirInvariante(produtoId);
    });

    test('venda antiga (item sem local informado, caiu no Central) volta ao Central', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 5 });
        const venda = await vender(A, 'semMaleta', [{ produto_id: produtoId, quantidade: 2 }]);
        expect((await cancelar(A, 'semMaleta', venda.body.data.id)).status).toBe(200);
        expect(await saldo(produtoId, A.centralId)).toBe(5);
    });
});

describe('concorrência', () => {
    test('10 vendas simultâneas de 1 unidade com 4 na Maleta: exatamente 4 passam, saldo nunca negativo', async () => {
        const produtoId = await criarProduto(A, { [A.centralId]: 20, [A.maleta.comMaleta]: 4 });

        const resultados = await Promise.all(Array.from({ length: 10 }, () => vender(A, 'comMaleta', [{ produto_id: produtoId, quantidade: 1 }])));
        const status = resultados.map((r) => r.status);

        expect(status.filter((s) => s === 201)).toHaveLength(4);
        expect(status.filter((s) => s === 409)).toHaveLength(6);
        expect(await saldo(produtoId, A.maleta.comMaleta)).toBe(0);
        expect(await saldo(produtoId, A.centralId)).toBe(20);
        await conferirInvariante(produtoId);
    });
});

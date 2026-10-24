// Integração de verdade (Postgres da CI/dev): migration 061 + acerto do local (reconstruído do histórico)
// + conferência por contagem (imutável, ajuste opcional só do admin). Transferências, vendas e
// cancelamentos são feitos pelas rotas reais. Invariante: soma dos locais = produtos.estoque_atual.
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

const A = { u: {} };
const B = { u: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Acerto ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.centralId = (await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING RETURNING id`, [alvo.empresaId]
    )).rows[0]?.id ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0].id;
    alvo.transitoId = (await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'transito', 'Em trânsito') ON CONFLICT DO NOTHING RETURNING id`, [alvo.empresaId]
    )).rows[0]?.id ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'transito'`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, rotulo, papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[rotulo] = { id: rows[0].id, papel };
}

async function criarMaleta(alvo, rotulo) {
    alvo.maleta = alvo.maleta ?? {};
    alvo.maleta[rotulo] = (await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', $2, $3) RETURNING id`,
        [alvo.empresaId, `Maleta ${rotulo}`, alvo.u[rotulo].id]
    )).rows[0].id;
}

async function criarProduto(alvo, centralSaldo) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 100, 10, $3) RETURNING id`,
        [alvo.empresaId, `Produto ${sufixo}`, centralSaldo]
    );
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [rows[0].id, alvo.centralId, alvo.empresaId, centralSaldo]);
    await db.query(
        `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`,
        [alvo.empresaId, rows[0].id, alvo.canalId]
    );
    return rows[0].id;
}

const auth = (alvo, rotulo) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[rotulo].id, role: alvo.u[rotulo].papel, empresa_id: alvo.empresaId, tv: 0 })}` });

async function transferir(alvo, de, para, produtoId, quantidade, { quemCria = 'admin', resposta = 'aceitar', quemResponde } = {}) {
    const criada = await request(app).post('/estoque/transferencias').set(auth(alvo, quemCria))
        .send({ origem_local_id: de, destino_local_id: para, itens: [{ produto_id: produtoId, quantidade }] });
    expect(criada.status).toBe(201);
    const id = criada.body.data.id;

    if (resposta) {
        const r = await request(app).post(`/estoque/transferencias/${id}/${resposta}`).set(auth(alvo, quemResponde ?? 'admin'))
            .send(resposta === 'aceitar' ? {} : { motivo: 'Motivo de teste' });
        expect(r.status).toBe(200);
    }
    return id;
}

const vender = (alvo, rotulo, produtoId, quantidade) =>
    request(app).post('/vendas').set(auth(alvo, rotulo))
        .send({ itens: [{ produto_id: produtoId, quantidade }], pagamentos: [{ forma_pagamento: 'pix', valor: 100 * quantidade }] });

const cancelarVenda = (alvo, rotulo, vendaId) =>
    request(app).patch(`/vendas/${vendaId}/cancelar`).set(auth(alvo, rotulo)).send({ motivo: 'Cliente desistiu da compra' });

const acerto = (alvo, rotulo, localId, query = '') => request(app).get(`/estoque/locais/${localId}/acerto${query}`).set(auth(alvo, rotulo));
const conferir = (alvo, rotulo, localId, corpo) => request(app).post(`/estoque/locais/${localId}/conferencias`).set(auth(alvo, rotulo)).send(corpo);

const saldo = async (produtoId, localId) =>
    Number((await db.query('SELECT COALESCE(SUM(saldo), 0) AS s FROM estoque_locais WHERE produto_id = $1 AND local_id = $2', [produtoId, localId])).rows[0].s);

async function conferirInvariante(produtoId) {
    const soma = Number((await db.query('SELECT COALESCE(SUM(saldo), 0) AS s FROM estoque_locais WHERE produto_id = $1', [produtoId])).rows[0].s);
    const total = Number((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual);
    expect(soma).toBe(total);
}

const linha = (corpo, produtoId) => corpo.data.itens.find((i) => i.produto_id === produtoId);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    await criarUsuario(A, 'admin', 'admin');
    await criarUsuario(A, 'estoquista', 'estoquista');
    await criarUsuario(A, 'vendedor', 'vendedor');
    await criarUsuario(A, 'outro', 'vendedor');
    await criarUsuario(B, 'admin', 'admin');

    await criarMaleta(A, 'vendedor');
    await criarMaleta(A, 'outro');

    for (const alvo of [A, B]) {
        await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [alvo.empresaId]);
    }
    B.produtoId = await criarProduto(B, 5);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 061', () => {
    test('conferências e itens são imutáveis (UPDATE e DELETE recusados) e a migration é idempotente', async () => {
        const produtoId = await criarProduto(A, 5);
        const res = await conferir(A, 'admin', A.centralId, { itens: [{ produto_id: produtoId, quantidade_contada: 5 }] });
        expect(res.status).toBe(201);

        await expect(db.query('UPDATE conferencias_estoque SET observacao = $2 WHERE id = $1', [res.body.data.id, 'x'])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query('DELETE FROM conferencias_estoque WHERE id = $1', [res.body.data.id])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query('UPDATE conferencia_itens SET quantidade_contada = 1 WHERE conferencia_id = $1', [res.body.data.id])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query('DELETE FROM conferencia_itens WHERE conferencia_id = $1', [res.body.data.id])).rejects.toMatchObject({ code: '23001' });

        const sql = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/061_conferencias_estoque.sql'), 'utf8');
        await expect(db.query(sql)).resolves.toBeDefined();
    });
});

describe('acerto da Maleta', () => {
    test('recebido, enviado, vendido e ajuste fecham a conta; cancelamentos e transferências recusadas não contam', async () => {
        const produtoId = await criarProduto(A, 10);
        const maleta = A.maleta.vendedor;

        await transferir(A, A.centralId, maleta, produtoId, 6, { quemResponde: 'vendedor' });
        const v1 = await vender(A, 'vendedor', produtoId, 2);
        expect(v1.status).toBe(201);
        expect((await cancelarVenda(A, 'vendedor', v1.body.data.id)).status).toBe(200);
        expect((await vender(A, 'vendedor', produtoId, 1)).status).toBe(201);
        await transferir(A, maleta, A.centralId, produtoId, 1, { quemCria: 'vendedor', quemResponde: 'admin' });
        await transferir(A, maleta, A.centralId, produtoId, 2, { quemCria: 'vendedor', resposta: 'cancelar', quemResponde: 'vendedor' });
        await transferir(A, A.centralId, maleta, produtoId, 3, { resposta: 'recusar', quemResponde: 'vendedor' });

        const antes = await acerto(A, 'admin', maleta);
        expect(antes.status).toBe(200);
        expect(linha(antes.body, produtoId)).toMatchObject({
            saldo_inicial: 0, recebido: 6, enviado: 1, vendido: 1, ajustes: 0, outros: 0, saldo_atual: 4, valor_vendido: 100, confere: true
        });
        expect(antes.body.data.confere).toBe(true);

        // Contagem física achou 3 (faltou 1): o admin aplica o ajuste.
        const conf = await conferir(A, 'admin', maleta, { itens: [{ produto_id: produtoId, quantidade_contada: 3 }], aplicar_ajuste: true, observacao: 'Acerto mensal' });
        expect(conf.status).toBe(201);
        expect(conf.body.data.itens[0]).toMatchObject({ saldo_sistema: 4, quantidade_contada: 3, diferenca: -1 });

        const depois = await acerto(A, 'admin', maleta);
        expect(linha(depois.body, produtoId)).toMatchObject({ saldo_inicial: 0, recebido: 6, enviado: 1, vendido: 1, ajustes: -1, saldo_atual: 3, confere: true });
        expect(depois.body.data.totais).toMatchObject({ recebido: 6, enviado: 1, vendido: 1, ajustes: -1, saldo_atual: 3, valor_vendido: 100 });
        expect(await saldo(produtoId, maleta)).toBe(3);
        await conferirInvariante(produtoId);
    });

    test('com `desde` no futuro o período fica zerado e o saldo inicial é o saldo atual', async () => {
        const produtoId = await criarProduto(A, 4);
        await transferir(A, A.centralId, A.maleta.vendedor, produtoId, 4, { quemResponde: 'vendedor' });

        const res = await acerto(A, 'admin', A.maleta.vendedor, '?desde=2999-01-01');
        expect(res.status).toBe(200);
        expect(linha(res.body, produtoId)).toMatchObject({ saldo_inicial: 4, recebido: 0, enviado: 0, vendido: 0, saldo_atual: 4, confere: true });
    });

    test('`desde` inválido = 400', async () => {
        for (const desde of ['ontem', '2026-13-40', '2026-02-30']) {
            expect((await acerto(A, 'admin', A.maleta.vendedor, `?desde=${desde}`)).status).toBe(400);
        }
    });

    test('visibilidade: dono vê a própria maleta; outro vendedor e outra empresa recebem 404; estoquista vê qualquer uma', async () => {
        expect((await acerto(A, 'vendedor', A.maleta.vendedor)).status).toBe(200);
        expect((await acerto(A, 'outro', A.maleta.vendedor)).status).toBe(404);
        expect((await acerto(A, 'estoquista', A.maleta.vendedor)).status).toBe(200);
        expect((await acerto(B, 'admin', A.maleta.vendedor)).status).toBe(404);
        expect((await acerto(A, 'admin', 99999999)).status).toBe(404);
        expect((await request(app).get('/estoque/locais/abc/acerto').set(auth(A, 'admin'))).status).toBe(400);
    });

    test('o acerto não expõe custo', async () => {
        const res = await acerto(A, 'vendedor', A.maleta.vendedor);
        expect(JSON.stringify(res.body)).not.toMatch(/custo|margem|lucro/i);
    });
});

describe('conferência', () => {
    test('estoquista registra sem alterar estoque; contagem igual ao sistema não gera movimentação', async () => {
        const produtoId = await criarProduto(A, 8);
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM movimentacoes_estoque WHERE produto_id = $1', [produtoId])).rows[0].n;

        const res = await conferir(A, 'estoquista', A.centralId, { itens: [{ produto_id: produtoId, quantidade_contada: 5 }] });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ ajuste_aplicado: false });
        expect(res.body.data.itens[0]).toMatchObject({ saldo_sistema: 8, quantidade_contada: 5, diferenca: -3 });

        const igual = await conferir(A, 'admin', A.centralId, { itens: [{ produto_id: produtoId, quantidade_contada: 8 }], aplicar_ajuste: true });
        expect(igual.status).toBe(201);

        expect(await saldo(produtoId, A.centralId)).toBe(8);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM movimentacoes_estoque WHERE produto_id = $1', [produtoId])).rows[0].n).toBe(antes);
        await conferirInvariante(produtoId);
    });

    test('só o admin aplica ajuste; vendedor não registra conferência (403) e nada é gravado', async () => {
        const produtoId = await criarProduto(A, 8);
        const corpo = { itens: [{ produto_id: produtoId, quantidade_contada: 2 }] };

        expect((await conferir(A, 'estoquista', A.centralId, { ...corpo, aplicar_ajuste: true })).status).toBe(403);
        expect((await conferir(A, 'vendedor', A.maleta.vendedor, corpo)).status).toBe(403);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM conferencia_itens WHERE produto_id = $1', [produtoId])).rows[0].n).toBe(0);
        expect(await saldo(produtoId, A.centralId)).toBe(8);
    });

    test('admin aplica ajuste: saldo do local vira a contagem e o total acompanha; produto sem saldo prévio no local entra com 0', async () => {
        const produtoId = await criarProduto(A, 8);
        const res = await conferir(A, 'admin', A.maleta.outro, { itens: [{ produto_id: produtoId, quantidade_contada: 2 }], aplicar_ajuste: true });
        expect(res.status).toBe(201);
        expect(res.body.data.itens[0]).toMatchObject({ saldo_sistema: 0, quantidade_contada: 2, diferenca: 2 });
        expect(res.body.data.ajuste_aplicado).toBe(true);
        expect(await saldo(produtoId, A.maleta.outro)).toBe(2);
        expect(await saldo(produtoId, A.centralId)).toBe(8);
        await conferirInvariante(produtoId);

        const mov = (await db.query(`SELECT tipo, motivo, local_id FROM movimentacoes_estoque WHERE produto_id = $1 AND tipo = 'ajuste'`, [produtoId])).rows;
        expect(mov).toEqual([{ tipo: 'ajuste', motivo: `Conferência #${res.body.data.id}`, local_id: A.maleta.outro }]);
    });

    test('rejeições: produto/local de outra empresa 404, Em trânsito 409, local inativo 409, validação 400', async () => {
        const produtoId = await criarProduto(A, 3);
        const ok = [{ produto_id: produtoId, quantidade_contada: 1 }];

        expect((await conferir(A, 'admin', A.centralId, { itens: [{ produto_id: B.produtoId, quantidade_contada: 1 }] })).status).toBe(404);
        expect((await conferir(B, 'admin', A.centralId, { itens: [{ produto_id: B.produtoId, quantidade_contada: 1 }] })).status).toBe(404);
        expect((await conferir(A, 'admin', A.transitoId, { itens: ok })).status).toBe(409);

        const inativa = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome, ativo) VALUES ($1, 'consignado', 'Antigo', false) RETURNING id`, [A.empresaId])).rows[0].id;
        expect((await conferir(A, 'admin', inativa, { itens: ok })).status).toBe(409);

        for (const corpo of [
            { itens: [] },
            { itens: [{ produto_id: produtoId, quantidade_contada: -1 }] },
            { itens: [{ produto_id: produtoId, quantidade_contada: 1.5 }] },
            { itens: [...ok, ...ok] },
            { itens: ok, extra: 1 },
            { itens: ok, aplicar_ajuste: 'sim' },
            {}
        ]) {
            expect((await conferir(A, 'admin', A.centralId, corpo)).status).toBe(400);
        }
    });

    test('listagem: dono e equipe veem as conferências do local, com diferenças; outro vendedor recebe 404', async () => {
        const produtoId = await criarProduto(A, 5);
        await transferir(A, A.centralId, A.maleta.vendedor, produtoId, 5, { quemResponde: 'vendedor' });
        const conf = await conferir(A, 'estoquista', A.maleta.vendedor, { itens: [{ produto_id: produtoId, quantidade_contada: 4 }], observacao: 'Visita' });
        expect(conf.status).toBe(201);

        const dono = await request(app).get(`/estoque/locais/${A.maleta.vendedor}/conferencias`).set(auth(A, 'vendedor'));
        expect(dono.status).toBe(200);
        const encontrada = dono.body.data.items.find((c) => c.id === conf.body.data.id);
        expect(encontrada).toMatchObject({ observacao: 'Visita', ajuste_aplicado: false });
        expect(encontrada.itens[0]).toMatchObject({ produto_id: produtoId, saldo_sistema: 5, quantidade_contada: 4, diferenca: -1 });

        expect((await request(app).get(`/estoque/locais/${A.maleta.vendedor}/conferencias`).set(auth(A, 'outro'))).status).toBe(404);
        expect((await request(app).get(`/estoque/locais/${A.maleta.vendedor}/conferencias`).set(auth(B, 'admin'))).status).toBe(404);
    });

    test('duas conferências com ajuste ao mesmo tempo: ambas gravam, saldo = uma das contagens, invariante preservado', async () => {
        const produtoId = await criarProduto(A, 10);
        const [r1, r2] = await Promise.all([
            conferir(A, 'admin', A.centralId, { itens: [{ produto_id: produtoId, quantidade_contada: 7 }], aplicar_ajuste: true }),
            conferir(A, 'admin', A.centralId, { itens: [{ produto_id: produtoId, quantidade_contada: 9 }], aplicar_ajuste: true })
        ]);
        expect([r1.status, r2.status]).toEqual([201, 201]);
        expect([7, 9]).toContain(await saldo(produtoId, A.centralId));
        await conferirInvariante(produtoId);

        // Serializadas pela trava: a primeira viu 10; a segunda viu a contagem aplicada pela primeira.
        const sistema = [r1, r2].map((r) => r.body.data.itens[0].saldo_sistema).sort((a, b) => a - b);
        expect(sistema).toContain(10);
        expect([7, 9]).toContain(sistema[0]);
    });
});

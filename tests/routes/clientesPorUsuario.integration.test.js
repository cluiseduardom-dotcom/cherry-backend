// Integração de verdade (Postgres da CI/dev): migration 065 + clientes por usuário. Prova que quem não tem
// `ver_todos_clientes` (Vendedor, Operador) só enxerga, edita e vende para os clientes que ELE cadastrou,
// que Admin/Analista/Gerente/Financeiro veem todos, que cliente legado (sem dono) é só de quem vê todos, que o
// dono vem do JWT e o isolamento entre empresas. Empresas e usuários próprios e temporários.
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
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ClientesUsuario ${rotulo} ${sufixo}`]);
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

const criarCliente = (alvo, rotulo, nome) => request(app).post('/clientes').set(auth(alvo, rotulo)).send({ nome });
const listar = async (alvo, rotulo) => (await request(app).get('/clientes').set(auth(alvo, rotulo))).body.data.map((c) => c.nome).sort();
const vender = (alvo, rotulo, cliente_id) =>
    request(app).post('/vendas').set(auth(alvo, rotulo)).send({
        itens: [{ produto_id: alvo.produtoId, quantidade: 1 }],
        pagamentos: [{ forma_pagamento: 'pix', valor: 100 }],
        ...(cliente_id ? { cliente_id } : {})
    });

const nomes = { legado: `Legado ${sufixo}`, doVendedor: `Do Vendedor ${sufixo}`, doVendedor2: `Do Vendedor2 ${sufixo}`, doOperador: `Do Operador ${sufixo}` };
const ids = {};

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    for (const papel of ['admin', 'gerente', 'analista', 'financeiro', 'vendedor', 'operador']) await criarUsuario(A, papel);
    await criarUsuario(A, 'vendedor', 'vendedor2');
    await criarUsuario(B, 'admin');
    await criarUsuario(B, 'vendedor');

    // Cargos desligados por padrão: a empresa liga com as capacidades. Vendedor/Operador não têm `ver_todos_clientes`.
    await ligarCargo(A, 'gerente', 70, ['ver_vendas_de_todos', 'ver_todos_clientes']);
    await ligarCargo(A, 'analista', 40, ['cancelar_venda', 'ver_todos_clientes']);
    await ligarCargo(A, 'financeiro', null, ['ver_vendas_de_todos', 'gerir_financeiro', 'ver_todos_clientes']);
    await ligarCargo(A, 'operador', 20, ['cancelar_venda']);

    for (const alvo of [A, B]) alvo.produtoId = await criarProduto(alvo, 100);

    // Cliente legado: anterior à migration, sem dono.
    ids.legado = (await db.query(`INSERT INTO clientes (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [A.empresaId, nomes.legado])).rows[0].id;
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('cadastro: o responsável é o usuário do JWT', () => {
    test('quem cadastra vira o dono; o corpo não escolhe o dono', async () => {
        const res = await criarCliente(A, 'vendedor', nomes.doVendedor);
        expect(res.status).toBe(201);
        ids.doVendedor = res.body.data.id;
        expect(res.body.data.criado_por).toBe(A.u.vendedor);

        const tentativa = await request(app).post('/clientes').set(auth(A, 'vendedor2')).send({ nome: nomes.doVendedor2, criado_por: A.u.vendedor, empresa_id: B.empresaId });
        // ou o corpo é recusado (strict) ou o campo é ignorado; em nenhum caso o dono é outro nem a empresa muda
        if (tentativa.status === 201) {
            ids.doVendedor2 = tentativa.body.data.id;
            expect(tentativa.body.data).toMatchObject({ criado_por: A.u.vendedor2, empresa_id: A.empresaId });
        } else {
            expect(tentativa.status).toBe(400);
            ids.doVendedor2 = (await criarCliente(A, 'vendedor2', nomes.doVendedor2)).body.data.id;
        }

        ids.doOperador = (await criarCliente(A, 'operador', nomes.doOperador)).body.data.id;
        expect((await db.query('SELECT criado_por FROM clientes WHERE id = $1', [ids.doOperador])).rows[0].criado_por).toBe(A.u.operador);
    });
});

describe('listagem', () => {
    test('vendedor e operador veem só os que cadastraram (o legado e os dos outros não aparecem)', async () => {
        expect(await listar(A, 'vendedor')).toEqual([nomes.doVendedor]);
        expect(await listar(A, 'vendedor2')).toEqual([nomes.doVendedor2]);
        expect(await listar(A, 'operador')).toEqual([nomes.doOperador]);
    });

    test('admin, gerente, analista e financeiro veem todos, inclusive o legado', async () => {
        const todos = Object.values(nomes).sort();

        for (const quem of ['admin', 'gerente', 'analista', 'financeiro']) expect(await listar(A, quem)).toEqual(todos);
    });

    test('outra empresa não vê nada de A (nem o admin dela) e A não vê B', async () => {
        await criarCliente(B, 'vendedor', `Cliente B ${sufixo}`);

        expect(await listar(B, 'admin')).toEqual([`Cliente B ${sufixo}`]);
        expect(await listar(A, 'admin')).not.toContain(`Cliente B ${sufixo}`);
    });

    test('a empresa pode dar `ver_todos_clientes` a um cargo: o operador passa a ver todos', async () => {
        await ligarCargo(A, 'operador', 20, ['cancelar_venda', 'ver_todos_clientes']);
        try {
            expect(await listar(A, 'operador')).toEqual(Object.values(nomes).sort());
        } finally {
            await ligarCargo(A, 'operador', 20, ['cancelar_venda']);
        }
        expect(await listar(A, 'operador')).toEqual([nomes.doOperador]);
    });
});

describe('edição e consultas por cliente', () => {
    test('vendedor edita o próprio cliente, mas não o de outro nem o legado (404, nada muda)', async () => {
        expect((await request(app).patch(`/clientes/${ids.doVendedor}`).set(auth(A, 'vendedor')).send({ observacoes: 'meu' })).status).toBe(200);

        for (const alvoId of [ids.doVendedor2, ids.legado]) {
            const res = await request(app).patch(`/clientes/${alvoId}`).set(auth(A, 'vendedor')).send({ observacoes: 'invasão' });
            expect(res.status).toBe(404);
        }
        expect((await db.query('SELECT COUNT(*)::int AS n FROM clientes WHERE empresa_id = $1 AND observacoes = $2', [A.empresaId, 'invasão'])).rows[0].n).toBe(0);
    });

    test('analista edita qualquer cliente da empresa; de outra empresa é 404', async () => {
        expect((await request(app).patch(`/clientes/${ids.legado}`).set(auth(A, 'analista')).send({ observacoes: 'revisado' })).status).toBe(200);
        expect((await request(app).patch(`/clientes/${ids.doVendedor2}`).set(auth(A, 'analista')).send({ observacoes: 'revisado' })).status).toBe(200);
        expect((await request(app).patch(`/clientes/${ids.doVendedor}`).set(auth(B, 'admin')).send({ observacoes: 'x' })).status).toBe(404);
    });

    test('total-gasto, histórico e ranking respeitam o escopo', async () => {
        const venda = await vender(A, 'vendedor2', ids.doVendedor2);
        expect(venda.status).toBe(201);

        // dono vê; vendedor de outro cliente não (404); quem vê todos vê
        expect((await request(app).get(`/clientes/${ids.doVendedor2}/total-gasto`).set(auth(A, 'vendedor2'))).status).toBe(200);
        expect((await request(app).get(`/clientes/${ids.doVendedor2}/total-gasto`).set(auth(A, 'vendedor'))).status).toBe(404);
        expect((await request(app).get(`/clientes/${ids.doVendedor2}/total-gasto`).set(auth(A, 'analista'))).status).toBe(200);

        expect((await request(app).get(`/clientes/${ids.doVendedor2}/historico`).set(auth(A, 'vendedor2'))).status).toBe(200);
        expect((await request(app).get(`/clientes/${ids.doVendedor2}/historico`).set(auth(A, 'vendedor'))).status).toBe(404);
        expect((await request(app).get(`/clientes/${ids.doVendedor2}/historico`).set(auth(A, 'gerente'))).status).toBe(200);

        const rankVendedor = (await request(app).get('/clientes/ranking').set(auth(A, 'vendedor'))).body.data.map((c) => c.nome);
        const rankAnalista = (await request(app).get('/clientes/ranking').set(auth(A, 'analista'))).body.data.map((c) => c.nome).sort();
        expect(rankVendedor).toEqual([nomes.doVendedor]);
        expect(rankAnalista).toEqual(Object.values(nomes).sort());
    });
});

describe('venda: o cliente da venda precisa estar no escopo de quem vende', () => {
    test('vendedor não vende para cliente de outro nem para o legado (404); para o próprio e sem cliente, sim', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM vendas WHERE empresa_id = $1', [A.empresaId])).rows[0].n;

        for (const alvoId of [ids.doVendedor2, ids.legado]) {
            const res = await vender(A, 'vendedor', alvoId);
            expect(res.status).toBe(404);
            expect(res.body.message || JSON.stringify(res.body)).toMatch(/Cliente não encontrado/);
        }
        expect((await db.query('SELECT COUNT(*)::int AS n FROM vendas WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(antes);

        expect((await vender(A, 'vendedor', ids.doVendedor)).status).toBe(201);
        expect((await vender(A, 'vendedor')).status).toBe(201);
    });

    test('quem vê todos vende para qualquer cliente da empresa, mas não para o de outra empresa', async () => {
        expect((await vender(A, 'analista', ids.legado)).status).toBe(201);
        expect((await vender(A, 'gerente', ids.doVendedor2)).status).toBe(201);

        const deB = (await db.query('SELECT id FROM clientes WHERE empresa_id = $1 LIMIT 1', [B.empresaId])).rows[0].id;
        expect((await vender(A, 'analista', deB)).status).toBe(404);
    });
});

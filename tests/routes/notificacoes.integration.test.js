// Integração de verdade (Postgres da CI/dev): a consulta do sino, o isolamento por empresa e o RBAC.
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
const ids = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Sino ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.centralId = (await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING RETURNING id`, [alvo.empresaId]
    )).rows[0]?.id ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0].id;
    for (const papel of ['admin', 'vendedor', 'estoquista']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
}

async function criarProduto(alvo, { sku, nome, tipo = 'acabado', estoque, minimo = 0, diasCadastro = 200 }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual, estoque_minimo, tipo)
         VALUES ($1, $2, $3, 10, 4, $4, $5, $6) RETURNING id`,
        [alvo.empresaId, sku, nome, estoque, minimo, tipo]
    );
    await db.query(
        `INSERT INTO movimentacoes_estoque (empresa_id, produto_id, tipo, quantidade, estoque_resultante, motivo, criado_em, local_id, saldo_local_resultante)
         VALUES ($1, $2, 'entrada', $3, $3, 'Estoque inicial', NOW() - ($4 || ' days')::interval, $5, $3)`,
        [alvo.empresaId, rows[0].id, estoque, String(diasCadastro), alvo.centralId]
    );
    return rows[0].id;
}

async function venderProduto(alvo, produtoId, quantidade, diasAtras, status = 'finalizada') {
    const { rows } = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, usuario_id, status, total, data)
         VALUES ($1, $2, $3, $4, 10, NOW() - ($5 || ' days')::interval) RETURNING id`,
        [alvo.empresaId, alvo.canalId, alvo.u.admin, status, String(diasAtras)]
    );
    await db.query(
        `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
         VALUES ($1, $2, $3, $4, 10, 4)`,
        [alvo.empresaId, rows[0].id, produtoId, quantidade]
    );
}

const chamar = (alvo, papel) =>
    request(app).get('/notificacoes').set('Authorization', `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}`);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    ids.falta = await criarProduto(A, { sku: 'FAL-1', nome: 'Anel em falta', estoque: 0, minimo: 3 });
    ids.baixo = await criarProduto(A, { sku: 'BAI-1', nome: 'Brinco baixo', estoque: 2, minimo: 2 });
    ids.perto = await criarProduto(A, { sku: 'PER-1', nome: 'Colar perto', estoque: 10, minimo: 0 });
    ids.parado = await criarProduto(A, { sku: 'PAR-1', nome: 'Pulseira parada', estoque: 8 });
    ids.novo = await criarProduto(A, { sku: 'NOV-1', nome: 'Anel novo', estoque: 8, diasCadastro: 5 });
    ids.giro = await criarProduto(A, { sku: 'GIR-1', nome: 'Argola giro', estoque: 10 });
    ids.insumo = await criarProduto(A, { sku: 'INS-1', nome: 'Caixinha', tipo: 'insumo', estoque: 0, minimo: 20 });
    ids.cancelado = await criarProduto(A, { sku: 'CAN-1', nome: 'Só venda cancelada', estoque: 5 });
    ids.deB = await criarProduto(B, { sku: 'B-1', nome: 'Produto da empresa B', estoque: 0, minimo: 9 });

    await venderProduto(A, ids.perto, 90, 10);   // 90 em 30d => 3/dia; 10 em estoque => 3,3 dias
    await venderProduto(A, ids.parado, 3, 120);  // última venda há 120 dias
    await venderProduto(A, ids.giro, 40, 20);    // giro 4
    await venderProduto(A, ids.cancelado, 50, 2, 'cancelada');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /notificacoes (integração)', () => {
    test('admin recebe todos os tipos esperados, com SKU', async () => {
        const res = await chamar(A, 'admin');
        expect(res.status).toBe(200);
        const porId = Object.fromEntries(res.body.data.itens.map((i) => [i.id, i]));

        expect(porId[`falta:${ids.falta}`]).toMatchObject({ sku: 'FAL-1', prioridade: 'alta' });
        expect(porId[`abaixo_minimo:${ids.baixo}`]).toBeDefined();
        expect(porId[`perto_de_acabar:${ids.perto}`].dados.cobertura_dias).toBeLessThanOrEqual(7);
        expect(porId[`parado:${ids.parado}`].dados.dias_sem_venda).toBeGreaterThanOrEqual(120);
        expect(porId[`alto_giro:${ids.giro}`]).toBeDefined();
        expect(porId[`falta:${ids.insumo}`]).toMatchObject({ item: 'insumo' });
    });

    test('produto novo e venda cancelada não geram "parado" falso nem giro', async () => {
        const res = await chamar(A, 'admin');
        const chaves = res.body.data.itens.map((i) => i.id);

        expect(chaves).not.toContain(`parado:${ids.novo}`);
        // Só tem venda cancelada, e foi cadastrado há 200 dias: é parado (a venda cancelada não conta).
        expect(chaves).toContain(`parado:${ids.cancelado}`);
        expect(chaves).not.toContain(`alto_giro:${ids.cancelado}`);
    });

    test('isolamento: empresa A nunca vê produto da empresa B (e vice-versa)', async () => {
        const a = await chamar(A, 'admin');
        const b = await chamar(B, 'admin');

        expect(a.body.data.itens.some((i) => i.produto_id === ids.deB)).toBe(false);
        expect(b.body.data.itens.map((i) => i.produto_id)).toEqual([ids.deB]);
    });

    test('estoquista não recebe parado/giro; vendedor só falta/abaixo do mínimo e sem insumo', async () => {
        const est = await chamar(A, 'estoquista');
        const ven = await chamar(A, 'vendedor');

        expect(est.body.data.itens.some((i) => ['parado', 'alto_giro'].includes(i.tipo))).toBe(false);
        expect(est.body.data.itens.some((i) => i.tipo === 'perto_de_acabar')).toBe(true);
        expect(ven.body.data.itens.every((i) => ['falta', 'abaixo_minimo'].includes(i.tipo))).toBe(true);
        expect(ven.body.data.itens.some((i) => i.item === 'insumo')).toBe(false);
    });

    test('resposta nunca traz custo, margem ou lucro', async () => {
        const res = await chamar(A, 'admin');
        expect(JSON.stringify(res.body)).not.toMatch(/custo|margem|lucro/i);
    });
});

// Integração de verdade (Postgres da CI/dev): avisos de maleta do sino — SQL, isolamento por empresa e RBAC.
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
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Sino Maleta ${rotulo} ${sufixo}`]);
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
    alvo.produtoId = (await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual, estoque_minimo, tipo)
         VALUES ($1, 'MAL-1', 'Anel de maleta', 10, 4, 0, 0, 'acabado') RETURNING id`, [alvo.empresaId]
    )).rows[0].id;
}

const criarMaleta = async (alvo, papel, nome, saldo) => {
    const { rows } = await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, 'maleta', $2, $3) RETURNING id`,
        [alvo.empresaId, nome, alvo.u[papel]]
    );
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [alvo.produtoId, rows[0].id, alvo.empresaId, saldo]);
    return rows[0].id;
};

async function transferir(alvo, { destino, status, criadaHa, resolvidaHa = null, qtd = 2 }) {
    const resolvida = status !== 'pendente';
    const { rows } = await db.query(
        `INSERT INTO transferencias_estoque (empresa_id, origem_local_id, destino_local_id, status, criado_por, criado_em, resolvido_por, resolvido_em)
         VALUES ($1, $2, $3, $4, $5, NOW() - ($6 || ' days')::interval, $7, CASE WHEN $8::int IS NULL THEN NULL ELSE NOW() - ($8 || ' days')::interval END)
         RETURNING id`,
        [alvo.empresaId, alvo.centralId, destino, status, alvo.u.admin, String(criadaHa), resolvida ? alvo.u.admin : null, resolvida ? resolvidaHa : null]
    );
    await db.query(`INSERT INTO transferencia_itens (transferencia_id, produto_id, empresa_id, quantidade) VALUES ($1, $2, $3, $4)`, [rows[0].id, alvo.produtoId, alvo.empresaId, qtd]);
    return rows[0].id;
}

async function venderDe(alvo, local, diasAtras, status = 'finalizada') {
    const { rows } = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, usuario_id, status, total, data) VALUES ($1, $2, $3, $4, 10, NOW() - ($5 || ' days')::interval) RETURNING id`,
        [alvo.empresaId, alvo.canalId, alvo.u.admin, status, String(diasAtras)]
    );
    await db.query(
        `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario, local_id) VALUES ($1, $2, $3, 1, 10, 4, $4)`,
        [alvo.empresaId, rows[0].id, alvo.produtoId, local]
    );
}

async function conferir(alvo, local, diasAtras, { diferenca = 0, ajuste = false } = {}) {
    const { rows } = await db.query(
        `INSERT INTO conferencias_estoque (empresa_id, local_id, criado_por, ajuste_aplicado, criado_em) VALUES ($1, $2, $3, $4, NOW() - ($5 || ' days')::interval) RETURNING id`,
        [alvo.empresaId, local, alvo.u.admin, ajuste, String(diasAtras)]
    );
    await db.query(
        `INSERT INTO conferencia_itens (conferencia_id, produto_id, empresa_id, saldo_sistema, quantidade_contada) VALUES ($1, $2, $3, 5, $4)`,
        [rows[0].id, alvo.produtoId, alvo.empresaId, 5 + diferenca]
    );
    return rows[0].id;
}

const chamar = (alvo, papel) =>
    request(app).get('/notificacoes').set('Authorization', `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}`);
const porId = (res) => Object.fromEntries(res.body.data.itens.map((i) => [i.id, i]));

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    // Maleta da vendedora: recebeu há 40 dias, nunca conferida; só tem venda CANCELADA recente. Pendente há 5 dias para ela.
    ids.ana = await criarMaleta(A, 'vendedor', 'Maleta Ana', 5);
    await transferir(A, { destino: ids.ana, status: 'concluida', criadaHa: 41, resolvidaHa: 40 });
    await venderDe(A, ids.ana, 2, 'cancelada');
    ids.pendenteAna = await transferir(A, { destino: ids.ana, status: 'pendente', criadaHa: 5 });

    // Maleta do estoquista: recebeu há 5 dias, conferida há 3 com diferença sem ajuste; pendente de 1 dia (ainda cedo).
    ids.est = await criarMaleta(A, 'estoquista', 'Maleta Beto', 3);
    await transferir(A, { destino: ids.est, status: 'concluida', criadaHa: 6, resolvidaHa: 5 });
    ids.confDiv = await conferir(A, ids.est, 3, { diferenca: -1 });
    ids.pendenteCedo = await transferir(A, { destino: ids.est, status: 'pendente', criadaHa: 1 });

    // Maleta do admin: recebeu há 60 dias, mas vendeu há 3 e conferiu há 1 dia: em dia.
    ids.adm = await criarMaleta(A, 'admin', 'Maleta Admin', 4);
    await transferir(A, { destino: ids.adm, status: 'concluida', criadaHa: 61, resolvidaHa: 60 });
    await venderDe(A, ids.adm, 3);
    await conferir(A, ids.adm, 1);

    // Empresa B: maleta velha que A nunca pode ver.
    ids.deB = await criarMaleta(B, 'vendedor', 'Maleta de B', 9);
    await transferir(B, { destino: ids.deB, status: 'concluida', criadaHa: 91, resolvidaHa: 90 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /notificacoes — avisos de maleta (integração)', () => {
    test('admin vê só o que está errado: Ana (pendente, sem venda, sem conferência) e Beto (divergência)', async () => {
        const res = await chamar(A, 'admin');
        expect(res.status).toBe(200);
        const itens = porId(res);

        expect(itens[`transferencia_pendente:${ids.pendenteAna}`]).toMatchObject({ prioridade: 'alta', dados: { pecas: 2 } });
        expect(itens[`transferencia_pendente:${ids.pendenteAna}`].dados.dias).toBeGreaterThanOrEqual(5);
        expect(itens[`maleta_sem_venda:${ids.ana}`].dados).toMatchObject({ saldo: 5 });
        expect(itens[`maleta_sem_venda:${ids.ana}`].dados.dias_sem_venda).toBeGreaterThanOrEqual(40);
        expect(itens[`maleta_sem_conferencia:${ids.ana}`].dados.dias_sem_conferencia).toBeGreaterThanOrEqual(40);
        expect(itens[`maleta_divergencia:${ids.est}`]).toMatchObject({ prioridade: 'alta', dados: { conferencia_id: ids.confDiv, itens_divergentes: 1 } });

        // Em dia ou cedo demais: sem aviso.
        expect(itens[`transferencia_pendente:${ids.pendenteCedo}`]).toBeUndefined();
        expect(Object.keys(itens).filter((k) => k.endsWith(`:${ids.adm}`))).toEqual([]);
        expect(itens[`maleta_sem_venda:${ids.est}`]).toBeUndefined();
        expect(itens[`maleta_sem_conferencia:${ids.est}`]).toBeUndefined();
    });

    test('isolamento: empresa A nunca vê a maleta de B (e B vê só a sua)', async () => {
        const a = await chamar(A, 'admin');
        expect(a.body.data.itens.some((i) => i.local_id === ids.deB)).toBe(false);
        const b = await chamar(B, 'admin');
        expect(b.body.data.itens.map((i) => i.tipo).sort()).toEqual(['maleta_sem_conferencia', 'maleta_sem_venda']);
        expect(b.body.data.itens.every((i) => i.local_id === ids.deB)).toBe(true);
    });

    test('vendedora dona vê os avisos da própria maleta; não vê divergência nem a maleta dos outros', async () => {
        const res = await chamar(A, 'vendedor');
        const tipos = res.body.data.itens.filter((i) => i.item === 'maleta').map((i) => i.tipo).sort();
        expect(tipos).toEqual(['maleta_sem_conferencia', 'maleta_sem_venda', 'transferencia_pendente']);
        expect(res.body.data.itens.every((i) => i.local_id === undefined || i.local_id === ids.ana)).toBe(true);
    });

    test('estoquista (equipe) vê todas as maletas da empresa', async () => {
        const res = await chamar(A, 'estoquista');
        const itens = porId(res);
        expect(itens[`maleta_sem_venda:${ids.ana}`]).toBeDefined();
        expect(itens[`maleta_divergencia:${ids.est}`]).toBeDefined();
    });

    test('conferência posterior sem diferença encerra a divergência', async () => {
        await conferir(A, ids.est, 0);
        const res = await chamar(A, 'admin');
        expect(porId(res)[`maleta_divergencia:${ids.est}`]).toBeUndefined();
    });

    test('resposta nunca traz custo, margem ou lucro', async () => {
        const res = await chamar(A, 'admin');
        expect(JSON.stringify(res.body)).not.toMatch(/custo|margem|lucro/i);
    });
});

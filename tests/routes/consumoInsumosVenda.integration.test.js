// Integração de verdade (Postgres da CI/dev): migration 069. Baixa automática dos insumos da ficha de venda
// na MESMA transação da venda (só do Central), falta de saldo sem bloquear a venda (pendência + sino),
// snapshot por venda, devolução no cancelamento e isolamento por empresa.
jest.setTimeout(60000);
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
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ConsumoInsumos ${rotulo} ${sufixo}`]);
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

// Cria produto com saldo no Central (estoque_locais + total) e, se for acabado, preço no canal.
async function criarProduto(alvo, { sku, nome, tipo = 'acabado', estoque, custo, preco }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual, estoque_minimo, tipo)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7) RETURNING id`,
        [alvo.empresaId, sku, nome, preco ?? null, custo, estoque, tipo]
    );
    const id = rows[0].id;
    await db.query(
        `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`,
        [id, alvo.centralId, alvo.empresaId, estoque]
    );
    if (preco != null) {
        await db.query(
            `INSERT INTO precos_produto (produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, empresa_id)
             VALUES ($1, $2, $3, 100, 50, $4)`,
            [id, alvo.canalId, preco, alvo.empresaId]
        );
    }
    return id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const criarFicha = (alvo, produtoId, itens) =>
    request(app).post(`/produtos/${produtoId}/ficha-venda`).set(como(alvo, 'admin')).send({ itens });
const vender = (alvo, itens, papel = 'admin') => request(app).post('/vendas').set(como(alvo, papel)).send({ itens });
const saldo = async (alvo, produtoId) =>
    (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1 AND empresa_id = $2', [produtoId, alvo.empresaId])).rows[0].estoque_atual;
const saldoCentral = async (alvo, produtoId) =>
    (await db.query('SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2', [produtoId, alvo.centralId])).rows[0].saldo;
const consumos = async (vendaId) =>
    (await db.query('SELECT * FROM venda_consumos WHERE venda_id = $1 ORDER BY produto_id, id', [vendaId])).rows;
const sino = (alvo, papel) => request(app).get('/notificacoes').set(como(alvo, papel));

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    ids.colar = await criarProduto(A, { sku: 'COL-1', nome: 'Colar', estoque: 50, custo: 15, preco: 60 });
    ids.anel = await criarProduto(A, { sku: 'ANE-1', nome: 'Anel', estoque: 50, custo: 9, preco: 40 });
    ids.embalagem = await criarProduto(A, { sku: 'EMB-1', nome: 'Embalagem', tipo: 'insumo', estoque: 10, custo: 0.8 });
    ids.tag = await criarProduto(A, { sku: 'TAG-1', nome: 'Tag logo', tipo: 'insumo', estoque: 1, custo: 0.35 });
    ids.semFicha = await criarProduto(A, { sku: 'BRO-1', nome: 'Broche', estoque: 5, custo: 4, preco: 25 });
    ids.insumoB = await criarProduto(B, { sku: 'EMB-B', nome: 'Embalagem B', tipo: 'insumo', estoque: 10, custo: 1 });

    expect((await criarFicha(A, ids.colar, [
        { insumo_produto_id: ids.embalagem, quantidade: 1 },
        { insumo_produto_id: ids.tag, quantidade: 2 }
    ])).status).toBe(201);
    expect((await criarFicha(A, ids.anel, [{ insumo_produto_id: ids.embalagem, quantidade: 1 }])).status).toBe(201);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('baixa automática dos insumos na venda', () => {
    test('vender 2 colares baixa embalagem (2) e tag (parcial: só havia 1), sem bloquear a venda', async () => {
        const res = await vender(A, [{ produto_id: ids.colar, quantidade: 2 }]);
        expect(res.status).toBe(201);
        ids.vendaFalta = res.body.data.id;

        // Produto vendido saiu normalmente; embalagem baixou 2; tag tinha 1 e baixou 1 (pedia 4).
        expect(await saldo(A, ids.colar)).toBe(48);
        expect(await saldo(A, ids.embalagem)).toBe(8);
        expect(await saldoCentral(A, ids.embalagem)).toBe(8);
        expect(await saldo(A, ids.tag)).toBe(0);

        const linhas = await consumos(ids.vendaFalta);
        const emb = linhas.find((l) => l.produto_id === ids.embalagem);
        const tag = linhas.find((l) => l.produto_id === ids.tag);
        expect(emb).toMatchObject({ quantidade_prevista: 2, quantidade_baixada: 2, origem: 'ficha', local_id: A.centralId });
        expect(Number(emb.custo_unitario)).toBe(0.8);
        expect(tag).toMatchObject({ quantidade_prevista: 4, quantidade_baixada: 1 });
        expect(tag.devolvido_em).toBeNull();
    });

    test('as saídas ficam na movimentação de estoque (auditadas) e o estoque nunca fica negativo', async () => {
        const { rows } = await db.query(
            `SELECT produto_id, tipo, quantidade, motivo FROM movimentacoes_estoque WHERE empresa_id = $1 AND motivo = $2 ORDER BY produto_id`,
            [A.empresaId, `Consumo venda #${ids.vendaFalta}`]
        );
        expect(rows.map((r) => [r.produto_id, r.tipo, r.quantidade])).toEqual([
            [ids.embalagem, 'saida', 2],
            [ids.tag, 'saida', 1]
        ]);
        const { rows: neg } = await db.query('SELECT 1 FROM estoque_locais WHERE empresa_id = $1 AND saldo < 0', [A.empresaId]);
        expect(neg).toHaveLength(0);
    });

    test('produto sem ficha de venda não gera consumo', async () => {
        const res = await vender(A, [{ produto_id: ids.semFicha, quantidade: 1 }]);
        expect(res.status).toBe(201);
        expect(await consumos(res.body.data.id)).toHaveLength(0);
    });

    test('dois produtos com o mesmo insumo na mesma venda: uma linha de snapshot por ficha, saldo somado', async () => {
        const res = await vender(A, [{ produto_id: ids.colar, quantidade: 1 }, { produto_id: ids.anel, quantidade: 3 }]);
        expect(res.status).toBe(201);
        const emb = (await consumos(res.body.data.id)).filter((l) => l.produto_id === ids.embalagem);
        expect(emb.map((l) => l.quantidade_prevista).sort()).toEqual([1, 3]);
        expect(await saldo(A, ids.embalagem)).toBe(4); // 8 - 1 - 3
        ids.vendaDupla = res.body.data.id;
    });

    test('mudar a ficha depois não altera o snapshot de vendas antigas', async () => {
        const nova = await criarFicha(A, ids.colar, [{ insumo_produto_id: ids.embalagem, quantidade: 5 }]);
        expect(nova.status).toBe(201);
        const antigas = await consumos(ids.vendaFalta);
        expect(antigas.find((l) => l.produto_id === ids.embalagem).quantidade_prevista).toBe(2);
        // restaura a ficha original para os próximos testes
        await criarFicha(A, ids.colar, [
            { insumo_produto_id: ids.embalagem, quantidade: 1 },
            { insumo_produto_id: ids.tag, quantidade: 2 }
        ]);
    });
});

describe('pendência de insumo no sino', () => {
    test('admin e estoquista recebem o aviso de insumo que faltou; vendedor não', async () => {
        const admin = await sino(A, 'admin');
        const aviso = admin.body.data.itens.find((i) => i.tipo === 'insumo_pendente' && i.produto_id === ids.tag);
        expect(aviso).toBeTruthy();
        expect(aviso.dados.quantidade_pendente).toBeGreaterThan(0);
        expect(aviso.prioridade).toBe('alta');

        const estoquista = await sino(A, 'estoquista');
        expect(estoquista.body.data.itens.some((i) => i.tipo === 'insumo_pendente')).toBe(true);

        const vendedor = await sino(A, 'vendedor');
        expect(vendedor.body.data.itens.some((i) => i.tipo === 'insumo_pendente')).toBe(false);
    });

    test('o aviso não traz custo, margem nem lucro', async () => {
        const admin = await sino(A, 'admin');
        const aviso = admin.body.data.itens.find((i) => i.tipo === 'insumo_pendente');
        expect(JSON.stringify(aviso)).not.toMatch(/custo|margem|lucro/i);
    });

    test('outra empresa não enxerga pendências desta', async () => {
        const res = await sino(B, 'admin');
        expect(res.body.data.itens.some((i) => i.tipo === 'insumo_pendente')).toBe(false);
    });
});

describe('cancelamento devolve os insumos', () => {
    test('cancelar a venda devolve ao Central só o que foi baixado e encerra a pendência', async () => {
        const antesEmb = await saldo(A, ids.embalagem);
        const antesTag = await saldo(A, ids.tag);
        const pendenteAntes = (await sino(A, 'admin')).body.data.itens
            .find((i) => i.tipo === 'insumo_pendente' && i.produto_id === ids.tag).dados.quantidade_pendente;

        const res = await request(app)
            .patch(`/vendas/${ids.vendaFalta}/cancelar`)
            .set(como(A, 'admin'))
            .send({ motivo: 'Cliente desistiu da compra' });
        expect(res.status).toBe(200);

        expect(await saldo(A, ids.embalagem)).toBe(antesEmb + 2);
        expect(await saldo(A, ids.tag)).toBe(antesTag + 1);
        expect(await saldo(A, ids.colar)).toBeGreaterThanOrEqual(47);

        const linhas = await consumos(ids.vendaFalta);
        expect(linhas.every((l) => l.devolvido_em !== null)).toBe(true);

        // A pendência desta venda (4 previstas - 1 baixada = 3) some do sino; a da outra venda (2) continua.
        const aviso = (await sino(A, 'admin')).body.data.itens.find((i) => i.tipo === 'insumo_pendente' && i.produto_id === ids.tag);
        expect(pendenteAntes - aviso.dados.quantidade_pendente).toBe(3);
        expect(aviso.dados.quantidade_pendente).toBe(2);

        const { rows } = await db.query(
            `SELECT 1 FROM movimentacoes_estoque WHERE empresa_id = $1 AND motivo = $2 AND tipo = 'entrada'`,
            [A.empresaId, `Devolução consumo venda #${ids.vendaFalta}`]
        );
        expect(rows.length).toBe(2);
    });

    test('a soma dos saldos por local continua fechando com o total (invariante)', async () => {
        const { rows } = await db.query(
            `SELECT p.id FROM produtos p
             WHERE p.empresa_id = $1
               AND p.estoque_atual <> COALESCE((SELECT SUM(saldo) FROM estoque_locais el WHERE el.produto_id = p.id), 0)`,
            [A.empresaId]
        );
        expect(rows).toHaveLength(0);
    });
});

describe('isolamento por empresa', () => {
    test('ficha de venda não aceita insumo de outra empresa (consumo nunca cruza tenants)', async () => {
        const res = await criarFicha(A, ids.anel, [{ insumo_produto_id: ids.insumoB, quantidade: 1 }]);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
    });
});

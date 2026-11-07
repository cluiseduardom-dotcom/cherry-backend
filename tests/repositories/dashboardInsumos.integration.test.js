// Integração (Postgres de testes): os indicadores do Dashboard (curva ABC, giro, cobertura) e o
// relatório de giro/cobertura contam só produtos ACABADOS; insumos ficam de fora, mesmo ativos e com
// estoque/venda. Empresa própria e temporária.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const dashboardRepository = require('../../src/repositories/dashboardRepository');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const E = {};

const inserir = async (sql, params) => (await db.query(sql, params)).rows[0].id;

beforeAll(async () => {
    E.id = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Dash Insumos ${sufixo}`]));
    const canalId = await inserir(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'Loja') RETURNING id`, [E.id]);

    const produto = (nome, tipo, estoque) => inserir(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual, tipo) VALUES ($1, $2, 50, 20, $3, $4) RETURNING id`,
        [E.id, nome, estoque, tipo]
    );

    E.acabado = await produto('Anel acabado', 'acabado', 10);
    E.insumo = await produto('Saquinho zip', 'insumo', 500);

    const vendaId = await inserir(
        `INSERT INTO vendas (empresa_id, canal_id, status, total, data) VALUES ($1, $2, 'finalizada', 150, NOW()) RETURNING id`,
        [E.id, canalId]
    );
    for (const [produtoId, quantidade] of [[E.acabado, 2], [E.insumo, 100]]) {
        await db.query(
            `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES ($1, $2, $3, $4, 50, 20)`,
            [E.id, vendaId, produtoId, quantidade]
        );
    }
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('Dashboard conta só produtos acabados', () => {
    test('curva ABC: o insumo não aparece e o faturamento total é só do acabado', async () => {
        const curva = await dashboardRepository.getCurvaABC(E.id);

        expect(curva.map((p) => p.id)).toEqual([E.acabado]);
        expect(Number(curva[0].faturamento)).toBe(100);
        expect(curva[0].curva).toBe('A');
    });

    test('giro e cobertura: o insumo não aparece', async () => {
        const rows = await dashboardRepository.getGiroECobertura(90, E.id);

        expect(rows.map((p) => p.id)).toEqual([E.acabado]);
        expect(Number(rows[0].giro)).toBe(0.2);
    });

    test('base do relatório agregado: o insumo não aparece', async () => {
        const rows = await dashboardRepository.getVendasEstoquePorProduto(90, E.id);

        expect(rows.map((p) => p.id)).toEqual([E.acabado]);
    });
});

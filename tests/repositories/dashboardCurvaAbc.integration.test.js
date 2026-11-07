// Integração (Postgres de testes): classe da Curva ABC do Dashboard. O produto que cruza o limite
// fica na classe que o limite fecha (classe pelo acumulado ANTES do produto). Empresa própria.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const dashboardRepository = require('../../src/repositories/dashboardRepository');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const inserir = async (sql, params) => (await db.query(sql, params)).rows[0].id;

async function empresaComFaturamentos(rotulo, faturamentos) {
    const empresaId = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ABC ${rotulo} ${sufixo}`]));
    const canalId = await inserir(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'Loja') RETURNING id`, [empresaId]);

    for (const [i, valor] of faturamentos.entries()) {
        const produtoId = await inserir(
            `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, $3, 1, 10) RETURNING id`,
            [empresaId, `P${i + 1}`, valor]
        );
        const vendaId = await inserir(
            `INSERT INTO vendas (empresa_id, canal_id, status, total, data) VALUES ($1, $2, 'finalizada', $3, NOW()) RETURNING id`,
            [empresaId, canalId, valor]
        );
        await db.query(
            `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES ($1, $2, $3, 1, $4, 1)`,
            [empresaId, vendaId, produtoId, valor]
        );
    }

    return empresaId;
}

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('Curva ABC do Dashboard: classe pelo acumulado antes do produto', () => {
    test('5000/3000/1000/600/400: acumulado 50/80/90/96/100 -> A, A, B, B, C', async () => {
        const empresaId = await empresaComFaturamentos('cinco', [5000, 3000, 1000, 600, 400]);

        const curva = await dashboardRepository.getCurvaABC(empresaId);

        expect(curva.map((p) => p.nome)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
        expect(curva.map((p) => p.curva)).toEqual(['A', 'A', 'B', 'B', 'C']);
    });

    test('um único produto com todo o faturamento é A (cruza o limite, mas é o primeiro)', async () => {
        const empresaId = await empresaComFaturamentos('um', [100]);

        const curva = await dashboardRepository.getCurvaABC(empresaId);

        expect(curva.map((p) => p.curva)).toEqual(['A']);
    });

    test('produto dominante (90%) é A; o resto segue o acumulado anterior', async () => {
        const empresaId = await empresaComFaturamentos('dominante', [900, 60, 40]);

        const curva = await dashboardRepository.getCurvaABC(empresaId);

        expect(curva.map((p) => p.curva)).toEqual(['A', 'B', 'C']);
    });
});

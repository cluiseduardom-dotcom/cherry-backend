// Integração de verdade (Postgres de testes): venda CANCELADA nunca conta como venda em relatórios,
// rankings, curva ABC, giro, preço sugerido etc. Só 'finalizada' conta (mesma regra do dashboard).
// Empresas e dados próprios e temporários; remove tudo no fim.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const vendasRepository = require('../../src/repositories/vendasRepository');
const produtosRepository = require('../../src/repositories/produtosRepository');
const clientesRepository = require('../../src/repositories/clientesRepository');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');

const E = {};

async function inserir(sql, params) {
    return (await db.query(sql, params)).rows[0].id;
}

async function criarVenda({ empresaId, canalId, clienteId, status, total, itens }) {
    const vendaId = await inserir(
        `INSERT INTO vendas (empresa_id, cliente_id, canal_id, status, total, data) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
        [empresaId, clienteId, canalId, status, total]
    );

    for (const item of itens) {
        await db.query(
            `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [empresaId, vendaId, item.produtoId, item.quantidade, item.preco, item.custo]
        );
    }

    return vendaId;
}

beforeAll(async () => {
    E.id = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Canceladas ${sufixo}`]));
    const outra = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Canceladas Outra ${sufixo}`]));

    const canalId = await inserir(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'Loja') RETURNING id`, [E.id]);
    const canalOutra = await inserir(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'Loja') RETURNING id`, [outra]);

    const produto = (empresaId, nome) => inserir(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 50, 20, 100) RETURNING id`,
        [empresaId, nome]
    );

    // P1: 2 un. vendidas de verdade + 5 un. em venda cancelada. P2: só vendida em venda cancelada.
    E.p1 = await produto(E.id, 'Anel vendido');
    E.p2 = await produto(E.id, 'Brinco so cancelado');
    // P3: 1 un. vendida de verdade + 25 un. em venda cancelada (as 25 cruzariam as faixas de preço/decisão).
    E.p3 = await produto(E.id, 'Colar de faixa');
    const pOutra = await produto(outra, 'Produto de outra empresa');

    const cliente = (empresaId, nome) => inserir(`INSERT INTO clientes (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [empresaId, nome]);
    E.c1 = await cliente(E.id, 'Cliente com venda valida');
    E.c2 = await cliente(E.id, 'Cliente so com cancelada');
    const cOutra = await cliente(outra, 'Cliente de outra empresa');

    E.vendaOk = await criarVenda({
        empresaId: E.id, canalId, clienteId: E.c1, status: 'finalizada', total: 100,
        itens: [{ produtoId: E.p1, quantidade: 2, preco: 50, custo: 20 }],
    });
    E.vendaCancelada1 = await criarVenda({
        empresaId: E.id, canalId, clienteId: E.c1, status: 'cancelada', total: 250,
        itens: [{ produtoId: E.p1, quantidade: 5, preco: 50, custo: 20 }],
    });
    E.vendaCancelada2 = await criarVenda({
        empresaId: E.id, canalId, clienteId: E.c2, status: 'cancelada', total: 150,
        itens: [{ produtoId: E.p2, quantidade: 3, preco: 50, custo: 20 }],
    });

    await criarVenda({
        empresaId: E.id, canalId, clienteId: E.c1, status: 'finalizada', total: 50,
        itens: [{ produtoId: E.p3, quantidade: 1, preco: 50, custo: 20 }],
    });
    await criarVenda({
        empresaId: E.id, canalId, clienteId: E.c1, status: 'cancelada', total: 1250,
        itens: [{ produtoId: E.p3, quantidade: 25, preco: 50, custo: 20 }],
    });

    // Venda finalizada de OUTRA empresa: não pode aparecer em nada daqui.
    await criarVenda({
        empresaId: outra, canalId: canalOutra, clienteId: cOutra, status: 'finalizada', total: 999,
        itens: [{ produtoId: pOutra, quantidade: 9, preco: 111, custo: 1 }],
    });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

const porId = (linhas, id) => linhas.find((l) => Number(l.id) === Number(id));

describe('vendasRepository — só venda finalizada conta', () => {
    test('resumo', async () => {
        const r = await vendasRepository.getResumo(E.id);
        expect(Number(r.total_vendas)).toBe(2);
        expect(Number(r.faturamento)).toBe(150);
        expect(Number(r.ticket_medio)).toBe(75);
    });

    test('por dia', async () => {
        const linhas = await vendasRepository.getPorDia(E.id);
        expect(linhas).toHaveLength(1);
        expect(Number(linhas[0].total_vendas)).toBe(2);
        expect(Number(linhas[0].faturamento)).toBe(150);
    });

    test('por mês', async () => {
        const linhas = await vendasRepository.getPorMes(E.id);
        expect(linhas).toHaveLength(1);
        expect(Number(linhas[0].total_vendas)).toBe(2);
        expect(Number(linhas[0].faturamento)).toBe(150);
    });

    test('mais vendidos do período: 2 un. de P1, 1 un. de P3 e P2 ausente', async () => {
        const linhas = await vendasRepository.getMaisVendidosPeriodo(E.id);
        expect(linhas).toHaveLength(2);
        expect(Number(porId(linhas, E.p1).total_vendido)).toBe(2);
        expect(Number(porId(linhas, E.p3).total_vendido)).toBe(1);
        expect(porId(linhas, E.p2)).toBeUndefined();
    });
});

describe('produtosRepository — itens de venda cancelada não entram', () => {
    test('giro e mais vendidos: P1 com 2 un.; P2 ausente', async () => {
        for (const consulta of [produtosRepository.getGiro, produtosRepository.getMaisVendidos]) {
            const linhas = await consulta(E.id);
            expect(Number(porId(linhas, E.p1).total_vendido)).toBe(2);
            expect(porId(linhas, E.p2)).toBeUndefined();
        }
    });

    test('curva ABC: faturamento de P1 = 100 (não 350); P2 ausente', async () => {
        const linhas = await produtosRepository.getCurvaABC(E.id);
        expect(Number(porId(linhas, E.p1).faturamento)).toBe(100);
        expect(porId(linhas, E.p2)).toBeUndefined();
    });

    test('lucro: P1 = 2 un., faturamento 100, lucro 60; P2 continua listado com zero', async () => {
        const linhas = await produtosRepository.getLucroPorProduto(E.id);
        const p1 = porId(linhas, E.p1);
        expect(Number(p1.total_vendido)).toBe(2);
        expect(Number(p1.faturamento)).toBe(100);
        expect(Number(p1.custo_total)).toBe(40);
        expect(Number(p1.lucro)).toBe(60);
        expect(Number(p1.margem_percentual)).toBe(60);

        const p2 = porId(linhas, E.p2);
        expect(Number(p2.total_vendido)).toBe(0);
        expect(Number(p2.faturamento)).toBe(0);
        expect(Number(p2.lucro)).toBe(0);
    });

    test('parados: P2 (só tinha venda cancelada) é produto parado; P1 não', async () => {
        const linhas = await produtosRepository.getParados(E.id);
        expect(porId(linhas, E.p2)).toBeDefined();
        expect(porId(linhas, E.p2).ultima_venda).toBeNull();
        expect(porId(linhas, E.p1)).toBeUndefined();
    });

    test.each([
        ['getReposicao', produtosRepository.getReposicao],
        ['getInteligencia', produtosRepository.getInteligencia],
        ['getAcoes', produtosRepository.getAcoes],
        ['getPricingProfissional', produtosRepository.getPricingProfissional],
    ])('%s: quantidade vendida de P1 = 2 e de P2 = 0', async (_nome, consulta) => {
        const linhas = await consulta(E.id);
        const p1 = porId(linhas, E.p1);
        const p2 = porId(linhas, E.p2);
        const vendido = (l) => Number(l.total_vendido ?? l.vendido);

        expect(vendido(p1)).toBe(2);
        expect(vendido(p2)).toBe(0);
    });

    test('faixas de preço/decisão/reposição ignoram as 25 un. canceladas de P3', async () => {
        const sugestao = porId(await produtosRepository.getSugestaoPreco(E.id), E.p3);
        expect(Number(sugestao.preco_sugerido)).toBe(64); // custo 20 x 3,2 (faixa < 10 un.), não x 4

        const inteligencia = porId(await produtosRepository.getInteligencia(E.id), E.p3);
        expect(Number(inteligencia.total_vendido)).toBe(1);
        expect(inteligencia.decisao).toBe('LIQUIDAR');

        const reposicao = porId(await produtosRepository.getReposicao(E.id), E.p3);
        expect(Number(reposicao.vendido)).toBe(1);
        expect(reposicao.status).toBe('REPOR URGENTE');
    });

    test('dashboard de produtos: 2 vendas finalizadas, faturamento 150', async () => {
        const r = await produtosRepository.getDashboard(E.id);
        expect(Number(r.total_vendas)).toBe(2);
        expect(Number(r.faturamento)).toBe(150);
        expect(Number(r.ticket_medio)).toBe(75);
    });
});

describe('clientesRepository — ranking e total gasto só com venda finalizada', () => {
    test('ranking: C1 gastou 150 em 2 compras; C2 aparece com zero', async () => {
        const linhas = await clientesRepository.getRanking(E.id);
        const c1 = porId(linhas, E.c1);
        const c2 = porId(linhas, E.c2);

        expect(Number(c1.total_compras)).toBe(2);
        expect(Number(c1.total_gasto)).toBe(150);
        expect(Number(c1.ticket_medio)).toBe(75);
        expect(Number(c2.total_compras)).toBe(0);
        expect(Number(c2.total_gasto)).toBe(0);
        // Nada de outra empresa.
        expect(linhas).toHaveLength(2);
    });

    test('total gasto', async () => {
        const c1 = await clientesRepository.getTotalGasto(E.c1, E.id);
        expect(Number(c1.total_compras)).toBe(2);
        expect(Number(c1.total_gasto)).toBe(150);

        const c2 = await clientesRepository.getTotalGasto(E.c2, E.id);
        expect(Number(c2.total_compras)).toBe(0);
        expect(Number(c2.total_gasto)).toBe(0);
    });

    test('histórico mantém a venda cancelada, mas marcada com status_venda', async () => {
        const linhas = await clientesRepository.getHistorico(E.c1, E.id);
        const status = Object.fromEntries(linhas.map((l) => [Number(l.venda_id), l.status_venda]));

        expect(status[E.vendaOk]).toBe('finalizada');
        expect(status[E.vendaCancelada1]).toBe('cancelada');
    });
});

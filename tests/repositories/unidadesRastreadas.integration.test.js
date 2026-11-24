// Integração (Postgres de testes): ciclo do rastreio por IMEI/série (ADR-008) — entrada, venda, cancelamento da venda,
// cancelamento da compra, duplicidade, isolamento por empresa e regras de ligar/desligar o rastreio. Empresas próprias.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const unidadesRepository = require('../../src/repositories/unidadesRastreadasRepository');
const produtosRepository = require('../../src/repositories/produtosRepository');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const inserir = async (sql, params) => (await db.query(sql, params)).rows[0].id;

const IMEI_A = '490154203237518';
const IMEI_B = '356938035643809';

async function novaEmpresa(rotulo) {
    return registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste IMEI ${rotulo} ${sufixo}`]));
}

async function novoProduto(empresaId, { rastreia = true } = {}) {
    return inserir(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual, rastreia_unidade) VALUES ($1, 'iPhone teste', 5000, 3000, 0, $2) RETURNING id`,
        [empresaId, rastreia]
    );
}

async function emTransacao(fn) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const r = await fn(client);
        await client.query('COMMIT');
        return r;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

const mov = (empresa_id, produto_id, tipo, quantidade, rastreio, extra = {}) => (client) =>
    estoqueRepository.criarMovimentacao({ empresa_id, produto_id, tipo, quantidade, motivo: 'teste', origem: 'teste', rastreio, ...extra }, client);

const statusDe = async (empresaId, identificador) =>
    (await db.query('SELECT status FROM unidades_rastreadas WHERE empresa_id = $1 AND identificador = $2', [empresaId, identificador])).rows[0]?.status;

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('rastreio por IMEI/série', () => {
    test('entrada cria uma unidade por IMEI, saída por venda marca vendida e cancelamento devolve ao estoque', async () => {
        const empresaId = await novaEmpresa('ciclo');
        const produtoId = await novoProduto(empresaId);

        await emTransacao(mov(empresaId, produtoId, 'entrada', 2, { identificadores: [IMEI_A, IMEI_B] }));
        expect(await statusDe(empresaId, IMEI_A)).toBe('em_estoque');
        expect(Number((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual)).toBe(2);

        await emTransacao(mov(empresaId, produtoId, 'saida', 1, { identificadores: [IMEI_A], destinoSaida: 'vendida' }));
        expect(await statusDe(empresaId, IMEI_A)).toBe('vendida');
        expect(await statusDe(empresaId, IMEI_B)).toBe('em_estoque');

        await emTransacao(mov(empresaId, produtoId, 'entrada', 1, { identificadores: [IMEI_A], reativar: true }));
        expect(await statusDe(empresaId, IMEI_A)).toBe('em_estoque');

        const historico = await unidadesRepository.buscarComHistorico({ empresa_id: empresaId, identificador: IMEI_A });
        expect(historico.eventos.map((e) => e.evento)).toEqual(['entrada', 'venda', 'cancelamento_venda']);
    });

    test('vender IMEI que não está em estoque, de outro produto ou inexistente é recusado (409) e nada muda', async () => {
        const empresaId = await novaEmpresa('venda-invalida');
        const produtoId = await novoProduto(empresaId);
        const outroProdutoId = await novoProduto(empresaId);

        await emTransacao(mov(empresaId, produtoId, 'entrada', 1, { identificadores: [IMEI_A] }));
        await emTransacao(mov(empresaId, outroProdutoId, 'entrada', 1, { identificadores: [IMEI_B] }));

        await expect(emTransacao(mov(empresaId, produtoId, 'saida', 1, { identificadores: [IMEI_B], destinoSaida: 'vendida' })))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(emTransacao(mov(empresaId, produtoId, 'saida', 1, { identificadores: ['ZZZZZ99999'], destinoSaida: 'vendida' })))
            .rejects.toMatchObject({ statusCode: 409 });

        expect(Number((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual)).toBe(1);
        expect(await statusDe(empresaId, IMEI_A)).toBe('em_estoque');
    });

    test('IMEI duplicado na mesma empresa é 409 e reverte o saldo; em outra empresa é permitido', async () => {
        const empresaId = await novaEmpresa('dup-a');
        const outraEmpresaId = await novaEmpresa('dup-b');
        const produtoId = await novoProduto(empresaId);
        const produtoOutra = await novoProduto(outraEmpresaId);

        await emTransacao(mov(empresaId, produtoId, 'entrada', 1, { identificadores: [IMEI_A] }));

        await expect(emTransacao(mov(empresaId, produtoId, 'entrada', 1, { identificadores: [IMEI_A] })))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(Number((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual)).toBe(1);

        await emTransacao(mov(outraEmpresaId, produtoOutra, 'entrada', 1, { identificadores: [IMEI_A] }));
        expect(await statusDe(outraEmpresaId, IMEI_A)).toBe('em_estoque');

        // isolamento: a consulta de uma empresa não enxerga a unidade da outra
        const listaA = await unidadesRepository.listar({ empresa_id: empresaId, limit: 50, offset: 0 });
        expect(listaA.items).toHaveLength(1);
        expect(await unidadesRepository.buscarComHistorico({ empresa_id: outraEmpresaId + 999999, identificador: IMEI_A })).toBeNull();
    });

    test('produto rastreado exige identificadores; produto comum recusa; quantidade tem que bater', async () => {
        const empresaId = await novaEmpresa('regras');
        const rastreado = await novoProduto(empresaId);
        const comum = await novoProduto(empresaId, { rastreia: false });

        await expect(emTransacao(mov(empresaId, rastreado, 'entrada', 1, undefined))).rejects.toMatchObject({ statusCode: 400 });
        await expect(emTransacao(mov(empresaId, rastreado, 'entrada', 2, { identificadores: [IMEI_A] }))).rejects.toMatchObject({ statusCode: 400 });
        await expect(emTransacao(mov(empresaId, comum, 'entrada', 1, { identificadores: [IMEI_A] }))).rejects.toMatchObject({ statusCode: 400 });

        await emTransacao(mov(empresaId, comum, 'entrada', 3, undefined));
        expect(Number((await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [comum])).rows[0].estoque_atual)).toBe(3);

        await expect(emTransacao(mov(empresaId, rastreado, 'ajuste', 5, undefined))).rejects.toMatchObject({ statusCode: 409 });
    });

    test('cancelar compra baixa as unidades dela; bloqueia se alguma já foi vendida', async () => {
        const empresaId = await novaEmpresa('compra');
        const produtoId = await novoProduto(empresaId);
        const compraId = await inserir(
            `INSERT INTO fornecedores (empresa_id, nome) VALUES ($1, 'Forn') RETURNING id`, [empresaId]
        ).then((fornecedorId) => inserir(
            `INSERT INTO compras (empresa_id, fornecedor_id, data_compra, forma_pagamento, status, valor_total) VALUES ($1, $2, CURRENT_DATE, 'a_vista', 'recebido', 0) RETURNING id`,
            [empresaId, fornecedorId]
        ));

        await emTransacao(mov(empresaId, produtoId, 'entrada', 2, { identificadores: [IMEI_A, IMEI_B], compra_id: compraId }));
        await emTransacao(mov(empresaId, produtoId, 'saida', 1, { identificadores: [IMEI_A], destinoSaida: 'vendida' }));

        // Saldo 1 < 2: o próprio guard de estoque recusa (o service transforma em 409).
        expect(await emTransacao(mov(empresaId, produtoId, 'saida', 2, { baixarDaCompraId: compraId }))).toEqual({ erro: 'ESTOQUE_INSUFICIENTE' });

        // Saldo suficiente por outra entrada, mas A continua vendida: a baixa da compra é recusada (409) e nada muda.
        await emTransacao(mov(empresaId, produtoId, 'entrada', 1, { identificadores: ['SERIE00001'] }));
        await expect(emTransacao(mov(empresaId, produtoId, 'saida', 2, { baixarDaCompraId: compraId }))).rejects.toMatchObject({ statusCode: 409 });
        expect(await statusDe(empresaId, IMEI_B)).toBe('em_estoque');

        await emTransacao(mov(empresaId, produtoId, 'entrada', 1, { identificadores: [IMEI_A], reativar: true }));
        await emTransacao(mov(empresaId, produtoId, 'saida', 2, { baixarDaCompraId: compraId }));
        expect(await statusDe(empresaId, IMEI_A)).toBe('baixada');
        expect(await statusDe(empresaId, IMEI_B)).toBe('baixada');
    });

    test('ligar o rastreio só em produto sem histórico; desligar só sem unidade em estoque', async () => {
        const empresaId = await novaEmpresa('toggle');
        const comHistorico = await novoProduto(empresaId, { rastreia: false });
        await emTransacao(mov(empresaId, comHistorico, 'entrada', 1, undefined));

        await expect(produtosRepository.definirRastreioUnidade(comHistorico, true, empresaId)).rejects.toMatchObject({ statusCode: 409 });

        const novo = await novoProduto(empresaId, { rastreia: false });
        expect((await produtosRepository.definirRastreioUnidade(novo, true, empresaId)).rastreia_unidade).toBe(true);

        await emTransacao(mov(empresaId, novo, 'entrada', 1, { identificadores: [IMEI_A] }));
        await expect(produtosRepository.definirRastreioUnidade(novo, false, empresaId)).rejects.toMatchObject({ statusCode: 409 });

        await emTransacao(mov(empresaId, novo, 'saida', 1, { identificadores: [IMEI_A], destinoSaida: 'baixada' }));
        expect((await produtosRepository.definirRastreioUnidade(novo, false, empresaId)).rastreia_unidade).toBe(false);

        // outra empresa não consegue mexer no produto
        const outraEmpresaId = await novaEmpresa('toggle-b');
        await expect(produtosRepository.definirRastreioUnidade(novo, true, outraEmpresaId)).rejects.toMatchObject({ statusCode: 404 });
    });
});

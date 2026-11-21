// Integração (Postgres de testes): relatórios de gestão (vendas, desempenho, produtos, inventário, crédito).
// Totais e comparativo, estornada/cancelada fora, custo só para ver_custos, cobertura/curva, aging com
// recebimento parcial, fiado só com a funcionalidade, RBAC por rota e isolamento entre empresas.
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

const A = { u: {}, p: {}, l: {}, c: {} };
const B = { u: {}, p: {}, l: {}, c: {} };
const v = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Relatorios ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canais = {};
    for (const nome of ['Loja', 'Online']) {
        alvo.canais[nome] = (await db.query(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [alvo.empresaId, nome])).rows[0].id;
    }
    for (const papel of ['admin', 'vendedor', 'supervisor', 'gerente', 'financeiro', 'estoquista']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
}

async function criarProduto(alvo, chave, { custo, estoque, minimo = 0, tipo = 'acabado', ativo = true }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, estoque_minimo, tipo, ativo)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8) RETURNING id`,
        [alvo.empresaId, `REL-${chave}-${alvo.empresaId}-${sufixo}`, `Produto ${chave}`, custo, estoque, minimo, tipo, ativo]
    );
    alvo.p[chave] = rows[0].id;
}

async function criarVenda(alvo, { data, status = 'finalizada', canal = 'Loja', cliente = null, vendedor = 'vendedor', desconto = 0, itens, comissao = null, pagamento = null }) {
    const subtotal = itens.reduce((soma, [, qtd, preco]) => soma + qtd * preco, 0);
    const { rows } = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, cliente_id, usuario_id, status, subtotal, desconto, juros, total, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9) RETURNING id`,
        [alvo.empresaId, alvo.canais[canal], cliente, alvo.u[vendedor], status, subtotal, desconto, subtotal - desconto, data]
    );
    for (const [produto, quantidade, preco, custo] of itens) {
        await db.query(
            `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES ($1, $2, $3, $4, $5, $6)`,
            [alvo.empresaId, rows[0].id, alvo.p[produto], quantidade, preco, custo]
        );
    }
    if (comissao) {
        await db.query(
            `INSERT INTO comissoes_venda (venda_id, empresa_id, usuario_id, percentual, base_calculo, valor, status) VALUES ($1, $2, $3, 10, $4, $5, $6)`,
            [rows[0].id, alvo.empresaId, alvo.u[vendedor], subtotal - desconto, comissao.valor, comissao.status]
        );
    }
    if (pagamento) {
        await db.query(
            `INSERT INTO pagamentos_venda (empresa_id, venda_id, forma_pagamento, valor, valor_recebido, status, origem)
             VALUES ($1, $2, $3, $4, $4, 'pago', 'manual')`,
            [alvo.empresaId, rows[0].id, pagamento.forma, pagamento.valor]
        );
    }
    return rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const MARCO = 'data_de=2026-03-01&data_ate=2026-03-31';

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    // Empresa A
    await criarProduto(A, 'P1', { custo: 10, estoque: 5, minimo: 10 });
    await criarProduto(A, 'P2', { custo: 20, estoque: 20 });
    await criarProduto(A, 'P3', { custo: 5, estoque: 8 }); // nunca vendido: capital parado
    await criarProduto(A, 'P4', { custo: 7, estoque: 9, ativo: false }); // inativo: fora do "sem venda"
    await criarProduto(A, 'I1', { custo: 2, estoque: 100, tipo: 'insumo' });

    const cliente = async (alvo, nome, anonimizado = false) =>
        (await db.query(`INSERT INTO clientes (empresa_id, nome, anonimizado) VALUES ($1, $2, $3) RETURNING id`, [alvo.empresaId, nome, anonimizado])).rows[0].id;
    A.c.c1 = await cliente(A, 'Cliente Um');
    A.c.c2 = await cliente(A, 'Nome Real Sigiloso', true);

    // 2026-03-01 é domingo. Meio-dia UTC = 09h em São Paulo, no mesmo dia.
    v.v1 = await criarVenda(A, {
        data: '2026-03-10T12:00:00Z', cliente: A.c.c1, vendedor: 'vendedor', desconto: 10,
        itens: [['P1', 2, 30, 10], ['P2', 1, 40, 20]], comissao: { valor: 9, status: 'liberada' }, pagamento: { forma: 'dinheiro', valor: 90 }
    });
    v.v2 = await criarVenda(A, {
        data: '2026-03-15T12:00:00Z', canal: 'Online', cliente: A.c.c2, vendedor: 'supervisor',
        itens: [['P2', 3, 50, 20]], comissao: { valor: 15, status: 'estornada' }, pagamento: { forma: 'pix', valor: 150 }
    });
    v.v3 = await criarVenda(A, {
        data: '2026-03-20T12:00:00Z', vendedor: 'vendedor', itens: [['P1', 1, 30, 10]], pagamento: { forma: 'dinheiro', valor: 30 }
    });
    // Cancelada: não é receita, só aparece em "canceladas".
    v.v4 = await criarVenda(A, {
        data: '2026-03-12T12:00:00Z', status: 'cancelada', vendedor: 'vendedor', itens: [['P1', 1, 70, 10]], pagamento: { forma: 'pix', valor: 70 }
    });
    // Período anterior ao de março (mesmo tamanho: 29/01 a 28/02).
    v.v5 = await criarVenda(A, { data: '2026-02-10T12:00:00Z', vendedor: 'vendedor', itens: [['P1', 1, 100, 10]] });

    // Locais e saldos por local (A)
    const local = async (alvo, chave, tipo, nome, usuario = null) => {
        alvo.l[chave] = (await db.query(
            `INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id) VALUES ($1, $2, $3, $4) RETURNING id`,
            [alvo.empresaId, tipo, nome, usuario]
        )).rows[0].id;
    };
    // A empresa nova já nasce com o local Central (e os locais de sistema): reaproveita, não recria.
    A.l.central = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [A.empresaId])).rows[0].id;
    await local(A, 'maleta', 'maleta', 'Maleta da Ana', A.u.vendedor);
    for (const [loc, prod, saldo] of [['central', 'P1', 3], ['maleta', 'P1', 2], ['central', 'P2', 20]]) {
        await db.query(`INSERT INTO estoque_locais (empresa_id, local_id, produto_id, saldo) VALUES ($1, $2, $3, $4)`, [A.empresaId, A.l[loc], A.p[prod], saldo]);
    }

    // Crédito (A): "hoje" fixo pela data_ref nos testes = 2026-11-21.
    const conta = async ({ venda, valor, vencimento, status = 'pendente', pago = 0 }) => {
        let parcelaId = null;
        if (pago > 0) {
            const { rows: pg } = await db.query(
                `INSERT INTO pagamentos_venda (empresa_id, venda_id, forma_pagamento, valor, valor_recebido, status, origem)
                 VALUES ($1, $2, 'crediario', $3, 0, 'parcial', 'manual') RETURNING id`,
                [A.empresaId, venda, valor]
            );
            parcelaId = (await db.query(
                `INSERT INTO parcelas_pagamento (empresa_id, pagamento_id, numero, valor, valor_principal, valor_pago, data_vencimento, status)
                 VALUES ($1, $2, 1, $3, $3, $4, $5, 'parcial') RETURNING id`,
                [A.empresaId, pg[0].id, valor, pago, vencimento]
            )).rows[0].id;
        }
        await db.query(
            `INSERT INTO contas_receber (empresa_id, venda_id, descricao, valor, data_vencimento, status, parcela_id) VALUES ($1, $2, 'teste', $3, $4, $5, $6)`,
            [A.empresaId, venda, valor, vencimento, status, parcelaId]
        );
    };
    // Vendas a prazo próprias, em dezembro/2025 (fora dos períodos dos outros relatórios).
    const vendaAPrazo = (cliente) => criarVenda(A, { data: '2025-12-01T12:00:00Z', cliente, itens: [['P3', 1, 10, 5]] });
    const [prazo1, prazo2, prazo3] = [await vendaAPrazo(A.c.c1), await vendaAPrazo(A.c.c2), await vendaAPrazo(null)];

    await conta({ venda: prazo1, valor: 100, vencimento: '2026-11-01', pago: 40 }); // restante 60, 20 dias de atraso
    await conta({ venda: prazo2, valor: 200, vencimento: '2026-12-01' }); // a vencer
    await conta({ venda: prazo3, valor: 50, vencimento: '2026-07-01' }); // mais de 90 dias, sem cliente
    await conta({ venda: prazo1, valor: 999, vencimento: '2026-01-01', status: 'recebido' }); // recebida: ignorada

    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'fiado', true, 'teste', 'teste')`,
        [A.empresaId]
    );
    await db.query(`INSERT INTO fiado_saldos (empresa_id, cliente_id, saldo) VALUES ($1, $2, 30)`, [A.empresaId, A.c.c1]);

    // Empresa B: valores enormes para provar que nada vaza para A.
    await criarProduto(B, 'P1', { custo: 1, estoque: 1000 });
    B.c.c1 = await cliente(B, 'Cliente B');
    await criarVenda(B, { data: '2026-03-11T12:00:00Z', cliente: B.c.c1, itens: [['P1', 100, 1000, 1]] });
    B.l.central = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [B.empresaId])).rows[0].id;
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /relatorios/vendas', () => {
    let corpo;

    beforeAll(async () => {
        const res = await get(A, 'gerente', `/relatorios/vendas?${MARCO}`);

        expect(res.status).toBe(200);
        corpo = res.body.data;
    });

    test('totais: só finalizadas, receita = subtotal − desconto, ticket médio, itens', () => {
        expect(corpo.periodo).toEqual({ data_de: '2026-03-01', data_ate: '2026-03-31', dias: 31 });
        expect(corpo.totais).toMatchObject({ vendas: 3, receita: 270, ticket_medio: 90, itens: 7, desconto: 10 });
    });

    test('com ver_custos: custo, lucro e margem (custo congelado do item)', () => {
        expect(corpo.totais).toMatchObject({ custo: 110, lucro_bruto: 160, margem_bruta_pct: 59.26 });
    });

    test('comparativo com o período anterior de mesmo tamanho', () => {
        expect(corpo.comparativo.periodo_anterior).toEqual({ data_de: '2026-01-29', data_ate: '2026-02-28' });
        expect(corpo.comparativo.vendas).toEqual({ atual: 3, anterior: 1, variacao_pct: 200 });
        expect(corpo.comparativo.receita).toEqual({ atual: 270, anterior: 100, variacao_pct: 170 });
        expect(corpo.comparativo.ticket_medio).toEqual({ atual: 90, anterior: 100, variacao_pct: -10 });
    });

    test('canceladas ficam fora da receita e aparecem à parte', () => {
        expect(corpo.canceladas).toEqual({ vendas: 1, valor: 70 });
    });

    test('por canal, ordenado por receita, com participação', () => {
        expect(corpo.por_canal.map((c) => [c.nome, c.vendas, c.receita])).toEqual([['Online', 1, 150], ['Loja', 2, 120]]);
        expect(corpo.por_canal[0].participacao_pct).toBe(55.56);
        expect(corpo.por_canal[1]).toMatchObject({ custo: 50, lucro_bruto: 70 });
    });

    test('por forma de pagamento: venda cancelada não entra', () => {
        expect(corpo.por_forma_pagamento).toEqual([
            { forma_pagamento: 'pix', vendas: 1, valor: 150 },
            { forma_pagamento: 'dinheiro', vendas: 2, valor: 120 }
        ]);
    });

    test('por dia da semana: sempre 7 linhas (0 = domingo)', () => {
        expect(corpo.por_dia_semana).toHaveLength(7);
        const por = Object.fromEntries(corpo.por_dia_semana.map((d) => [d.dia_semana, [d.vendas, d.receita]]));

        expect(por[0]).toEqual([1, 150]); // 15/03 domingo
        expect(por[2]).toEqual([1, 90]); // 10/03 terça
        expect(por[5]).toEqual([1, 30]); // 20/03 sexta
        expect(por[1]).toEqual([0, 0]);
    });

    test('top clientes: anonimizado não revela o nome', () => {
        expect(corpo.top_clientes.map((c) => [c.nome, c.receita])).toEqual([['Cliente anonimizado', 150], ['Cliente Um', 90]]);
        expect(JSON.stringify(corpo)).not.toContain('Nome Real Sigiloso');
    });

    test('sem ver_custos (supervisor): custo, lucro e margem são omitidos, não zerados', async () => {
        const res = await get(A, 'supervisor', `/relatorios/vendas?${MARCO}`);

        expect(res.status).toBe(200);
        expect(res.body.data.totais.receita).toBe(270);
        for (const campo of ['custo', 'lucro_bruto', 'margem_bruta_pct']) {
            expect(res.body.data.totais).not.toHaveProperty(campo);
            expect(res.body.data.por_canal[0]).not.toHaveProperty(campo);
        }
    });

    test('período sem vendas: zeros, sem NaN e sem divisão por zero', async () => {
        const res = await get(A, 'gerente', '/relatorios/vendas?data_de=2025-01-01&data_ate=2025-01-31');

        expect(res.status).toBe(200);
        expect(res.body.data.totais).toMatchObject({ vendas: 0, receita: 0, ticket_medio: null, margem_bruta_pct: null });
        expect(res.body.data.comparativo.receita.variacao_pct).toBeNull();
        expect(res.body.data.por_canal).toEqual([]);
    });

    test('isolamento: a venda enorme da empresa B não entra nos totais de A', () => {
        expect(corpo.totais.receita).toBe(270);
    });
});

describe('GET /relatorios/desempenho', () => {
    test('ranking por receita, comissão estornada não conta, canceladas por vendedor', async () => {
        const res = await get(A, 'gerente', `/relatorios/desempenho?${MARCO}`);

        expect(res.status).toBe(200);
        const [primeiro, segundo] = res.body.data.vendedores;

        expect(primeiro).toMatchObject({ posicao: 1, nome: `supervisor ${sufixo}`, vendas: 1, receita: 150, comissao: 0, canceladas: 0, participacao_pct: 55.56 });
        expect(segundo).toMatchObject({
            posicao: 2, nome: `vendedor ${sufixo}`, vendas: 2, receita: 120, ticket_medio: 60, itens: 4, itens_por_venda: 2, comissao: 9, canceladas: 1
        });
        expect(segundo).toMatchObject({ custo: 50, lucro_bruto: 70 });
        expect(res.body.data.totais).toEqual({ vendas: 3, receita: 270 });
    });

    test('sem ver_custos: sem custo/margem por vendedor', async () => {
        const res = await get(A, 'supervisor', `/relatorios/desempenho?${MARCO}`);

        expect(res.status).toBe(200);
        expect(res.body.data.vendedores[0]).not.toHaveProperty('custo');
        expect(res.body.data.vendedores[0]).not.toHaveProperty('margem_bruta_pct');
    });
});

describe('GET /relatorios/produtos', () => {
    test('quantidade, receita, margem, cobertura em dias, curva ABC e última venda', async () => {
        const res = await get(A, 'gerente', `/relatorios/produtos?${MARCO}`);

        expect(res.status).toBe(200);
        const [p2, p1] = res.body.data.produtos;

        expect(p2).toMatchObject({ nome: 'Produto P2', quantidade: 4, receita: 190, custo: 80, lucro_bruto: 110, curva: 'A', ultima_venda: '2026-03-15' });
        expect(p2.cobertura_dias).toBe(155); // 20 em estoque ÷ (4 vendidos / 31 dias)
        expect(p1).toMatchObject({ nome: 'Produto P1', quantidade: 3, receita: 90, custo: 30, margem_bruta_pct: 66.67, ultima_venda: '2026-03-20' });
        expect(p1.cobertura_dias).toBe(51.7);
        expect(res.body.data.totais).toEqual({ produtos_vendidos: 2, quantidade: 7 });
    });

    test('capital parado: só ativo, acabado e com estoque que não vendeu no período', async () => {
        const res = await get(A, 'gerente', `/relatorios/produtos?${MARCO}`);
        const { sem_venda: semVenda } = res.body.data;

        expect(semVenda).toMatchObject({ produtos: 1, unidades: 8, valor_custo: 40 });
        expect(semVenda.itens.map((i) => i.nome)).toEqual(['Produto P3']);
    });

    test('sem ver_custos: nenhum campo de custo; ordem=margem cai para receita', async () => {
        const res = await get(A, 'supervisor', `/relatorios/produtos?${MARCO}&ordem=margem`);

        expect(res.status).toBe(200);
        expect(res.body.data.ordem).toBe('receita');
        expect(res.body.data.produtos[0]).not.toHaveProperty('custo');
        expect(res.body.data.produtos[0]).not.toHaveProperty('margem_bruta_pct');
        expect(res.body.data.sem_venda).not.toHaveProperty('valor_custo');
        expect(res.body.data.sem_venda.itens[0]).not.toHaveProperty('valor_custo');
    });

    test('limite e ordem por quantidade', async () => {
        const res = await get(A, 'gerente', `/relatorios/produtos?${MARCO}&ordem=quantidade&limite=1`);

        expect(res.body.data.produtos).toHaveLength(1);
        expect(res.body.data.produtos[0].nome).toBe('Produto P2');
    });
});

describe('GET /relatorios/inventario', () => {
    test('posição valorizada: produto acabado com saldo (inclusive inativo), abaixo do mínimo e por local', async () => {
        const res = await get(A, 'admin', '/relatorios/inventario');

        expect(res.status).toBe(200);
        const { totais, items, por_local: porLocal } = res.body.data;

        // P4 está inativo mas tem 9 unidades na prateleira: continua no inventário (com `ativo: false`).
        expect(totais).toEqual({ produtos: 4, unidades: 42, abaixo_minimo: 1, valor_custo: 553 });
        expect(items.map((i) => [i.nome, i.saldo, i.ativo])).toEqual([
            ['Produto P1', 5, true], ['Produto P2', 20, true], ['Produto P3', 8, true], ['Produto P4', 9, false]
        ]);
        expect(items[0]).toMatchObject({ abaixo_minimo: true, custo_unitario: 10, valor_custo: 50 });
        expect(porLocal.find((l) => l.nome === 'Maleta da Ana')).toMatchObject({ produtos: 1, unidades: 2, valor_custo: 20 });
    });

    test('filtro por local usa o saldo daquele local', async () => {
        const res = await get(A, 'admin', `/relatorios/inventario?local_id=${A.l.maleta}`);

        expect(res.status).toBe(200);
        expect(res.body.data.local).toMatchObject({ nome: 'Maleta da Ana', tipo: 'maleta' });
        expect(res.body.data.items.map((i) => [i.nome, i.saldo])).toEqual([['Produto P1', 2]]);
        expect(res.body.data.totais).toMatchObject({ unidades: 2, valor_custo: 20 });
    });

    test('insumo e paginação', async () => {
        const insumo = await get(A, 'admin', '/relatorios/inventario?tipo=insumo');

        expect(insumo.body.data.totais).toMatchObject({ produtos: 1, unidades: 100, valor_custo: 200 });

        const pagina = await get(A, 'admin', '/relatorios/inventario?pageSize=3&page=2');

        expect(pagina.body.data).toMatchObject({ page: 2, pageSize: 3, totalPages: 2 });
        expect(pagina.body.data.items).toHaveLength(1);
        expect(pagina.body.data.totais.produtos).toBe(4); // o total é do filtro inteiro, não da página
    });

    test('somente_com_saldo=false inclui produto zerado', async () => {
        await criarProduto(A, 'ZERO', { custo: 1, estoque: 0 });
        const res = await get(A, 'admin', '/relatorios/inventario?somente_com_saldo=false');

        expect(res.body.data.items.some((i) => i.nome === 'Produto ZERO')).toBe(true);
    });

    test('local de outra empresa = 404', async () => {
        expect((await get(A, 'admin', `/relatorios/inventario?local_id=${B.l.central}`)).status).toBe(404);
    });

    test('estoquista vê o valor (custo operacional); vendedor não acessa', async () => {
        expect((await get(A, 'estoquista', '/relatorios/inventario')).body.data.totais).toHaveProperty('valor_custo');
        expect((await get(A, 'vendedor', '/relatorios/inventario')).status).toBe(403);
    });
});

describe('GET /relatorios/credito', () => {
    const REF = 'data_ref=2026-11-21';
    let corpo;

    beforeAll(async () => {
        const res = await get(A, 'gerente', `/relatorios/credito?${REF}`);

        expect(res.status).toBe(200);
        corpo = res.body.data;
    });

    test('totais usam o restante (recebimento parcial abatido) e ignoram conta recebida', () => {
        // 60 (100 − 40 pagos) + 200 + 50 = 310; vencido 60 + 50 = 110
        expect(corpo.totais).toMatchObject({ contas_a_receber: 310, vencido: 110, a_vencer: 200, inadimplencia_pct: 35.48, fiado: 30 });
    });

    test('aging por faixa de atraso', () => {
        const por = Object.fromEntries(corpo.aging.map((f) => [f.faixa, [f.titulos, f.valor]]));

        expect(por).toEqual({ a_vencer: [1, 200], ate_30: [1, 60], de_31_a_60: [0, 0], de_61_a_90: [0, 0], acima_90: [1, 50] });
    });

    test('por cliente: vencido, maior atraso, fiado; anonimizado e "sem cliente" sem expor nome', () => {
        const um = corpo.clientes.find((c) => c.nome === 'Cliente Um');
        const anon = corpo.clientes.find((c) => c.nome === 'Cliente anonimizado');
        const sem = corpo.clientes.find((c) => c.cliente_id === null);

        expect(um).toMatchObject({ em_aberto: 60, vencido: 60, maior_atraso_dias: 20, fiado: 30 });
        expect(anon).toMatchObject({ em_aberto: 200, vencido: 0 });
        expect(sem).toMatchObject({ nome: 'Sem cliente identificado', em_aberto: 50, maior_atraso_dias: 143 });
        expect(JSON.stringify(corpo)).not.toContain('Nome Real Sigiloso');
    });

    test('sem a funcionalidade fiado (empresa B), o fiado nem aparece', async () => {
        const res = await get(B, 'gerente', `/relatorios/credito?${REF}`);

        expect(res.status).toBe(200);
        expect(res.body.data.totais).not.toHaveProperty('fiado');
        expect(res.body.data.totais.contas_a_receber).toBe(0);
    });

    test('analista financeiro acessa; supervisor e vendedor não', async () => {
        expect((await get(A, 'financeiro', `/relatorios/credito?${REF}`)).status).toBe(200);
        expect((await get(A, 'supervisor', `/relatorios/credito?${REF}`)).status).toBe(403);
        expect((await get(A, 'vendedor', `/relatorios/credito?${REF}`)).status).toBe(403);
    });
});

describe('RBAC e validação', () => {
    test('vendas, desempenho e produtos exigem ver_vendas_de_todos', async () => {
        for (const rota of ['vendas', 'desempenho', 'produtos']) {
            expect((await get(A, 'vendedor', `/relatorios/${rota}?${MARCO}`)).status).toBe(403);
            expect((await get(A, 'estoquista', `/relatorios/${rota}?${MARCO}`)).status).toBe(403);
            expect((await get(A, 'supervisor', `/relatorios/${rota}?${MARCO}`)).status).toBe(200);
        }
    });

    test('sem token = 401', async () => {
        expect((await request(app).get(`/relatorios/vendas?${MARCO}`)).status).toBe(401);
    });

    test('datas inválidas, invertidas ou período longo demais = 400', async () => {
        expect((await get(A, 'admin', '/relatorios/vendas?data_de=2026-03-01')).status).toBe(400);
        expect((await get(A, 'admin', '/relatorios/vendas?data_de=2026-03-31&data_ate=2026-03-01')).status).toBe(400);
        expect((await get(A, 'admin', '/relatorios/vendas?data_de=2020-01-01&data_ate=2026-03-01')).status).toBe(400);
        expect((await get(A, 'admin', '/relatorios/vendas?data_de=2026-02-30&data_ate=2026-03-01')).status).toBe(400);
    });

    test('parâmetros inválidos nos demais relatórios = 400', async () => {
        expect((await get(A, 'admin', `/relatorios/produtos?${MARCO}&limite=500`)).status).toBe(400);
        expect((await get(A, 'admin', `/relatorios/produtos?${MARCO}&ordem=lucro`)).status).toBe(400);
        expect((await get(A, 'admin', '/relatorios/inventario?tipo=outro')).status).toBe(400);
        expect((await get(A, 'admin', '/relatorios/inventario?somente_com_saldo=talvez')).status).toBe(400);
        expect((await get(A, 'admin', '/relatorios/credito?data_ref=ontem')).status).toBe(400);
    });
});

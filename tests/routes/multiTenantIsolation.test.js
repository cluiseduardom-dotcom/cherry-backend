// Teste de integração de verdade: roda contra o banco real do .env (sem
// jest.mock em db/services), o único jeito de validar que o filtro por
// empresa_id realmente isola os dados entre empresas fim a fim (rota ->
// controller -> service -> repository -> Postgres).
//
// Cria uma empresa fictícia ("Empresa Teste Isolamento") com admin, canal,
// produtos, cliente, movimentação de estoque, venda e conta a pagar próprios,
// e apaga tudo isso no afterAll. A empresa 1 (a joalheria real) é só lida,
// nunca escrita.

jest.setTimeout(20000);

const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const SUFIXO = Date.now();
const SENHA_TESTE = 'senhaTeste123!';

let empresa1Id;
let empresa1AdminToken;
let produtoE1Id;
let clienteE1Id;
let vendaE1Id;
let baseline;

let empresa2Id;
let empresa2AdminToken;
let canalEmpresa2Id;
const produtosE2 = [];
let clienteE2Id;
let vendaE2Id;
let contaPagarE2Id;
let fornecedorE2Id;
let vendaPrazoE2Id;
let contaReceberE2Id;
let despesaFixaE2Id;

async function loginComo(email, senha) {
    const res = await request(app).post('/auth/login').send({ email, senha });

    if (res.status !== 200) {
        throw new Error(`Falha ao logar como ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }

    return res.body.data.token;
}

beforeAll(async () => {
    const empresa1Row = await db.query(`SELECT id FROM empresas WHERE nome = 'Cherry Semijoias'`);
    empresa1Id = empresa1Row.rows[0].id;

    const produtoE1 = await db.query('SELECT id FROM produtos WHERE empresa_id = $1 ORDER BY id LIMIT 1', [empresa1Id]);
    produtoE1Id = produtoE1.rows[0].id;

    const clienteE1 = await db.query('SELECT id FROM clientes WHERE empresa_id = $1 ORDER BY id LIMIT 1', [empresa1Id]);
    clienteE1Id = clienteE1.rows[0].id;

    const vendaE1 = await db.query('SELECT id FROM vendas WHERE empresa_id = $1 ORDER BY id LIMIT 1', [empresa1Id]);
    vendaE1Id = vendaE1.rows[0].id;

    empresa1AdminToken = await loginComo('ana@cherry.com', 'senha123');

    // snapshot da empresa 1 ANTES de a empresa 2 existir, pra comparar depois
    baseline = {
        produtos: (await request(app).get('/produtos?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        clientes: (await request(app).get('/clientes').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        vendas: (await request(app).get('/vendas?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        contasPagar: (await request(app).get('/contas-pagar?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        fornecedores: (await request(app).get('/fornecedores?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        canais: (await request(app).get('/canais-venda').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        contasReceber: (await request(app).get('/contas-receber?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        despesasFixas: (await request(app).get('/despesas-fixas').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        configuracaoFinanceira: (await request(app).get('/configuracoes-financeiras').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        compras: (await request(app).get('/compras?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        producoes: (await request(app).get('/producoes?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
        dashboard: (await request(app).get('/dashboard').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data
    };

    // --- Empresa 2 (fictícia) ---
    const empresaResult = await db.query(
        `INSERT INTO empresas (nome, cnpj, status) VALUES ('Empresa Teste Isolamento', NULL, 'ativa') RETURNING id`
    );
    empresa2Id = empresaResult.rows[0].id;

    const canalResult = await db.query(
        `INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`,
        [empresa2Id]
    );
    canalEmpresa2Id = canalResult.rows[0].id;

    const senhaHash = await bcrypt.hash(SENHA_TESTE, 10);
    const emailAdminE2 = `isolamento.admin.${SUFIXO}@teste.local`;

    await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin Empresa Teste', $2, $3, 'admin')`,
        [empresa2Id, emailAdminE2, senhaHash]
    );

    empresa2AdminToken = await loginComo(emailAdminE2, SENHA_TESTE);

    for (let i = 0; i < 2; i++) {
        const res = await request(app)
            .post('/produtos')
            .set('Authorization', `Bearer ${empresa2AdminToken}`)
            .send({
                nome: `Produto Isolamento ${i + 1}`,
                preco_venda: 100 + i,
                custo: 50 + i,
                estoque_atual: 20,
                estoque_minimo: 2
            });

        if (res.status !== 201) throw new Error(`Falha ao criar produto e2: ${res.status} ${JSON.stringify(res.body)}`);
        produtosE2.push(res.body.data.id);
    }

    const precoRes = await request(app)
        .put(`/produtos/${produtosE2[0]}/precos/${canalEmpresa2Id}`)
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ preco_venda: 120 });

    if (precoRes.status !== 201) throw new Error(`Falha ao definir preço e2: ${precoRes.status} ${JSON.stringify(precoRes.body)}`);

    const clienteRes = await request(app)
        .post('/clientes')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ nome: `Cliente Isolamento ${SUFIXO}`, email: `cliente.isolamento.${SUFIXO}@teste.local` });

    if (clienteRes.status !== 201) throw new Error(`Falha ao criar cliente e2: ${clienteRes.status} ${JSON.stringify(clienteRes.body)}`);
    clienteE2Id = clienteRes.body.data.id;

    const movRes = await request(app)
        .post(`/produtos/${produtosE2[0]}/movimentacoes`)
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ tipo: 'entrada', quantidade: 5, motivo: 'Estoque inicial teste isolamento' });

    if (movRes.status !== 201) throw new Error(`Falha ao criar movimentação e2: ${movRes.status} ${JSON.stringify(movRes.body)}`);

    const vendaRes = await request(app)
        .post('/vendas')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ cliente_id: clienteE2Id, itens: [{ produto_id: produtosE2[0], quantidade: 1 }] });

    if (vendaRes.status !== 201) throw new Error(`Falha ao criar venda e2: ${vendaRes.status} ${JSON.stringify(vendaRes.body)}`);
    vendaE2Id = vendaRes.body.data.id;

    const contaRes = await request(app)
        .post('/contas-pagar')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ descricao: `Conta Isolamento ${SUFIXO}`, valor: 250, data_vencimento: '2026-12-01' });

    if (contaRes.status !== 201) throw new Error(`Falha ao criar conta a pagar e2: ${contaRes.status} ${JSON.stringify(contaRes.body)}`);
    contaPagarE2Id = contaRes.body.data.id;

    const vendaPrazoRes = await request(app)
        .post('/vendas')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({
            cliente_id: clienteE2Id,
            itens: [{ produto_id: produtosE2[0], quantidade: 1 }],
            forma_pagamento: 'prazo',
            meses_prazo: 1
        });

    if (vendaPrazoRes.status !== 201) throw new Error(`Falha ao criar venda a prazo e2: ${vendaPrazoRes.status} ${JSON.stringify(vendaPrazoRes.body)}`);
    vendaPrazoE2Id = vendaPrazoRes.body.data.id;

    const contaReceberResult = await db.query(
        'SELECT id FROM contas_receber WHERE venda_id = $1 AND empresa_id = $2',
        [vendaPrazoE2Id, empresa2Id]
    );
    if (!contaReceberResult.rows.length) throw new Error('Falha ao criar conta a receber e2');
    contaReceberE2Id = contaReceberResult.rows[0].id;

    const fornecedorRes = await request(app)
        .post('/fornecedores')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ nome: `Fornecedor Isolamento ${SUFIXO}`, contato: 'Teste Isolamento' });

    if (fornecedorRes.status !== 201) throw new Error(`Falha ao criar fornecedor e2: ${fornecedorRes.status} ${JSON.stringify(fornecedorRes.body)}`);
    fornecedorE2Id = fornecedorRes.body.data.id;

    const compraRes = await request(app)
        .post('/compras')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({
            fornecedor_id: fornecedorE2Id,
            data_compra: '2026-09-01',
            forma_pagamento: 'a_vista',
            itens: [{ produto_id: produtosE2[0], quantidade: 1, custo_unitario: 10 }]
        });

    if (compraRes.status !== 201) throw new Error(`Falha ao criar compra e2: ${compraRes.status} ${JSON.stringify(compraRes.body)}`);
    compraE2Id = compraRes.body.data.id;

    const fichaRes = await request(app)
        .post(`/produtos/${produtosE2[1]}/ficha-tecnica`)
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ itens: [{ insumo_produto_id: produtosE2[0], quantidade_necessaria: 1 }] });

    if (fichaRes.status !== 201) throw new Error(`Falha ao criar ficha técnica e2: ${fichaRes.status} ${JSON.stringify(fichaRes.body)}`);

    const producaoRes = await request(app)
        .post('/producoes')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ produto_id: produtosE2[1], quantidade_solicitada: 2 });

    if (producaoRes.status !== 201) throw new Error(`Falha ao criar produção e2: ${producaoRes.status} ${JSON.stringify(producaoRes.body)}`);
    producaoE2Id = producaoRes.body.data.id;

    const despesaFixaRes = await request(app)
        .post('/despesas-fixas')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({
            categoria: 'estrutural',
            descricao: `Despesa Isolamento ${SUFIXO}`,
            valor: 321,
            vigencia_inicio: '2026-01-01'
        });

    if (despesaFixaRes.status !== 201) throw new Error(`Falha ao criar despesa fixa e2: ${despesaFixaRes.status} ${JSON.stringify(despesaFixaRes.body)}`);
    despesaFixaE2Id = despesaFixaRes.body.data.id;

    const configFinanceiraRes = await request(app)
        .put('/configuracoes-financeiras')
        .set('Authorization', `Bearer ${empresa2AdminToken}`)
        .send({ aliquota_imposto: 0.09 });

    if (configFinanceiraRes.status !== 200) throw new Error(`Falha ao configurar financeira e2: ${configFinanceiraRes.status} ${JSON.stringify(configFinanceiraRes.body)}`);
    if (configFinanceiraRes.body.data.empresa_id !== empresa2Id) throw new Error('Configuração financeira da empresa 2 ficou vinculada à empresa errada');
});

afterAll(async () => {
    if (empresa2Id) {
        await db.query('DELETE FROM contas_receber WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM producoes WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM itens_compra WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM itens_ficha_tecnica WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM fichas_tecnicas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM itens_venda WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM compras WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM vendas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM movimentacoes_estoque WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM precos_produto WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM contas_pagar WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM fornecedores WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM despesas_fixas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM produtos WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM clientes WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM canais_venda WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM configuracoes_financeiras WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM empresas WHERE id = $1', [empresa2Id]);
    }

    await db.end();
});

describe('empresa 1 não é afetada pela existência da empresa 2', () => {
    test('produtos, clientes, vendas, contas a pagar e dashboard da empresa 1 continuam idênticos', async () => {
        const depois = {
            produtos: (await request(app).get('/produtos?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            clientes: (await request(app).get('/clientes').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            vendas: (await request(app).get('/vendas?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            contasPagar: (await request(app).get('/contas-pagar?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            fornecedores: (await request(app).get('/fornecedores?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            canais: (await request(app).get('/canais-venda').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            contasReceber: (await request(app).get('/contas-receber?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            despesasFixas: (await request(app).get('/despesas-fixas').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            configuracaoFinanceira: (await request(app).get('/configuracoes-financeiras').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            compras: (await request(app).get('/compras?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            producoes: (await request(app).get('/producoes?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data,
            dashboard: (await request(app).get('/dashboard').set('Authorization', `Bearer ${empresa1AdminToken}`)).body.data
        };

        expect(depois).toEqual(baseline);
    });
});

describe('empresa 1 não vê dados da empresa 2', () => {
    test('GET /produtos não inclui produtos da empresa 2', async () => {
        const res = await request(app).get('/produtos?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.items.map((p) => p.id);

        expect(ids).not.toEqual(expect.arrayContaining(produtosE2));
    });

    test('GET /clientes não inclui o cliente da empresa 2', async () => {
        const res = await request(app).get('/clientes').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.map((c) => c.id);

        expect(ids).not.toContain(clienteE2Id);
    });

    test('GET /vendas não inclui a venda da empresa 2', async () => {
        const res = await request(app).get('/vendas?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.items.map((v) => v.id);

        expect(ids).not.toContain(vendaE2Id);
    });

    test('GET /contas-pagar não inclui a conta a pagar da empresa 2', async () => {
        const res = await request(app).get('/contas-pagar?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.items.map((c) => c.id);

        expect(ids).not.toContain(contaPagarE2Id);
    });

    test('GET /contas-receber não inclui a conta da empresa 2', async () => {
        const res = await request(app).get('/contas-receber?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.items.map((c) => c.id);

        expect(ids).not.toContain(contaReceberE2Id);
    });

    test('GET /fornecedores não inclui fornecedor da empresa 2', async () => {
        const res = await request(app).get('/fornecedores?pageSize=100').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.items.map((f) => f.id);

        expect(ids).not.toContain(fornecedorE2Id);
    });

    test('GET /despesas-fixas não inclui despesa da empresa 2', async () => {
        const res = await request(app).get('/despesas-fixas').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.map((d) => d.id);

        expect(ids).not.toContain(despesaFixaE2Id);
    });

    test('GET /compras não inclui compra da empresa 2', async () => {
        const res = await request(app)
            .get('/compras?pageSize=100')
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        const ids = res.body.data.items.map((c) => c.id);
        expect(ids).not.toContain(compraE2Id);
    });

    test('GET /producoes não inclui produção da empresa 2', async () => {
        const res = await request(app)
            .get('/producoes?pageSize=100')
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        const ids = res.body.data.items.map((p) => p.id);
        expect(ids).not.toContain(producaoE2Id);
    });

    test('GET /configuracoes-financeiras mantém a configuração da empresa 1', async () => {
        const res = await request(app)
            .get('/configuracoes-financeiras')
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(baseline.configuracaoFinanceira);
    });

    test('GET /canais não inclui canal da empresa 2', async () => {
        const res = await request(app).get('/canais-venda').set('Authorization', `Bearer ${empresa1AdminToken}`);
        const ids = res.body.data.map((canal) => canal.id);

        expect(ids).not.toContain(canalEmpresa2Id);
    });

    test('GET /produtos/:id/movimentacoes de um produto da empresa 2 retorna 404', async () => {
        const res = await request(app)
            .get(`/produtos/${produtosE2[0]}/movimentacoes`)
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
});

describe('empresa 2 não vê dados da empresa 1', () => {
    test('GET /produtos só retorna produtos da própria empresa 2', async () => {
        const res = await request(app).get('/produtos?pageSize=100').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data.total).toBe(2);
        expect(res.body.data.items.map((p) => p.id).sort()).toEqual([...produtosE2].sort());
    });

    test('GET /clientes só retorna o cliente da própria empresa 2', async () => {
        const res = await request(app).get('/clientes').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].id).toBe(clienteE2Id);
    });

    test('GET /vendas só retorna a venda da própria empresa 2', async () => {
        const res = await request(app).get('/vendas?pageSize=100').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data.total).toBe(2);
        expect(res.body.data.items.map((v) => v.id).sort()).toEqual([vendaE2Id, vendaPrazoE2Id].sort());
    });

    test('GET /contas-pagar só retorna a conta da própria empresa 2', async () => {
        const res = await request(app).get('/contas-pagar?pageSize=100').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data.total).toBe(1);
        expect(res.body.data.items[0].id).toBe(contaPagarE2Id);
    });

    test('GET /contas-receber só retorna a conta da própria empresa 2', async () => {
        const res = await request(app).get('/contas-receber?pageSize=100').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data.total).toBe(1);
        expect(res.body.data.items[0].id).toBe(contaReceberE2Id);
    });

    test('GET /fornecedores só retorna fornecedor da própria empresa 2', async () => {
        const res = await request(app).get('/fornecedores?pageSize=100').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data.total).toBe(1);
        expect(res.body.data.items[0].id).toBe(fornecedorE2Id);
    });

    test('GET /despesas-fixas só retorna despesa da própria empresa 2', async () => {
        const res = await request(app).get('/despesas-fixas').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].id).toBe(despesaFixaE2Id);
    });

    test('GET /compras só retorna compra da própria empresa 2', async () => {
        const res = await request(app)
            .get('/compras?pageSize=100')
            .set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(1);
        expect(res.body.data.items[0].id).toBe(compraE2Id);
    });

    test('GET /producoes só retorna produção da própria empresa 2', async () => {
        const res = await request(app)
            .get('/producoes?pageSize=100')
            .set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(1);
        expect(res.body.data.items[0].id).toBe(producaoE2Id);
    });

    test('GET /configuracoes-financeiras retorna a configuração da empresa 2', async () => {
        const res = await request(app)
            .get('/configuracoes-financeiras')
            .set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.empresa_id).toBe(empresa2Id);
        expect(res.body.data.aliquota_imposto).toBe('0.0900');
    });

    test('GET /canais só retorna canal da própria empresa 2', async () => {
        const res = await request(app).get('/canais-venda').set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].id).toBe(canalEmpresa2Id);
    });

    test('GET /produtos/:id/movimentacoes só retorna movimentações da própria empresa 2', async () => {
        const res = await request(app)
            .get(`/produtos/${produtosE2[0]}/movimentacoes`)
            .set('Authorization', `Bearer ${empresa2AdminToken}`);

        // 5 esperadas: a entrada manual + uma entrada da compra + uma saída para cada venda + uma saída do insumo da produção.
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(5);
        expect(res.body.data.items.map((m) => m.tipo).sort()).toEqual(['entrada', 'entrada', 'saida', 'saida', 'saida']);
    });
});

describe('acesso cruzado a um recurso específico por id não vaza existência', () => {
    test('empresa 2 pedindo um produto da empresa 1 por id recebe 404', async () => {
        const res = await request(app).get(`/produtos/${produtoE1Id}`).set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 2 pedindo uma venda da empresa 1 por id recebe 404', async () => {
        const res = await request(app).get(`/vendas/${vendaE1Id}`).set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 2 pedindo total-gasto de um cliente da empresa 1 recebe 404', async () => {
        const res = await request(app)
            .get(`/clientes/${clienteE1Id}/total-gasto`)
            .set('Authorization', `Bearer ${empresa2AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 1 pedindo a conta a pagar da empresa 2 por id recebe 404', async () => {
        const res = await request(app)
            .get(`/contas-pagar/${contaPagarE2Id}`)
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 1 pedindo a conta a receber da empresa 2 por id recebe 404', async () => {
        const res = await request(app)
            .get(`/contas-receber/${contaReceberE2Id}`)
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 1 pedindo a venda da empresa 2 por id recebe 404', async () => {
        const res = await request(app).get(`/vendas/${vendaE2Id}`).set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 1 pedindo um fornecedor da empresa 2 por id recebe 404', async () => {
        const res = await request(app).get(`/fornecedores/${fornecedorE2Id}`).set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 1 atualizando despesa fixa da empresa 2 por id recebe 404', async () => {
        const res = await request(app)
            .put(`/despesas-fixas/${despesaFixaE2Id}`)
            .set('Authorization', `Bearer ${empresa1AdminToken}`)
            .send({ valor: 999 });

        expect(res.status).toBe(404);
    });

    test('empresa 1 pedindo compra da empresa 2 por id recebe 404', async () => {
        const res = await request(app)
            .get(`/compras/${compraE2Id}`)
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(404);
    });

    test('empresa 1 pedindo produção da empresa 2 por id recebe 404', async () => {
        const res = await request(app)
            .get(`/producoes/${producaoE2Id}`)
            .set('Authorization', `Bearer ${empresa1AdminToken}`);

        expect(res.status).toBe(404);
    });
});

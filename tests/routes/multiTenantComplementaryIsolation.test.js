jest.setTimeout(30000);

const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const SUFIXO = Date.now();
const SENHA = 'senhaTeste123!';

let empresa1Id;
let tokenE1;
let empresa2Id;
let tokenE2;
let canalE2Id;
let fornecedorE2Id;
let nivelE2Id;
let categoriaE2Id;
let produtoE2Id;
let clienteE2Id;
let vendaE2Id;
let contaReceberE2Id;
let contaPagarE2Id;
let compraE2Id;
let despesaFixaE2Id;

async function login(email) {
    const res = await request(app)
        .post('/auth/login')
        .send({ email, senha: SENHA });

    if (res.status !== 200) {
        throw new Error('Falha no login: ' + res.status + ' ' + JSON.stringify(res.body));
    }

    return res.body.data.token;
}

function auth(token) {
    return { Authorization: 'Bearer ' + token };
}

beforeAll(async () => {
    const empresa1 = await db.query("SELECT id FROM empresas WHERE nome = 'Cherry Semijoias'");
    empresa1Id = empresa1.rows[0].id;
    tokenE1 = await login('ana@cherry.com');

    const empresa2 = await db.query(
        "INSERT INTO empresas (nome, cnpj, status) VALUES ($1, NULL, 'ativa') RETURNING id",
        ['Empresa Cobertura ' + SUFIXO]
    );
    empresa2Id = empresa2.rows[0].id;

    const canal = await db.query(
        "INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id",
        [empresa2Id]
    );
    canalE2Id = canal.rows[0].id;

    const senhaHash = await bcrypt.hash(SENHA, 10);
    const emailE2 = 'tenant2.' + SUFIXO + '@teste.local';

    await db.query(
        'INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5)',
        [empresa2Id, 'Tenant 2 Admin', emailE2, senhaHash, 'admin']
    );

    tokenE2 = await login(emailE2);

    const fornecedor = await request(app)
        .post('/fornecedores')
        .set(auth(tokenE2))
        .send({ nome: 'Fornecedor Tenant 2 ' + SUFIXO });
    if (fornecedor.status !== 201) throw new Error(JSON.stringify(fornecedor.body));
    fornecedorE2Id = fornecedor.body.data.id;

    const nivelNumero = 900 + (SUFIXO % 90);
    const nivel = await request(app)
        .post('/niveis-categoria')
        .set(auth(tokenE2))
        .send({ nivel: nivelNumero, nome: 'Nivel Tenant 2 ' + SUFIXO });
    if (nivel.status !== 201) throw new Error(JSON.stringify(nivel.body));
    nivelE2Id = nivel.body.data.id;

    const categoria = await request(app)
        .post('/categorias')
        .set(auth(tokenE2))
        .send({
            nivel: nivelNumero,
            codigo: 'T' + String(SUFIXO % 90).padStart(2, '0'),
            nome: 'Categoria Tenant 2 ' + SUFIXO
        });
    if (categoria.status !== 201) throw new Error(JSON.stringify(categoria.body));
    categoriaE2Id = categoria.body.data.id;

    const produto = await request(app)
        .post('/produtos')
        .set(auth(tokenE2))
        .send({
            nome: 'Produto Cobertura ' + SUFIXO,
            preco_venda: 120,
            custo: 50,
            estoque_atual: 20,
            estoque_minimo: 2
        });
    if (produto.status !== 201) throw new Error(JSON.stringify(produto.body));
    produtoE2Id = produto.body.data.id;

    const preco = await request(app)
        .put('/produtos/' + produtoE2Id + '/precos/' + canalE2Id)
        .set(auth(tokenE2))
        .send({ preco_venda: 120 });
    if (![200, 201].includes(preco.status)) throw new Error(JSON.stringify(preco.body));

    const cliente = await request(app)
        .post('/clientes')
        .set(auth(tokenE2))
        .send({
            nome: 'Cliente Cobertura ' + SUFIXO,
            email: 'cliente.' + SUFIXO + '@teste.local'
        });
    if (cliente.status !== 201) throw new Error(JSON.stringify(cliente.body));
    clienteE2Id = cliente.body.data.id;

    const contaPagar = await request(app)
        .post('/contas-pagar')
        .set(auth(tokenE2))
        .send({
            descricao: 'Conta Cobertura ' + SUFIXO,
            valor: 250,
            data_vencimento: '2026-12-01'
        });
    if (contaPagar.status !== 201) throw new Error(JSON.stringify(contaPagar.body));
    contaPagarE2Id = contaPagar.body.data.id;

    const venda = await request(app)
        .post('/vendas')
        .set(auth(tokenE2))
        .send({
            cliente_id: clienteE2Id,
            forma_pagamento: 'prazo',
            meses_prazo: 1,
            itens: [{ produto_id: produtoE2Id, quantidade: 1 }]
        });
    if (venda.status !== 201) throw new Error(JSON.stringify(venda.body));
    vendaE2Id = venda.body.data.id;

    const receber = await request(app)
        .get('/contas-receber?pageSize=100')
        .set(auth(tokenE2));
    if (receber.status !== 200) throw new Error(JSON.stringify(receber.body));
    contaReceberE2Id = receber.body.data.items.find(c => c.venda_id === vendaE2Id)?.id;
    if (!contaReceberE2Id) throw new Error('A venda a prazo não gerou conta a receber no tenant 2');

    const compra = await request(app)
        .post('/compras')
        .set(auth(tokenE2))
        .send({
            fornecedor_id: fornecedorE2Id,
            data_compra: '2026-09-19',
            forma_pagamento: 'a_vista',
            itens: [{ produto_id: produtoE2Id, quantidade: 2, custo_unitario: 50 }]
        });
    if (compra.status !== 201) throw new Error(JSON.stringify(compra.body));
    compraE2Id = compra.body.data.id;

    const despesa = await request(app)
        .post('/despesas-fixas')
        .set(auth(tokenE2))
        .send({
            categoria: 'administrativa',
            descricao: 'Despesa Tenant 2 ' + SUFIXO,
            valor: 300,
            vigencia_inicio: '2026-09-01',
            vigencia_fim: null
        });
    if (despesa.status !== 201) throw new Error(JSON.stringify(despesa.body));
    despesaFixaE2Id = despesa.body.data.id;

    const config = await request(app)
        .put('/configuracoes-financeiras')
        .set(auth(tokenE2))
        .send({ aliquota_imposto: 0.17 });
    if (config.status !== 200) throw new Error(JSON.stringify(config.body));
});

afterAll(async () => {
    if (empresa2Id) {
        await db.query('DELETE FROM itens_compra WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM compras WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM contas_receber WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM itens_venda WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM vendas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM movimentacoes_estoque WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM despesas_fixas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM configuracoes_financeiras WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM categorias_produto WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM niveis_categoria WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM precos_produto WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM produtos WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM clientes WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM fornecedores WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM canais_venda WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM contas_pagar WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM empresas WHERE id = $1', [empresa2Id]);
    }

    await db.end();
});

describe('tenant 1 não enxerga módulos complementares do tenant 2', () => {
    test('fornecedor', async () => {
        const list = await request(app).get('/fornecedores?pageSize=100').set(auth(tokenE1));
        expect(list.status).toBe(200);
        expect(list.body.data.items.map(x => x.id)).not.toContain(fornecedorE2Id);

        const byId = await request(app).get('/fornecedores/' + fornecedorE2Id).set(auth(tokenE1));
        expect(byId.status).toBe(404);
    });

    test('nível e categoria', async () => {
        const niveis = await request(app).get('/niveis-categoria').set(auth(tokenE1));
        expect(niveis.status).toBe(200);
        expect(niveis.body.data.map(x => x.id)).not.toContain(nivelE2Id);

        const categorias = await request(app).get('/categorias?pageSize=100').set(auth(tokenE1));
        expect(categorias.status).toBe(200);
        expect(categorias.body.data.items.map(x => x.id)).not.toContain(categoriaE2Id);

        expect((await request(app).get('/categorias/' + categoriaE2Id).set(auth(tokenE1))).status).toBe(404);
        expect((await request(app).get('/niveis-categoria/' + nivelE2Id).set(auth(tokenE1))).status).toBe(404);
    });

    test('canal de venda', async () => {
        const canais = await request(app).get('/canais-venda').set(auth(tokenE1));
        expect(canais.status).toBe(200);
        expect(canais.body.data.map(x => x.id)).not.toContain(canalE2Id);
    });

    test('contas a pagar e a receber', async () => {
        const pagar = await request(app).get('/contas-pagar?pageSize=100').set(auth(tokenE1));
        expect(pagar.status).toBe(200);
        expect(pagar.body.data.items.map(x => x.id)).not.toContain(contaPagarE2Id);

        const receber = await request(app).get('/contas-receber?pageSize=100').set(auth(tokenE1));
        expect(receber.status).toBe(200);
        expect(receber.body.data.items.map(x => x.id)).not.toContain(contaReceberE2Id);

        expect((await request(app).get('/contas-pagar/' + contaPagarE2Id).set(auth(tokenE1))).status).toBe(404);
        expect((await request(app).get('/contas-receber/' + contaReceberE2Id).set(auth(tokenE1))).status).toBe(404);
    });

    test('compras', async () => {
        const list = await request(app).get('/compras?pageSize=100').set(auth(tokenE1));
        expect(list.status).toBe(200);
        expect(list.body.data.items.map(x => x.id)).not.toContain(compraE2Id);

        expect((await request(app).get('/compras/' + compraE2Id).set(auth(tokenE1))).status).toBe(404);
    });

    test('despesas fixas', async () => {
        const list = await request(app).get('/despesas-fixas').set(auth(tokenE1));
        expect(list.status).toBe(200);
        expect(list.body.data.map(x => x.id)).not.toContain(despesaFixaE2Id);
    });

    test('configuração financeira é separada por empresa', async () => {
        const e2 = await request(app).get('/configuracoes-financeiras').set(auth(tokenE2));
        const e1 = await request(app).get('/configuracoes-financeiras').set(auth(tokenE1));

        expect(e2.status).toBe(200);
        expect(e1.status).toBe(200);
        expect(Number(e2.body.data.aliquota_imposto)).toBeCloseTo(0.17, 5);
        expect(Number(e1.body.data.aliquota_imposto)).not.toBeCloseTo(0.17, 5);
    });

    test('produção filtrada por produto do outro tenant não retorna registros', async () => {
        const list = await request(app)
            .get('/producoes?produto_id=' + produtoE2Id + '&pageSize=100')
            .set(auth(tokenE1));

        expect(list.status).toBe(200);
        expect(list.body.data.total).toBe(0);
        expect(list.body.data.items).toEqual([]);
    });
});

describe('tenant 2 vê somente seus próprios registros complementares', () => {
    test('fornecedor, categoria e canal', async () => {
        const fornecedor = await request(app)
            .get('/fornecedores/' + fornecedorE2Id)
            .set(auth(tokenE2));
        expect(fornecedor.status).toBe(200);

        const categoria = await request(app)
            .get('/categorias/' + categoriaE2Id)
            .set(auth(tokenE2));
        expect(categoria.status).toBe(200);

        const canais = await request(app).get('/canais-venda').set(auth(tokenE2));
        expect(canais.status).toBe(200);
        expect(canais.body.data.some(x => x.id === canalE2Id)).toBe(true);
    });

    test('compra, contas e despesa permanecem no tenant correto', async () => {
        const compra = await request(app)
            .get('/compras/' + compraE2Id)
            .set(auth(tokenE2));
        const pagar = await request(app)
            .get('/contas-pagar/' + contaPagarE2Id)
            .set(auth(tokenE2));
        const receber = await request(app)
            .get('/contas-receber/' + contaReceberE2Id)
            .set(auth(tokenE2));

        expect(compra.status).toBe(200);
        expect(pagar.status).toBe(200);
        expect(receber.status).toBe(200);

        const despesas = await request(app).get('/despesas-fixas').set(auth(tokenE2));
        expect(despesas.status).toBe(200);
        expect(despesas.body.data.some(x => x.id === despesaFixaE2Id)).toBe(true);
    });
});

jest.setTimeout(20000);

const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const SUFIXO = Date.now();
const SENHA = 'senhaTeste123!';

let empresa1Id;
let tokenE1;
let empresa2Id;
let usuarioE2Id;
let tokenE2;

const ids = { canal: null, fornecedor: null, nivel: null, categoria: null, produto: null, cliente: null, venda: null, contaReceber: null, contaPagar: null, compra: null, despesa: null, ficha: null, producao: null };

function auth(token) {
    return { Authorization: 'Bearer ' + token };
}

async function login(email, senha) {
    const res = await request(app).post('/auth/login').send({ email, senha });
    if (res.status !== 200) throw new Error('Falha no login: ' + res.status + ' ' + JSON.stringify(res.body));
    return res.body.data.token;
}

beforeAll(async () => {
    const e1 = await db.query("SELECT id FROM empresas WHERE nome = 'Cherry Semijoias'");
    empresa1Id = e1.rows[0].id;
    tokenE1 = await login('ana@cherry.com', 'senha123');

    const senhaHash = await bcrypt.hash(SENHA, 10);
    const e2 = await db.query("INSERT INTO empresas (nome, cnpj, status) VALUES ($1, NULL, 'ativa') RETURNING id", ['Empresa Isolamento Complementar ' + SUFIXO]);
    empresa2Id = e2.rows[0].id;

    const usuario = await db.query("INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id", [empresa2Id, 'Admin Tenant 2', 'tenant2.' + SUFIXO + '@teste.local', senhaHash]);
    usuarioE2Id = usuario.rows[0].id;
    tokenE2 = await login('tenant2.' + SUFIXO + '@teste.local', SENHA);

    const canal = await db.query("INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id", [empresa2Id]);
    ids.canal = canal.rows[0].id;

    const fornecedor = await db.query("INSERT INTO fornecedores (empresa_id, nome) VALUES ($1, $2) RETURNING id", [empresa2Id, 'Fornecedor Tenant 2 ' + SUFIXO]);
    ids.fornecedor = fornecedor.rows[0].id;

    const nivelNumero = 900 + (SUFIXO % 90);
    const nivel = await db.query("INSERT INTO niveis_categoria (empresa_id, nivel, nome) VALUES ($1, $2, $3) RETURNING id", [empresa2Id, nivelNumero, 'Nivel Tenant 2 ' + SUFIXO]);
    ids.nivel = nivel.rows[0].id;

    const categoria = await db.query("INSERT INTO categorias_produto (empresa_id, nivel, codigo, nome) VALUES ($1, $2, $3, $4) RETURNING id", [empresa2Id, nivelNumero, 'T' + String(SUFIXO % 90).padStart(2, '0'), 'Categoria Tenant 2 ' + SUFIXO]);
    ids.categoria = categoria.rows[0].id;

    const produto = await db.query("INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual, estoque_minimo) VALUES ($1, $2, $3, 120, 50, 10, 2) RETURNING id", [empresa2Id, 'T2' + String(SUFIXO % 999).padStart(3, '0'), 'Produto Tenant 2 ' + SUFIXO]);
    ids.produto = produto.rows[0].id;

    const cliente = await db.query("INSERT INTO clientes (empresa_id, nome, email) VALUES ($1, $2, $3) RETURNING id", [empresa2Id, 'Cliente Tenant 2 ' + SUFIXO, 'cliente.' + SUFIXO + '@teste.local']);
    ids.cliente = cliente.rows[0].id;

    const contaPagar = await db.query("INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, usuario_id) VALUES ($1, $2, 250, '2026-12-01', $3) RETURNING id", [empresa2Id, 'Conta Tenant 2 ' + SUFIXO, usuarioE2Id]);
    ids.contaPagar = contaPagar.rows[0].id;

    const venda = await db.query("INSERT INTO vendas (empresa_id, cliente_id, canal_id, usuario_id, total, forma_pagamento) VALUES ($1, $2, $3, $4, 120, 'prazo') RETURNING id", [empresa2Id, ids.cliente, ids.canal, usuarioE2Id]);
    ids.venda = venda.rows[0].id;

    await db.query("INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES ($1, $2, $3, 1, 120, 50)", [empresa2Id, ids.venda, ids.produto]);

    const contaReceber = await db.query("INSERT INTO contas_receber (venda_id, descricao, valor, data_vencimento, empresa_id) VALUES ($1, $2, 120, '2026-10-19', $3) RETURNING id", [ids.venda, 'Venda Tenant 2 ' + SUFIXO, empresa2Id]);
    ids.contaReceber = contaReceber.rows[0].id;

    const compra = await db.query("INSERT INTO compras (empresa_id, fornecedor_id, data_compra, valor_total) VALUES ($1, $2, '2026-09-19', 100) RETURNING id", [empresa2Id, ids.fornecedor]);
    ids.compra = compra.rows[0].id;

    await db.query("INSERT INTO itens_compra (compra_id, produto_id, empresa_id, quantidade, custo_unitario) VALUES ($1, $2, $3, 2, 50)", [ids.compra, ids.produto, empresa2Id]);

    const despesa = await db.query("INSERT INTO despesas_fixas (empresa_id, categoria, descricao, valor, vigencia_inicio) VALUES ($1, 'administrativa', $2, 300, '2026-09-01') RETURNING id", [empresa2Id, 'Despesa Tenant 2 ' + SUFIXO]);
    ids.despesa = despesa.rows[0].id;

    await db.query("INSERT INTO configuracoes_financeiras (empresa_id, aliquota_imposto) VALUES ($1, 0.17)", [empresa2Id]);

    const ficha = await db.query("INSERT INTO fichas_tecnicas (empresa_id, produto_id, vigente, criado_por) VALUES ($1, $2, true, $3) RETURNING id", [empresa2Id, ids.produto, usuarioE2Id]);
    ids.ficha = ficha.rows[0].id;

    const producao = await db.query("INSERT INTO producoes (empresa_id, produto_id, ficha_tecnica_id, quantidade_solicitada, quantidade_produzida, status, usuario_id) VALUES ($1, $2, $3, 1, 1, 'concluida', $4) RETURNING id", [empresa2Id, ids.produto, ids.ficha, usuarioE2Id]);
    ids.producao = producao.rows[0].id;
});

afterAll(async () => {
    if (empresa2Id) {
        await db.query('DELETE FROM producoes WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM fichas_tecnicas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM contas_receber WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM itens_venda WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM vendas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM itens_compra WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM compras WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM contas_pagar WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM configuracoes_financeiras WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM despesas_fixas WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM categorias_produto WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM niveis_categoria WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM produtos WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM clientes WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM fornecedores WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM canais_venda WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [empresa2Id]);
        await db.query('DELETE FROM empresas WHERE id = $1', [empresa2Id]);
    }
    await db.end();
});

describe('isolamento complementar de tenant', () => {
    test('tenant 1 não vê dados complementares do tenant 2', async () => {
        const requests = await Promise.all([
            request(app).get('/fornecedores?pageSize=100').set(auth(tokenE1)),
            request(app).get('/categorias?pageSize=100').set(auth(tokenE1)),
            request(app).get('/niveis-categoria').set(auth(tokenE1)),
            request(app).get('/canais-venda').set(auth(tokenE1)),
            request(app).get('/contas-pagar?pageSize=100').set(auth(tokenE1)),
            request(app).get('/contas-receber?pageSize=100').set(auth(tokenE1)),
            request(app).get('/compras?pageSize=100').set(auth(tokenE1)),
            request(app).get('/despesas-fixas').set(auth(tokenE1)),
            request(app).get('/producoes?produto_id=' + ids.produto + '&pageSize=100').set(auth(tokenE1))
        ]);

        expect(requests.every(r => r.status === 200)).toBe(true);
        expect(requests[0].body.data.items.map(x => x.id)).not.toContain(ids.fornecedor);
        expect(requests[1].body.data.items.map(x => x.id)).not.toContain(ids.categoria);
        expect(requests[2].body.data.map(x => x.id)).not.toContain(ids.nivel);
        expect(requests[3].body.data.map(x => x.id)).not.toContain(ids.canal);
        expect(requests[4].body.data.items.map(x => x.id)).not.toContain(ids.contaPagar);
        expect(requests[5].body.data.items.map(x => x.id)).not.toContain(ids.contaReceber);
        expect(requests[6].body.data.items.map(x => x.id)).not.toContain(ids.compra);
        expect(requests[7].body.data.map(x => x.id)).not.toContain(ids.despesa);
        expect(requests[8].body.data.items.map(x => x.id)).not.toContain(ids.producao);
    });

    test('tenant 1 recebe 404 ao acessar recursos do tenant 2 por id', async () => {
        const byId = await Promise.all([
            request(app).get('/fornecedores/' + ids.fornecedor).set(auth(tokenE1)),
            request(app).get('/categorias/' + ids.categoria).set(auth(tokenE1)),
            request(app).get('/niveis-categoria/' + ids.nivel).set(auth(tokenE1)),
            request(app).get('/contas-pagar/' + ids.contaPagar).set(auth(tokenE1)),
            request(app).get('/contas-receber/' + ids.contaReceber).set(auth(tokenE1)),
            request(app).get('/compras/' + ids.compra).set(auth(tokenE1)),
            request(app).get('/producoes/' + ids.producao).set(auth(tokenE1))
        ]);

        expect(byId.every(r => r.status === 404)).toBe(true);
    });

    test('tenant 2 enxerga seus próprios recursos', async () => {
        const e2 = await Promise.all([
            request(app).get('/fornecedores/' + ids.fornecedor).set(auth(tokenE2)),
            request(app).get('/categorias/' + ids.categoria).set(auth(tokenE2)),
            request(app).get('/niveis-categoria/' + ids.nivel).set(auth(tokenE2)),
            request(app).get('/compras/' + ids.compra).set(auth(tokenE2)),
            request(app).get('/contas-pagar/' + ids.contaPagar).set(auth(tokenE2)),
            request(app).get('/contas-receber/' + ids.contaReceber).set(auth(tokenE2)),
            request(app).get('/producoes/' + ids.producao).set(auth(tokenE2))
        ]);

        expect(e2.every(r => r.status === 200)).toBe(true);
    });

    test('configuração financeira fica isolada por empresa', async () => {
        const [e1, e2] = await Promise.all([
            request(app).get('/configuracoes-financeiras').set(auth(tokenE1)),
            request(app).get('/configuracoes-financeiras').set(auth(tokenE2))
        ]);

        expect(e1.status).toBe(200);
        expect(e2.status).toBe(200);
        expect(e1.body.data.empresa_id).toBe(empresa1Id);
        expect(e2.body.data.empresa_id).toBe(empresa2Id);
        expect(Number(e2.body.data.aliquota_imposto)).toBeCloseTo(0.17, 5);
    });
});

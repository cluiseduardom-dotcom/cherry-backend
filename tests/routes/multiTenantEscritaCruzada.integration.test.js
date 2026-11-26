// Escrita cruzada entre empresas (Tarefa 01 — auditoria de isolamento multi-tenant, PR 1: só testes).
//
// Complementa multiTenantIsolation.integration.test.js, que cobre apenas LEITURA. Aqui a empresa 1
// (admin autenticado) tenta ESCREVER usando ids que pertencem à empresa 2 — no caminho da URL ou no
// corpo da requisição — e o teste exige duas coisas:
//   1) a API recusa com 404 (o recurso não existe para a empresa autenticada);
//   2) nada muda no banco: nem na empresa 2 (alvo) nem na empresa 1 (nenhuma linha com referência
//      cruzada pode nascer).
//
// Integração de verdade: roda só contra o banco de testes ISOLADO (TEST_DATABASE_URL), sem jest.mock
// em db/services. Cria duas empresas fictícias ("Empresa Teste Escrita Cruzada ...") e remove tudo ao final.

jest.setTimeout(30000);

const bcrypt = require('bcrypt');
jest.unmock('../../src/repositories/sessaoRepository');

const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { darEstoqueInicial } = require('../helpers/estoqueInicial');

const registro = criarRegistroDeEmpresas(db);
const SUFIXO = Date.now();
const SENHA_TESTE = 'senhaTeste123!';

const E1 = {};
const E2 = {};

async function loginComo(email) {
    const res = await request(app).post('/auth/login').send({ email, senha: SENHA_TESTE });
    if (res.status !== 200) throw new Error(`Falha ao logar como ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.token;
}

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(
        `INSERT INTO empresas (nome, cnpj, status) VALUES ($1, NULL, 'ativa') RETURNING id`,
        [`Empresa Teste Escrita Cruzada ${rotulo} ${SUFIXO}`]
    );
    alvo.empresaId = registro.registrar(rows[0].id);

    const canal = await db.query(
        `INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`,
        [alvo.empresaId]
    );
    alvo.canalId = canal.rows[0].id;

    // Funcionalidades usadas pelas rotas exercitadas (bancos e maletas/locais).
    for (const funcionalidade of ['bancos', 'maletas']) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel)
             VALUES ($1, $2, true, 'teste', 'teste')`,
            [alvo.empresaId, funcionalidade]
        );
    }

    alvo.email = `escrita.cruzada.${rotulo}.${SUFIXO}@teste.local`;
    const usuario = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.empresaId, `Admin ${rotulo}`, alvo.email, await bcrypt.hash(SENHA_TESTE, 10)]
    );
    alvo.usuarioId = usuario.rows[0].id;
    alvo.token = await loginComo(alvo.email);
}

const auth = (alvo) => ({ Authorization: `Bearer ${alvo.token}` });

async function criar(alvo, rota, corpo, statusEsperado = 201) {
    const res = await request(app).post(rota).set(auth(alvo)).send(corpo);
    if (res.status !== statusEsperado) throw new Error(`Falha ao preparar ${rota}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data;
}

// Estado observável de uma empresa: qualquer mudança aqui após uma tentativa recusada é falha de isolamento.
async function estadoDa(empresaId) {
    const q = async (sql) => (await db.query(sql, [empresaId])).rows;
    return {
        vendas: await q('SELECT id, status, total, cliente_id FROM vendas WHERE empresa_id = $1 ORDER BY id'),
        itens_venda: await q('SELECT id, venda_id, produto_id, quantidade FROM itens_venda WHERE empresa_id = $1 ORDER BY id'),
        compras: await q('SELECT id, fornecedor_id, status, valor_total FROM compras WHERE empresa_id = $1 ORDER BY id'),
        itens_compra: await q('SELECT id, compra_id, produto_id, quantidade FROM itens_compra WHERE empresa_id = $1 ORDER BY id'),
        produtos: await q('SELECT id, nome, estoque_atual, custo FROM produtos WHERE empresa_id = $1 ORDER BY id'),
        movimentacoes: await q('SELECT id, produto_id, tipo, quantidade, local_id FROM movimentacoes_estoque WHERE empresa_id = $1 ORDER BY id'),
        estoque_locais: await q('SELECT produto_id, local_id, saldo FROM estoque_locais WHERE empresa_id = $1 ORDER BY produto_id, local_id'),
        locais: await q('SELECT id, nome, tipo, ativo, cliente_id, usuario_id FROM locais_estoque WHERE empresa_id = $1 ORDER BY id'),
        transferencias: await q('SELECT id, origem_local_id, destino_local_id, status FROM transferencias_estoque WHERE empresa_id = $1 ORDER BY id'),
        precos: await q('SELECT id, produto_id, canal_id, preco_venda FROM precos_produto WHERE empresa_id = $1 ORDER BY id'),
        clientes: await q('SELECT id, nome, ativo, anonimizado FROM clientes WHERE empresa_id = $1 ORDER BY id'),
        fornecedores: await q('SELECT id, nome, ativo FROM fornecedores WHERE empresa_id = $1 ORDER BY id'),
        contas_pagar: await q('SELECT id, descricao, valor, status FROM contas_pagar WHERE empresa_id = $1 ORDER BY id'),
        contas_receber: await q('SELECT id, venda_id, status, valor FROM contas_receber WHERE empresa_id = $1 ORDER BY id'),
        parcelas: await q('SELECT id, pagamento_id, status FROM parcelas_pagamento WHERE empresa_id = $1 ORDER BY id'),
        estornos: await q('SELECT id, pagamento_id FROM estornos_pagamento WHERE empresa_id = $1 ORDER BY id'),
        contas_bancarias: await q('SELECT id, nome, status, principal FROM contas_bancarias WHERE empresa_id = $1 ORDER BY id'),
        movimentos_bancarios: await q('SELECT id, conta_bancaria_id, tipo, valor FROM movimentos_bancarios WHERE empresa_id = $1 ORDER BY id'),
        producoes: await q('SELECT id, produto_id, status FROM producoes WHERE empresa_id = $1 ORDER BY id')
    };
}

// Executa a tentativa de escrita cruzada e confere: recusada com o status esperado e banco idêntico nas duas empresas.
async function exigirRecusaSemEfeito(tentativa, statusEsperado = 404) {
    const antes = { e1: await estadoDa(E1.empresaId), e2: await estadoDa(E2.empresaId) };
    const res = await tentativa();

    // 404 = o recurso não existe para a empresa autenticada (nunca 2xx, nunca 400 de validação do payload,
    // para a recusa não ser por outro motivo que não o isolamento).
    expect(res.status).toBe(statusEsperado);

    const depois = { e1: await estadoDa(E1.empresaId), e2: await estadoDa(E2.empresaId) };
    expect(depois.e2).toEqual(antes.e2);
    expect(depois.e1).toEqual(antes.e1);

    return res;
}

const comoE1 = (metodo, rota) => request(app)[metodo](rota).set(auth(E1));

beforeAll(async () => {
    await criarEmpresa(E1, '1');
    await criarEmpresa(E2, '2');

    // --- Fixtures da empresa 1 (atacante) ---
    E1.produto = (await criar(E1, '/produtos', { nome: 'Produto E1', preco_venda: 100, custo: 50, estoque_minimo: 1 })).id;
    await darEstoqueInicial(app, E1.token, E1.produto, 20);
    await request(app).put(`/produtos/${E1.produto}/precos/${E1.canalId}`).set(auth(E1)).send({ preco_venda: 120 }).expect(201);
    E1.fornecedor = (await criar(E1, '/fornecedores', { nome: `Fornecedor E1 ${SUFIXO}`, contato: 'x' })).id;
    E1.cliente = (await criar(E1, '/clientes', { nome: `Cliente E1 ${SUFIXO}`, email: `c1.${SUFIXO}@teste.local` })).id;
    E1.localConsignado = (await criar(E1, '/estoque/locais', { tipo: 'consignado', nome: `Consignado E1 ${SUFIXO}` })).id;
    E1.contaBancaria = (await criar(E1, '/bancos/contas', { nome: `Caixa E1 ${SUFIXO}`, tipo: 'CAIXA' })).id;

    // --- Fixtures da empresa 2 (alvo) ---
    E2.produto = (await criar(E2, '/produtos', { nome: 'Produto E2', preco_venda: 100, custo: 50, estoque_minimo: 1 })).id;
    await darEstoqueInicial(app, E2.token, E2.produto, 20);
    await request(app).put(`/produtos/${E2.produto}/precos/${E2.canalId}`).set(auth(E2)).send({ preco_venda: 120 }).expect(201);
    E2.fornecedor = (await criar(E2, '/fornecedores', { nome: `Fornecedor E2 ${SUFIXO}`, contato: 'x' })).id;
    E2.cliente = (await criar(E2, '/clientes', { nome: `Cliente E2 ${SUFIXO}`, email: `c2.${SUFIXO}@teste.local` })).id;
    E2.localConsignado = (await criar(E2, '/estoque/locais', { tipo: 'consignado', nome: `Consignado E2 ${SUFIXO}` })).id;
    E2.localCentral = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [E2.empresaId])).rows[0].id;
    E2.contaBancaria = (await criar(E2, '/bancos/contas', { nome: `Caixa E2 ${SUFIXO}`, tipo: 'CAIXA' })).id;
    E2.movimento = (await criar(E2, '/bancos/movimentos', {
        conta_bancaria_id: E2.contaBancaria, tipo: 'ENTRADA', valor: 10, data_movimento: '2026-11-01', descricao: 'Movimento E2'
    })).id;
    E2.contaPagar = (await criar(E2, '/contas-pagar', { descricao: `Conta E2 ${SUFIXO}`, valor: 250, data_vencimento: '2026-12-01' })).id;
    E2.compra = (await criar(E2, '/compras', {
        fornecedor_id: E2.fornecedor, data_compra: '2026-11-01', forma_pagamento: 'a_vista',
        itens: [{ produto_id: E2.produto, quantidade: 1, custo_unitario: 10 }]
    })).id;

    // Venda a prazo da E2: gera pagamento, parcela e conta a receber.
    E2.venda = (await criar(E2, '/vendas', {
        cliente_id: E2.cliente, itens: [{ produto_id: E2.produto, quantidade: 1 }], forma_pagamento: 'prazo', meses_prazo: 1
    })).id;
    E2.contaReceber = (await db.query('SELECT id FROM contas_receber WHERE venda_id = $1 AND empresa_id = $2', [E2.venda, E2.empresaId])).rows[0].id;

    // Venda com crediário parcelado (modelo novo, pagamentos[]): gera pagamento e parcelas.
    E2.vendaParcelada = (await criar(E2, '/vendas', {
        cliente_id: E2.cliente,
        itens: [{ produto_id: E2.produto, quantidade: 1 }],
        pagamentos: [{ forma_pagamento: 'crediario', valor: 120, numero_parcelas: 2, meses_prazo: 2 }]
    })).id;
    E2.pagamento = (await db.query('SELECT id FROM pagamentos_venda WHERE venda_id = $1 AND empresa_id = $2 ORDER BY id LIMIT 1', [E2.vendaParcelada, E2.empresaId])).rows[0]?.id;
    E2.parcela = (await db.query('SELECT id FROM parcelas_pagamento WHERE pagamento_id = $1 AND empresa_id = $2 ORDER BY id LIMIT 1', [E2.pagamento, E2.empresaId])).rows[0]?.id;
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('ids da empresa 2 no CAMINHO da URL (admin da empresa 1)', () => {
    test('PATCH /clientes/:id e /anonimizar de cliente da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('patch', `/clientes/${E2.cliente}`).send({ nome: 'Sequestrado' }));
        await exigirRecusaSemEfeito(() => comoE1('patch', `/clientes/${E2.cliente}/anonimizar`).send({}));
    });

    test('PUT e DELETE /fornecedores/:id de fornecedor da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('put', `/fornecedores/${E2.fornecedor}`).send({ nome: 'Sequestrado' }));
        await exigirRecusaSemEfeito(() => comoE1('delete', `/fornecedores/${E2.fornecedor}`));
    });

    test('PUT e DELETE /produtos/:id de produto da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('put', `/produtos/${E2.produto}`).send({ nome: 'Sequestrado', preco_venda: 1, custo: 1 }));
        await exigirRecusaSemEfeito(() => comoE1('delete', `/produtos/${E2.produto}`));
    });

    test('PUT /contas-pagar/:id e PATCH /contas-pagar/:id/pagar de conta da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('put', `/contas-pagar/${E2.contaPagar}`).send({ descricao: 'Sequestrada' }));
        await exigirRecusaSemEfeito(() => comoE1('patch', `/contas-pagar/${E2.contaPagar}/pagar`).send({}));
    });

    test('recebimento e baixa de conta a receber da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/contas-receber/${E2.contaReceber}/recebimentos`).set('Idempotency-Key', `cruzada-${SUFIXO}-rec`).send({ valor: 10, forma_pagamento: 'dinheiro' }));
        await exigirRecusaSemEfeito(() => comoE1('patch', `/contas-receber/${E2.contaReceber}/receber`).send({}));
    });

    test('baixa de parcela e estorno de pagamento da empresa 2', async () => {
        expect(E2.parcela).toBeDefined();
        expect(E2.pagamento).toBeDefined();
        await exigirRecusaSemEfeito(() => comoE1('patch', `/parcelas/${E2.parcela}/receber`).send({ valor: 10 }));
        await exigirRecusaSemEfeito(() => comoE1('post', `/pagamentos/${E2.pagamento}/estornar`).send({ valor: 10, motivo: 'tentativa cruzada' }));
    });

    test('cancelamento de compra e de venda da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('patch', `/compras/${E2.compra}/cancelar`).send({}));
        await exigirRecusaSemEfeito(() => comoE1('patch', `/vendas/${E2.venda}/cancelar`).send({ motivo: 'tentativa cruzada' }));
    });

    test('movimentação de estoque em produto da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/produtos/${E2.produto}/movimentacoes`).send({ tipo: 'saida', quantidade: 1, motivo_codigo: 'perda' }));
    });

    test('preço de produto da empresa 2 e preço em canal da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('put', `/produtos/${E2.produto}/precos/${E1.canalId}`).send({ preco_venda: 1 }));
        await exigirRecusaSemEfeito(() => comoE1('put', `/produtos/${E1.produto}/precos/${E2.canalId}`).send({ preco_venda: 130 }));
    });

    test('conta bancária e movimento bancário da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('patch', `/bancos/contas/${E2.contaBancaria}`).send({ nome: 'Sequestrada' }));
        await exigirRecusaSemEfeito(() => comoE1('patch', `/bancos/contas/${E2.contaBancaria}/status`).send({ status: 'INATIVA' }));
        await exigirRecusaSemEfeito(() => comoE1('post', `/bancos/movimentos/${E2.movimento}/cancelar`).send({ motivo: 'tentativa cruzada' }));
    });

    test('transferência/aceite em local da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/estoque/locais/${E2.localConsignado}/conferencias`).send({ itens: [{ produto_id: E1.produto, quantidade_contada: 1 }] }));
    });
});

describe('ids da empresa 2 no CORPO da requisição (admin da empresa 1)', () => {
    test('venda com produto da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/vendas').send({ itens: [{ produto_id: E2.produto, quantidade: 1 }] }));
    });

    test('venda com cliente da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/vendas').send({ cliente_id: E2.cliente, itens: [{ produto_id: E1.produto, quantidade: 1 }] }));
    });

    test('compra com fornecedor da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/compras').send({
            fornecedor_id: E2.fornecedor, data_compra: '2026-11-02', forma_pagamento: 'a_vista',
            itens: [{ produto_id: E1.produto, quantidade: 1, custo_unitario: 10 }]
        }));
    });

    test('compra com produto da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/compras').send({
            fornecedor_id: E1.fornecedor, data_compra: '2026-11-02', forma_pagamento: 'a_vista',
            itens: [{ produto_id: E2.produto, quantidade: 1, custo_unitario: 10 }]
        }));
    });

    test('movimentação de produto próprio em local da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/produtos/${E1.produto}/movimentacoes`).send({
            tipo: 'saida', quantidade: 1, motivo_codigo: 'perda', local_id: E2.localCentral
        }));
    });

    test('transferência com local de origem ou destino da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/estoque/transferencias').send({
            origem_local_id: E2.localCentral, destino_local_id: E1.localConsignado, itens: [{ produto_id: E1.produto, quantidade: 1 }]
        }));
        await exigirRecusaSemEfeito(() => comoE1('post', '/estoque/transferencias').send({
            origem_local_id: E1.localConsignado, destino_local_id: E2.localConsignado, itens: [{ produto_id: E1.produto, quantidade: 1 }]
        }));
    });

    test('transferência com produto da empresa 2', async () => {
        const centralE1 = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [E1.empresaId])).rows[0].id;
        await exigirRecusaSemEfeito(() => comoE1('post', '/estoque/transferencias').send({
            origem_local_id: centralE1, destino_local_id: E1.localConsignado, itens: [{ produto_id: E2.produto, quantidade: 1 }]
        }));
    });

    test('local consignado com cliente da empresa 2 e maleta com usuário da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/estoque/locais').send({ tipo: 'consignado', nome: 'Cruzado', cliente_id: E2.cliente }));
        await exigirRecusaSemEfeito(() => comoE1('post', '/estoque/locais').send({ tipo: 'maleta', usuario_id: E2.usuarioId }));
    });

    test('movimento bancário em conta da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/bancos/movimentos').send({
            conta_bancaria_id: E2.contaBancaria, tipo: 'SAIDA', valor: 5, data_movimento: '2026-11-02', descricao: 'Movimento cruzado'
        }));
    });

    test('produção de produto da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/producoes').send({ produto_id: E2.produto, quantidade_solicitada: 1 }));
    });
});

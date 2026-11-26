// Escrita cruzada entre empresas, parte 2 (Tarefa 01, PR 4: só testes).
//
// Continuação de multiTenantEscritaCruzada.integration.test.js para as rotas que ficaram de fora:
// ficha técnica, pedidos de compra, cotações, fiado, conciliação bancária, consumos e percentual de
// comissão. A empresa 1 (admin autenticado) tenta ESCREVER com ids da empresa 2 e o teste exige 404 e
// banco idêntico nas duas empresas. Roda só contra o banco de testes ISOLADO (TEST_DATABASE_URL).

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
    for (const funcionalidade of ['bancos', 'maletas', 'compras_avancado', 'fiado', 'comissoes']) {
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
        producoes: await q('SELECT id, produto_id, status FROM producoes WHERE empresa_id = $1 ORDER BY id'),
        conciliacoes: await q('SELECT id, movimento_bancario_id FROM conciliacoes_bancarias WHERE empresa_id = $1 ORDER BY id'),
        fichas_tecnicas: await q('SELECT id, produto_id, vigente FROM fichas_tecnicas WHERE empresa_id = $1 ORDER BY id'),
        itens_ficha: await q('SELECT id, ficha_tecnica_id, insumo_produto_id FROM itens_ficha_tecnica WHERE empresa_id = $1 ORDER BY id'),
        pedidos_compra: await q('SELECT id, fornecedor_id, status FROM pedidos_compra WHERE empresa_id = $1 ORDER BY id'),
        cotacoes: await q('SELECT id, status FROM cotacoes WHERE empresa_id = $1 ORDER BY id'),
        fiado: await q('SELECT id, cliente_id, tipo, valor FROM fiado_lancamentos WHERE empresa_id = $1 ORDER BY id'),
        consumos: await q('SELECT id, produto_id, quantidade FROM consumos_avulsos WHERE empresa_id = $1 ORDER BY id'),
        comissao_percentuais: await q('SELECT id, usuario_id, percentual FROM comissao_percentuais WHERE empresa_id = $1 ORDER BY id')
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

    // Empresa 1 (atacante)
    E1.produto = (await criar(E1, '/produtos', { nome: 'Produto E1', preco_venda: 100, custo: 50, estoque_minimo: 1 })).id;
    await darEstoqueInicial(app, E1.token, E1.produto, 20);
    E1.fornecedor = (await criar(E1, '/fornecedores', { nome: `Fornecedor E1 ${SUFIXO}`, contato: 'x' })).id;

    // Empresa 2 (alvo)
    E2.produto = (await criar(E2, '/produtos', { nome: 'Produto E2', preco_venda: 100, custo: 50, estoque_minimo: 1 })).id;
    E2.insumo = (await criar(E2, '/produtos', { nome: 'Insumo E2', preco_venda: 10, custo: 5, estoque_minimo: 1 })).id;
    await darEstoqueInicial(app, E2.token, E2.produto, 20);
    await darEstoqueInicial(app, E2.token, E2.insumo, 20);
    E2.fornecedor = (await criar(E2, '/fornecedores', { nome: `Fornecedor E2 ${SUFIXO}`, contato: 'x' })).id;
    E2.cliente = (await criar(E2, '/clientes', { nome: `Cliente E2 ${SUFIXO}`, email: `c2.${SUFIXO}@teste.local` })).id;
    E2.contaBancaria = (await criar(E2, '/bancos/contas', { nome: `Caixa E2 ${SUFIXO}`, tipo: 'CAIXA' })).id;
    E2.movimento = (await criar(E2, '/bancos/movimentos', {
        conta_bancaria_id: E2.contaBancaria, tipo: 'ENTRADA', valor: 10, data_movimento: '2026-11-01', descricao: 'Movimento E2'
    })).id;
    E2.pedido = (await criar(E2, '/pedidos-compra', {
        fornecedor_id: E2.fornecedor, itens: [{ produto_id: E2.produto, quantidade: 2, preco_unitario: 10 }]
    })).id;
    E2.cotacao = (await criar(E2, '/cotacoes', {
        itens: [{ produto_id: E2.produto, quantidade: 2 }], fornecedor_ids: [E2.fornecedor]
    })).id;
    E2.cotacaoItem = (await db.query('SELECT id FROM cotacoes_itens WHERE cotacao_id = $1 AND empresa_id = $2 ORDER BY id LIMIT 1', [E2.cotacao, E2.empresaId])).rows[0].id;
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('ids da empresa 2 no CAMINHO da URL (admin da empresa 1)', () => {
    test('ficha técnica em produto da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/produtos/${E2.produto}/ficha-tecnica`).send({
            itens: [{ insumo_produto_id: E2.insumo, quantidade_necessaria: 1 }]
        }));
    });

    test('pedido de compra da empresa 2: atualizar, enviar, confirmar e cancelar', async () => {
        const corpo = { fornecedor_id: E1.fornecedor, itens: [{ produto_id: E1.produto, quantidade: 1, preco_unitario: 10 }] };
        await exigirRecusaSemEfeito(() => comoE1('put', `/pedidos-compra/${E2.pedido}`).send(corpo));
        await exigirRecusaSemEfeito(() => comoE1('post', `/pedidos-compra/${E2.pedido}/enviar`).send({}));
        await exigirRecusaSemEfeito(() => comoE1('post', `/pedidos-compra/${E2.pedido}/confirmar`).send({}));
        await exigirRecusaSemEfeito(() => comoE1('post', `/pedidos-compra/${E2.pedido}/cancelar`).send({}));
    });

    test('cotação da empresa 2: cancelar, recusar fornecedor e gerar pedidos', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/cotacoes/${E2.cotacao}/cancelar`).send({}));
        await exigirRecusaSemEfeito(() => comoE1('post', `/cotacoes/${E2.cotacao}/fornecedores/${E2.fornecedor}/recusar`).send({}));
        await exigirRecusaSemEfeito(() => comoE1('post', `/cotacoes/${E2.cotacao}/gerar-pedidos`).send({
            escolhas: [{ cotacao_item_id: E2.cotacaoItem, fornecedor_id: E1.fornecedor }]
        }));
    });

    test('fiado em cliente da empresa 2: compra e pagamento', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/fiado/clientes/${E2.cliente}/compras`)
            .set('Idempotency-Key', `cruzada-${SUFIXO}-fc`).send({ valor: 10, descricao: 'compra cruzada' }));
        await exigirRecusaSemEfeito(() => comoE1('post', `/fiado/clientes/${E2.cliente}/pagamentos`)
            .set('Idempotency-Key', `cruzada-${SUFIXO}-fp`).send({ valor: 10 }));
    });
});

describe('ids da empresa 2 no CORPO da requisição (admin da empresa 1)', () => {
    test('ficha técnica própria com insumo da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', `/produtos/${E1.produto}/ficha-tecnica`).send({
            itens: [{ insumo_produto_id: E2.insumo, quantidade_necessaria: 1 }]
        }));
    });

    test('pedido de compra com fornecedor da empresa 2 e com produto da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/pedidos-compra').send({
            fornecedor_id: E2.fornecedor, itens: [{ produto_id: E1.produto, quantidade: 1, preco_unitario: 10 }]
        }));
        await exigirRecusaSemEfeito(() => comoE1('post', '/pedidos-compra').send({
            fornecedor_id: E1.fornecedor, itens: [{ produto_id: E2.produto, quantidade: 1, preco_unitario: 10 }]
        }));
    });

    test('cotação com produto da empresa 2 e com fornecedor da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/cotacoes').send({
            itens: [{ produto_id: E2.produto, quantidade: 1 }], fornecedor_ids: [E1.fornecedor]
        }));
        await exigirRecusaSemEfeito(() => comoE1('post', '/cotacoes').send({
            itens: [{ produto_id: E1.produto, quantidade: 1 }], fornecedor_ids: [E2.fornecedor]
        }));
    });

    test('conciliação bancária de movimento da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/bancos/conciliacoes').send({ movimento_bancario_id: E2.movimento }));
    });

    test('consumo avulso de insumo da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/consumos/avulsos').send({ produto_id: E2.insumo, quantidade: 1, motivo: 'perda' }));
    });

    test('substituição de insumos da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('post', '/consumos/substituicoes').send({ de_insumo_id: E2.insumo, para_insumo_id: E2.produto }));
    });

    test('percentual de comissão para usuário da empresa 2', async () => {
        await exigirRecusaSemEfeito(() => comoE1('put', '/comissoes/percentuais').send({ usuario_id: E2.usuarioId, percentual: 5 }));
    });
});

// Integração de verdade (Postgres da CI/dev): migration 064 + vendas reais + opção da empresa de pagar a
// comissão "assim que liberada" ou só "no fechamento do mês". Prova a virada do mês (America/Sao_Paulo),
// que o desconto de estorno continua valendo, que só o admin altera, que o pagamento recusa o que a tela
// não mostra e o isolamento entre empresas. Empresas e usuários próprios e temporários.
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

const A = { u: {} };
const B = { u: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ComissaoModo ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, papel, rotulo = papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[rotulo] = rows[0].id;
}

const ligarCargo = (alvo, cargo, nivel, capacidades) => db.query(
    `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (empresa_id, cargo) DO UPDATE SET nivel = $3, ativo = true, capacidades = $4`,
    [alvo.empresaId, cargo, nivel, capacidades]
);

async function criarProduto(alvo, preco = 100) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, $3, 10, 500) RETURNING id`,
        [alvo.empresaId, `Produto ${sufixo}`, preco]
    );
    // Estoque por local: o saldo inserido direto precisa existir também no Central.
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [alvo.empresaId]);
    await db.query(
        `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
         SELECT $1, l.id, $2, 500 FROM locais_estoque l WHERE l.empresa_id = $2 AND l.tipo = 'central'`,
        [rows[0].id, alvo.empresaId]
    );
    await db.query(
        `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 900, 90)`,
        [alvo.empresaId, rows[0].id, alvo.canalId, preco]
    );

    return rows[0].id;
}

// O JWT diz sempre "vendedor" de propósito: quem vale é o banco.
const auth = (alvo, rotulo) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[rotulo], role: 'vendedor', empresa_id: alvo.empresaId, tv: 0 })}` });

const vender = (alvo, rotulo, corpo) =>
    request(app).post('/vendas').set(auth(alvo, rotulo)).send({ itens: [{ produto_id: alvo.produtoId, quantidade: 1 }], ...corpo });

const comissaoDaVenda = async (vendaId) => (await db.query('SELECT * FROM comissoes_venda WHERE venda_id = $1', [vendaId])).rows[0];
const eventosDaComissao = async (comissaoId) => (await db.query('SELECT * FROM comissoes_eventos WHERE comissao_id = $1 ORDER BY id', [comissaoId])).rows;
const repassesDaVenda = async (vendaId) => (await db.query('SELECT * FROM comissao_repasses WHERE venda_id = $1 ORDER BY id', [vendaId])).rows;

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    for (const papel of ['admin', 'gerente', 'vendedor']) await criarUsuario(A, papel);
    await criarUsuario(A, 'vendedor', 'vendedor2');
    await criarUsuario(B, 'admin');
    await criarUsuario(B, 'vendedor');

    // Gerente com a capacidade financeira: lê a configuração e paga, mas só o admin altera o modo.
    await ligarCargo(A, 'gerente', 70, ['ver_vendas_de_todos', 'gerir_financeiro']);

    for (const alvo of [A, B]) {
        await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [alvo.empresaId]);
        alvo.produtoId = await criarProduto(alvo, 100);
        alvo.clienteId = (await db.query(`INSERT INTO clientes (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [alvo.empresaId, `Cliente ${sufixo}`])).rows[0].id;
    }
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});


const pagar = (alvo, quem, corpo) => request(app).post('/comissoes/pagamentos').set(auth(alvo, quem)).send(corpo);
const aPagar = (alvo, quem) => request(app).get('/comissoes/a-pagar').set(auth(alvo, quem));
const configuracao = (alvo, quem) => request(app).get('/comissoes/configuracao').set(auth(alvo, quem));
const definirModo = (alvo, quem, modo_pagamento) => request(app).put('/comissoes/configuracao').set(auth(alvo, quem)).send({ modo_pagamento });
const hoje = () => new Date().toISOString().slice(0, 10);
const pagamento = (vendedor, valor) => ({ vendedor_id: A.u[vendedor], valor_esperado: valor, forma: 'pix', pago_em: hoje() });
const linhaDo = (res, vendedor) => res.body.data.items.find((i) => i.vendedor_id === A.u[vendedor]);

// Mesmo instante que o backend usa para "1º dia do mês corrente em Brasília".
const INICIO_DO_MES = `((date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo')::timestamp`;
// Produto custa 100: valor 200 = 2 unidades. Devolve o id da comissão gerada.
async function venderPix(rotulo, valor = 100) {
    const res = await vender(A, rotulo, { itens: [{ produto_id: A.produtoId, quantidade: valor / 100 }], pagamentos: [{ forma_pagamento: 'pix', valor }] });
    expect(res.status).toBe(201);

    return (await comissaoDaVenda(res.body.data.id)).id;
}
const moverComissao = (comissaoId, expressao) => db.query(`UPDATE comissoes_venda SET criado_em = ${expressao} WHERE id = $1`, [comissaoId]);

describe('configuração: padrão, permissão e validação', () => {
    test('sem linha = pagar assim que liberada; o a pagar informa o modo', async () => {
        const res = await configuracao(A, 'admin');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ modo_pagamento: 'liberada', padrao: true, atualizado_em: null });
        expect((await aPagar(A, 'admin')).body.data).toMatchObject({ modo_pagamento: 'liberada', totais: { a_pagar: '0.00', aguardando_fechamento: '0.00' } });
    });

    test('só o admin altera (gerente com gerir_financeiro e vendedor = 403); gerente lê', async () => {
        expect((await definirModo(A, 'gerente', 'fim_do_mes')).status).toBe(403);
        expect((await definirModo(A, 'vendedor', 'fim_do_mes')).status).toBe(403);
        expect((await configuracao(A, 'vendedor')).status).toBe(403);
        expect((await configuracao(A, 'gerente')).status).toBe(200);
        expect((await db.query('SELECT 1 FROM comissao_configuracoes WHERE empresa_id = $1', [A.empresaId])).rows).toHaveLength(0);
    });

    test('valor inválido e campo extra (strict) = 400; empresa_id do corpo não vale', async () => {
        expect((await definirModo(A, 'admin', 'quinzenal')).status).toBe(400);
        const extra = await request(app).put('/comissoes/configuracao').set(auth(A, 'admin')).send({ modo_pagamento: 'liberada', empresa_id: B.empresaId });
        expect(extra.status).toBe(400);
    });
});

describe('modo fim_do_mes', () => {
    let comissaoMes;

    test('o admin liga; fica registrado quem e quando', async () => {
        comissaoMes = await venderPix('vendedor', 100);
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '10.00', aguardando_fechamento: '0.00' });

        const res = await definirModo(A, 'admin', 'fim_do_mes');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ modo_pagamento: 'fim_do_mes', padrao: false, atualizado_por_nome: `admin ${sufixo}` });
        expect((await db.query('SELECT atualizado_por FROM comissao_configuracoes WHERE empresa_id = $1', [A.empresaId])).rows[0].atualizado_por).toBe(A.u.admin);
    });

    test('venda do mês corrente: nada a pagar, fica aguardando o fechamento, e pagar é recusado (409)', async () => {
        const res = await aPagar(A, 'admin');

        expect(res.body.data.modo_pagamento).toBe('fim_do_mes');
        expect(linhaDo(res, 'vendedor')).toMatchObject({ a_pagar: '0.00', quantidade_comissoes: 0, aguardando_fechamento: '10.00' });
        expect(res.body.data.totais).toMatchObject({ a_pagar: '0.00', aguardando_fechamento: '10.00' });

        const tentativa = await pagar(A, 'admin', pagamento('vendedor', 10));
        expect(tentativa.status).toBe(409);
        expect(tentativa.body.message || tentativa.body.error || JSON.stringify(tentativa.body)).toMatch(/fechamento do mês/);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM comissao_pagamentos WHERE empresa_id = $1', [A.empresaId])).rows[0].n).toBe(0);
    });

    test('virada do mês: 00:00:00 do dia 1º ainda é do mês corrente; 1 segundo antes já é de mês fechado', async () => {
        await moverComissao(comissaoMes, INICIO_DO_MES);
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '0.00', aguardando_fechamento: '10.00' });

        await moverComissao(comissaoMes, `${INICIO_DO_MES} - interval '1 second'`);
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '10.00', aguardando_fechamento: '0.00', quantidade_comissoes: 1 });
    });

    test('mês fechado + mês corrente no mesmo vendedor: paga só a de mês fechado, a outra segue aguardando', async () => {
        await venderPix('vendedor', 200);
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '10.00', aguardando_fechamento: '20.00' });

        // Valor da tela inclui a venda do mês corrente (30): recusado, nada gravado.
        expect((await pagar(A, 'admin', pagamento('vendedor', 30))).status).toBe(409);

        const res = await pagar(A, 'admin', pagamento('vendedor', 10));
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ valor: '10.00', quantidade_comissoes: 1 });
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '0.00', aguardando_fechamento: '20.00' });
    });

    test('estorno de comissão já paga vira desconto mesmo no fim do mês; só é abatido quando há mês fechado a pagar', async () => {
        const { venda_id } = (await db.query('SELECT venda_id FROM comissoes_venda WHERE id = $1', [comissaoMes])).rows[0];
        const cancelamento = await request(app).patch(`/vendas/${venda_id}/cancelar`).set(auth(A, 'admin')).send({ motivo: 'Cliente devolveu tudo' });
        expect(cancelamento.status).toBeLessThan(300);

        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '-10.00', descontos: '-10.00', aguardando_fechamento: '20.00' });
        expect((await pagar(A, 'admin', pagamento('vendedor', 10))).status).toBe(409);

        // A venda de 200 (20) vira de mês fechado: líquido = 20 - 10 = 10.
        const { id } = (await db.query(`SELECT id FROM comissoes_venda WHERE empresa_id = $1 AND usuario_id = $2 AND valor = 20`, [A.empresaId, A.u.vendedor])).rows[0];
        await moverComissao(id, `${INICIO_DO_MES} - interval '1 day'`);

        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor')).toMatchObject({ a_pagar: '10.00', bruto_a_pagar: '20.00', descontos: '-10.00', aguardando_fechamento: '0.00' });
        expect((await pagar(A, 'admin', pagamento('vendedor', 10))).status).toBe(201);
    });

    test('voltar para "assim que liberada" libera o que estava aguardando', async () => {
        await venderPix('vendedor2', 100);
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor2')).toMatchObject({ a_pagar: '0.00', aguardando_fechamento: '10.00' });

        expect((await definirModo(A, 'admin', 'liberada')).body.data.modo_pagamento).toBe('liberada');
        expect(linhaDo(await aPagar(A, 'admin'), 'vendedor2')).toMatchObject({ a_pagar: '10.00', aguardando_fechamento: '0.00' });
        expect((await pagar(A, 'admin', pagamento('vendedor2', 10))).status).toBe(201);
    });
});

describe('isolamento entre empresas', () => {
    test('o modo de A não vale para B; admin de B altera só o dele', async () => {
        await venderPix('vendedor', 100);
        await definirModo(A, 'admin', 'fim_do_mes');

        expect((await configuracao(B, 'admin')).body.data).toMatchObject({ modo_pagamento: 'liberada', padrao: true });

        const resB = await request(app).post('/vendas').set(auth(B, 'vendedor'))
            .send({ itens: [{ produto_id: B.produtoId, quantidade: 1 }], pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });
        expect(resB.status).toBe(201);
        expect((await aPagar(B, 'admin')).body.data.items.find((i) => i.vendedor_id === B.u.vendedor)).toMatchObject({ a_pagar: '10.00' });

        await definirModo(B, 'admin', 'fim_do_mes');
        expect((await configuracao(A, 'admin')).body.data.modo_pagamento).toBe('fim_do_mes');
        expect((await db.query('SELECT COUNT(*)::int AS n FROM comissao_configuracoes WHERE empresa_id IN ($1, $2)', [A.empresaId, B.empresaId])).rows[0].n).toBe(2);
    });
});

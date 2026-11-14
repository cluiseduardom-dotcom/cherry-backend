// Integração de verdade (Postgres de testes): recebimento PARCIAL de contas a receber (crediário do PDV). Prova: (1) o recebimento
// parcial deixa a conta "pendente" com valor recebido e restante, e só vira "recebido" quando o restante zera; (2) a parcela, o
// pagamento e a comissão acompanham na mesma transação; (3) o botão antigo "receber" (PATCH) agora registra o recebimento da
// parcela (antes deixava a parcela pendente); (4) idempotência; (5) excesso, validação e concorrência; (6) conta legada só
// por inteiro; (7) venda com recebimento parcial não pode ser cancelada; (8) isolamento, papel e histórico; (9) a Colheita
// (fiado) mostra o restante do crediário. Empresas "Teste ..." temporárias, removidas no fim.
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
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste RecParcial ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[papel] = rows[0].id;
}

async function criarProduto(alvo) {
    const { rows } = await db.query(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 100, 10, 500) RETURNING id`, [alvo.empresaId, `Produto ${sufixo}`]);
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [alvo.empresaId]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) SELECT $1, l.id, $2, 500 FROM locais_estoque l WHERE l.empresa_id = $2 AND l.tipo = 'central'`, [rows[0].id, alvo.empresaId]);
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`, [alvo.empresaId, rows[0].id, alvo.canalId]);

    return rows[0].id;
}

const token = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const chave = () => crypto.randomUUID();
const receber = (alvo, contaId, corpo, k = chave(), papel = 'admin') => {
    const r = request(app).post(`/contas-receber/${contaId}/recebimentos`).set(token(alvo, papel));

    return (k === null ? r : r.set('Idempotency-Key', k)).send(corpo);
};
const conta = async (contaId) => (await request(app).get(`/contas-receber/${contaId}`).set(token(A, 'admin'))).body.data;

// Venda no crediário: 2 parcelas de 100 (total 200; comissão de 10% = 20). Devolve a venda e as contas a receber.
async function vendaCrediario(alvo = A, cliente = A.clienteId) {
    const res = await request(app).post('/vendas').set(token(alvo, 'vendedor')).send({
        cliente_id: cliente, itens: [{ produto_id: alvo.produtoId, quantidade: 2 }],
        pagamentos: [{ forma_pagamento: 'crediario', valor: 200, numero_parcelas: 2, meses_prazo: 1 }]
    });

    expect(res.status).toBe(201);

    const contas = (await db.query('SELECT id, parcela_id FROM contas_receber WHERE venda_id = $1 ORDER BY id', [res.body.data.id])).rows;

    return { vendaId: res.body.data.id, contas };
}

const parcelaDe = async (parcelaId) => (await db.query('SELECT status, valor_pago FROM parcelas_pagamento WHERE id = $1', [parcelaId])).rows[0];
const comissaoDe = async (vendaId) => (await db.query('SELECT status, valor, valor_liberado FROM comissoes_venda WHERE venda_id = $1', [vendaId])).rows[0];
const recebimentosDe = async (parcelaId) => (await db.query('SELECT valor, forma_pagamento, chave_idempotencia FROM recebimentos_conta WHERE parcela_id = $1 ORDER BY id', [parcelaId])).rows;

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    for (const papel of ['admin', 'vendedor']) await criarUsuario(A, papel);
    await criarUsuario(B, 'admin');

    A.produtoId = await criarProduto(A);
    A.clienteId = (await db.query(`INSERT INTO clientes (empresa_id, nome, telefone, criado_por) VALUES ($1, 'Cliente Crediário', '(11) 91234-5678', $2) RETURNING id`, [A.empresaId, A.u.vendedor])).rows[0].id;
    await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [A.empresaId]);
    await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'fiado', true, 'teste', 'teste')`, [A.empresaId]);
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('recebimento parcial: conta, parcela, pagamento e comissão', () => {
    let venda;
    let c1;

    beforeAll(async () => {
        venda = await vendaCrediario();
        c1 = venda.contas[0];
    });

    test('antes de receber: nada recebido, restante = valor', async () => {
        expect(await conta(c1.id)).toMatchObject({ status: 'pendente', valor: '100.00', valor_recebido: '0.00', valor_restante: '100.00', parcial: false });
    });

    test('recebimento parcial: conta continua pendente, com recebido e restante; parcela parcial; comissão proporcional', async () => {
        const k = chave();
        const res = await receber(A, c1.id, { valor: 40, forma_pagamento: 'pix', observacao: 'Entrada' }, k);

        expect(res.status).toBe(201);
        expect(res.body.data.conta).toMatchObject({ status: 'pendente', valor_recebido: '40.00', valor_restante: '60.00', parcial: true });
        expect(res.body.data.recebimento).toMatchObject({ valor: '40.00', forma_pagamento: 'pix', observacao: 'Entrada' });
        expect(await parcelaDe(c1.parcela_id)).toMatchObject({ status: 'parcial', valor_pago: '40.00' });
        expect((await db.query('SELECT status FROM pagamentos_venda WHERE venda_id = $1', [venda.vendaId])).rows[0].status).toBe('parcial');
        expect(await comissaoDe(venda.vendaId)).toMatchObject({ valor: '20.00', valor_liberado: '4.00' });
    });

    test('a listagem traz recebido e restante (e "parcial")', async () => {
        const lista = (await request(app).get('/contas-receber?status=pendente').set(token(A, 'admin'))).body.data.items;
        const linha = lista.find((c) => c.id === c1.id);

        expect(linha).toMatchObject({ valor_recebido: '40.00', valor_restante: '60.00', parcial: true });
        expect(lista.find((c) => c.id === venda.contas[1].id)).toMatchObject({ valor_recebido: '0.00', valor_restante: '100.00', parcial: false });
    });

    test('a Colheita (fiado) mostra o restante do crediário, não o valor cheio', async () => {
        const extrato = await request(app).get(`/fiado/clientes/${A.clienteId}/extrato`).set(token(A, 'admin'));
        const mine = extrato.body.data.crediario.parcelas.find((p) => p.id === c1.id);

        expect(mine).toMatchObject({ valor: 100, valor_restante: 60 });
        expect(extrato.body.data.crediario.total).toBeLessThan(200);
    });

    test('excesso 409, valor zero/3 casas/extra/forma inválida 400, sem chave 400', async () => {
        expect((await receber(A, c1.id, { valor: 60.01 })).status).toBe(409);
        expect((await receber(A, c1.id, { valor: 0 })).status).toBe(400);
        expect((await receber(A, c1.id, { valor: -5 })).status).toBe(400);
        expect((await receber(A, c1.id, { valor: 10.005 })).status).toBe(400);
        expect((await receber(A, c1.id, { valor: '10' })).status).toBe(400);
        expect((await receber(A, c1.id, { valor: 10, parcela_id: 1 })).status).toBe(400);
        expect((await receber(A, c1.id, { valor: 10, forma_pagamento: 'cheque' })).status).toBe(400);
        expect((await receber(A, c1.id, { valor: 10 }, null)).status).toBe(400);
        expect((await receber(A, c1.id, { valor: 10 }, 'curta')).status).toBe(400);
        expect((await parcelaDe(c1.parcela_id)).valor_pago).toBe('40.00');
    });

    test('idempotência: mesma chave e conteúdo devolve o original; outro conteúdo 409; nada é lançado em dobro', async () => {
        const k = chave();
        const a = await receber(A, c1.id, { valor: 10, forma_pagamento: 'dinheiro' }, k);
        const b = await receber(A, c1.id, { valor: 10, forma_pagamento: 'dinheiro' }, k);

        expect(a.status).toBe(201);
        expect(b.status).toBe(200);
        expect(b.headers['idempotent-replayed']).toBe('true');
        expect(b.body.data.recebimento.id).toBe(a.body.data.recebimento.id);
        expect((await receber(A, c1.id, { valor: 11, forma_pagamento: 'dinheiro' }, k)).status).toBe(409);
        expect((await receber(A, venda.contas[1].id, { valor: 10, forma_pagamento: 'dinheiro' }, k)).status).toBe(409);
        expect((await parcelaDe(c1.parcela_id)).valor_pago).toBe('50.00');
    });

    test('receber o restante (sem valor): conta vira recebido, parcela recebida, comissão dessa parcela liberada', async () => {
        const res = await receber(A, c1.id, {}, chave());

        expect(res.status).toBe(201);
        expect(res.body.data.recebimento.valor).toBe('50.00');
        expect(res.body.data.conta).toMatchObject({ status: 'recebido', valor_recebido: '100.00', valor_restante: '0.00', parcial: false });
        expect(await parcelaDe(c1.parcela_id)).toMatchObject({ status: 'recebida', valor_pago: '100.00' });
        expect(await comissaoDe(venda.vendaId)).toMatchObject({ valor_liberado: '10.00' });
        expect((await receber(A, c1.id, {}, chave())).status).toBe(409);
        expect((await receber(A, c1.id, { valor: 1 }, chave())).status).toBe(409);
    });

    test('histórico: cada recebimento, em ordem, com quem recebeu', async () => {
        const hist = await request(app).get(`/contas-receber/${c1.id}/recebimentos`).set(token(A, 'admin'));

        expect(hist.status).toBe(200);
        expect(hist.body.data.map((r) => r.valor)).toEqual(['40.00', '10.00', '50.00']);
        expect(hist.body.data[0]).toMatchObject({ forma_pagamento: 'pix', observacao: 'Entrada' });
        expect(hist.body.data[0].recebido_por).toBeTruthy();
    });

    test('o botão antigo "receber" (PATCH) agora registra o recebimento: parcela recebida, pagamento pago, comissão toda liberada', async () => {
        const res = await request(app).patch(`/contas-receber/${venda.contas[1].id}/receber`).set(token(A, 'admin'));

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'recebido', valor_restante: '0.00' });
        expect(await parcelaDe(venda.contas[1].parcela_id)).toMatchObject({ status: 'recebida', valor_pago: '100.00' });
        expect((await recebimentosDe(venda.contas[1].parcela_id)).map((r) => r.valor)).toEqual(['100.00']);
        expect((await db.query('SELECT status FROM pagamentos_venda WHERE venda_id = $1', [venda.vendaId])).rows[0].status).toBe('pago');
        expect(await comissaoDe(venda.vendaId)).toMatchObject({ valor_liberado: '20.00' });
        expect((await request(app).patch(`/contas-receber/${venda.contas[1].id}/receber`).set(token(A, 'admin'))).status).toBe(409);
    });
});

describe('concorrência', () => {
    test('dois recebimentos simultâneos de 60 numa parcela de 100: um passa, o outro 409; total 60', async () => {
        const { contas } = await vendaCrediario();
        const respostas = await Promise.all([receber(A, contas[0].id, { valor: 60 }), receber(A, contas[0].id, { valor: 60 })]);

        expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
        expect((await parcelaDe(contas[0].parcela_id)).valor_pago).toBe('60.00');
        expect(await recebimentosDe(contas[0].parcela_id)).toHaveLength(1);
    });

    test('a mesma chave enviada duas vezes ao mesmo tempo registra UM recebimento só', async () => {
        const { contas } = await vendaCrediario();
        const k = chave();
        const respostas = await Promise.all([receber(A, contas[0].id, { valor: 30 }, k), receber(A, contas[0].id, { valor: 30 }, k)]);

        expect(respostas.map((r) => r.status).sort()).toEqual([200, 201]);
        expect(await recebimentosDe(contas[0].parcela_id)).toHaveLength(1);
        expect((await parcelaDe(contas[0].parcela_id)).valor_pago).toBe('30.00');
    });
});

describe('conta legada (sem parcela): só por inteiro', () => {
    test('recebimento parcial 422; sem valor recebe tudo; PATCH continua funcionando', async () => {
        const venda = (await db.query(
            `INSERT INTO vendas (cliente_id, canal_id, usuario_id, subtotal, desconto, juros, total, status, data, empresa_id, forma_pagamento)
             VALUES ($1, $2, $3, 80, 0, 0, 80, 'finalizada', NOW(), $4, 'prazo') RETURNING id`, [A.clienteId, A.canalId, A.u.vendedor, A.empresaId])).rows[0].id;
        const [c1, c2] = (await db.query(
            `INSERT INTO contas_receber (venda_id, descricao, valor, data_vencimento, empresa_id) VALUES ($1, 'Legada 1', 80, '2027-03-10', $2), ($1, 'Legada 2', 80, '2027-04-10', $2) RETURNING id`, [venda, A.empresaId])).rows;

        const parcial = await receber(A, c1.id, { valor: 30 });

        expect(parcial.status).toBe(422);
        expect(parcial.body.message).toMatch(/por inteiro/);
        expect(await conta(c1.id)).toMatchObject({ status: 'pendente', valor_recebido: '0.00', valor_restante: '80.00' });

        const total = await receber(A, c1.id, {});

        expect(total.status).toBe(201);
        expect(total.body.data.conta).toMatchObject({ status: 'recebido', valor_recebido: '80.00', valor_restante: '0.00' });
        expect((await request(app).patch(`/contas-receber/${c2.id}/receber`).set(token(A, 'admin'))).body.data.status).toBe('recebido');
    });
});

describe('cancelamento de venda com recebimento parcial', () => {
    test('é recusado (409) e nada muda; sem recebimento, cancela normalmente', async () => {
        const comParcial = await vendaCrediario();

        await receber(A, comParcial.contas[0].id, { valor: 25 });

        const recusado = await request(app).patch(`/vendas/${comParcial.vendaId}/cancelar`).set(token(A, 'admin')).send({ motivo: 'Cliente desistiu da compra' });

        expect(recusado.status).toBe(409);
        expect(recusado.body.message).toMatch(/recebimento parcial/);
        expect((await db.query('SELECT status FROM vendas WHERE id = $1', [comParcial.vendaId])).rows[0].status).toBe('finalizada');
        expect((await conta(comParcial.contas[0].id)).status).toBe('pendente');

        const semRecebimento = await vendaCrediario();
        const ok = await request(app).patch(`/vendas/${semRecebimento.vendaId}/cancelar`).set(token(A, 'admin')).send({ motivo: 'Cliente desistiu da compra' });

        expect(ok.status).toBe(200);
    });
});

describe('isolamento e papel', () => {
    test('empresa B não recebe, não vê e não lista as contas da A; vendedor da A não recebe', async () => {
        const { contas } = await vendaCrediario();

        expect((await receber(B, contas[0].id, { valor: 10 }, chave(), 'admin')).status).toBe(404);
        expect((await request(app).get(`/contas-receber/${contas[0].id}/recebimentos`).set(token(B, 'admin'))).status).toBe(404);
        expect((await request(app).patch(`/contas-receber/${contas[0].id}/receber`).set(token(B, 'admin'))).status).toBe(404);
        expect((await request(app).get('/contas-receber').set(token(B, 'admin'))).body.data.items).toHaveLength(0);
        expect((await receber(A, contas[0].id, { valor: 10 }, chave(), 'vendedor')).status).toBe(403);
        expect((await parcelaDe(contas[0].parcela_id)).valor_pago).toBe('0.00');
    });
});

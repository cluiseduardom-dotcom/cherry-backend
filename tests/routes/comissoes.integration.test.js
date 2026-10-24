// Integração de verdade (Postgres da CI/dev, sem mock de sessão): migration 054 + vendas reais
// (POST /vendas) + pagamentos + cancelamento + /comissoes. Prova que a comissão NASCE pendente
// e é liberada pelo PAGAMENTO (proporcional por parcela), que dinheiro do vendedor só libera
// com repasse confirmado por OUTRA pessoa, que estorno/cancelamento revertem e que tudo fica
// no histórico. Empresas e usuários próprios e temporários; remove tudo no fim.
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
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Comissoes ${rotulo} ${sufixo}`]);
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
    await criarUsuario(B, 'gerente');
    await criarUsuario(B, 'vendedor');

    // Gerente vem desligado por padrão: a empresa liga e ele passa a ver a equipe.
    await ligarCargo(A, 'gerente', 70, ['ver_vendas_de_todos']);
    await ligarCargo(B, 'gerente', 70, ['ver_vendas_de_todos']);

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

describe('migration 054', () => {
    test('liberado não passa do valor, status é fechado e o repasse não pode ser autoconfirmado', async () => {
        const venda = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });
        const comissao = await comissaoDaVenda(venda.body.data.id);

        await expect(db.query('UPDATE comissoes_venda SET valor_liberado = valor + 0.01 WHERE id = $1', [comissao.id]))
            .rejects.toMatchObject({ code: '23514' });
        await expect(db.query(`UPDATE comissoes_venda SET status = 'apurada' WHERE id = $1`, [comissao.id]))
            .rejects.toMatchObject({ code: '23514' });

        const dinheiro = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }] });
        const [repasse] = await repassesDaVenda(dinheiro.body.data.id);

        await expect(db.query(
            `UPDATE comissao_repasses SET status = 'confirmado', confirmado_em = NOW(), confirmado_por = vendedor_id WHERE id = $1`,
            [repasse.id]
        )).rejects.toMatchObject({ code: '23514' });
    });
});

describe('pagamento imediato (pix/débito)', () => {
    test('a comissão nasce e já é liberada na venda, com histórico', async () => {
        const res = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });

        expect(res.status).toBe(201);

        const comissao = await comissaoDaVenda(res.body.data.id);
        expect(comissao).toMatchObject({ valor: '10.00', valor_liberado: '10.00', status: 'liberada' });

        const eventos = await eventosDaComissao(comissao.id);
        expect(eventos.map((e) => [e.tipo, e.origem, e.delta])).toEqual([
            ['apurada', 'venda', '0.00'],
            ['liberacao', 'venda', '10.00']
        ]);
        expect(eventos[1].executado_por).toBe(A.u.vendedor);
    });

    test('a dona (admin) não ganha comissão pelo padrão da empresa', async () => {
        const res = await vender(A, 'admin', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });

        expect(res.status).toBe(201);
        expect(await comissaoDaVenda(res.body.data.id)).toBeUndefined();
        expect(await repassesDaVenda(res.body.data.id)).toHaveLength(0);
    });

    test('percentual PRÓPRIO definido para o admin vale (a regra só afasta o padrão)', async () => {
        await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, $2, 3)`, [A.empresaId, A.u.admin]);

        const res = await vender(A, 'admin', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });
        expect(await comissaoDaVenda(res.body.data.id)).toMatchObject({ valor: '3.00', status: 'liberada' });

        await db.query(`DELETE FROM comissao_percentuais WHERE empresa_id = $1 AND usuario_id = $2`, [A.empresaId, A.u.admin]);
    });
});

describe('dinheiro recebido pelo vendedor: dois passos', () => {
    let vendaId;
    let repasseId;

    test('na venda a comissão fica pendente e o dinheiro vira "a repassar"', async () => {
        const res = await vender(A, 'vendedor2', { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100, valor_recebido: 100 }] });
        vendaId = res.body.data.id;

        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor: '10.00', valor_liberado: '0.00', status: 'pendente' });

        const [repasse] = await repassesDaVenda(vendaId);
        repasseId = repasse.id;
        expect(repasse).toMatchObject({ status: 'a_repassar', valor: '100.00', vendedor_id: A.u.vendedor2 });

        const minhas = await request(app).get('/comissoes/minhas').set(auth(A, 'vendedor2'));
        expect(minhas.body.data.totais).toMatchObject({ total_comissao: '10.00', total_liberado: '0.00', total_pendente: '10.00', dinheiro_a_repassar: '100.00' });
    });

    test('o vendedor não confirma o próprio repasse (403) nem enxerga os dos outros', async () => {
        expect((await request(app).post(`/comissoes/repasses/${repasseId}/confirmar`).set(auth(A, 'vendedor2')).send({})).status).toBe(403);

        const dele = await request(app).get('/comissoes/repasses').set(auth(A, 'vendedor2'));
        expect(dele.body.data.items.every((r) => r.vendedor_id === A.u.vendedor2)).toBe(true);

        const doOutro = await request(app).get('/comissoes/repasses').set(auth(A, 'vendedor'));
        expect(doOutro.body.data.items.some((r) => r.id === repasseId)).toBe(false);
    });

    test('gerente de OUTRA empresa não confirma (404, nada muda)', async () => {
        const res = await request(app).post(`/comissoes/repasses/${repasseId}/confirmar`).set(auth(B, 'gerente')).send({});

        expect(res.status).toBe(404);
        expect((await repassesDaVenda(vendaId))[0].status).toBe('a_repassar');
    });

    test('o gerente confirma: o repasse fecha, a comissão é liberada e o histórico diz quem confirmou', async () => {
        const res = await request(app).post(`/comissoes/repasses/${repasseId}/confirmar`).set(auth(A, 'gerente')).send({ observacao: 'Recebi na loja' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'confirmado', confirmado_por: A.u.gerente, observacao: 'Recebi na loja' });
        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '10.00', status: 'liberada' });

        const comissao = await comissaoDaVenda(vendaId);
        const eventos = await eventosDaComissao(comissao.id);
        expect(eventos[eventos.length - 1]).toMatchObject({ tipo: 'liberacao', origem: 'repasse', repasse_id: repasseId, executado_por: A.u.gerente });
    });

    test('confirmar de novo: 409, sem novo evento', async () => {
        const comissao = await comissaoDaVenda(vendaId);
        const antes = (await eventosDaComissao(comissao.id)).length;

        expect((await request(app).post(`/comissoes/repasses/${repasseId}/confirmar`).set(auth(A, 'gerente')).send({})).status).toBe(409);
        expect((await eventosDaComissao(comissao.id)).length).toBe(antes);
    });

    test('o gerente que ele mesmo vendeu em dinheiro não confirma o próprio repasse', async () => {
        await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, $2, 5)`, [A.empresaId, A.u.gerente]);

        const res = await vender(A, 'gerente', { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }] });
        const [repasse] = await repassesDaVenda(res.body.data.id);
        const tentativa = await request(app).post(`/comissoes/repasses/${repasse.id}/confirmar`).set(auth(A, 'gerente')).send({});

        expect(tentativa.status).toBe(403);
        expect(await comissaoDaVenda(res.body.data.id)).toMatchObject({ status: 'pendente' });

        await db.query(`DELETE FROM comissao_percentuais WHERE empresa_id = $1 AND usuario_id = $2`, [A.empresaId, A.u.gerente]);
    });
});

describe('pagamento misto', () => {
    test('pix 40 + dinheiro 60: libera 40% já na venda e o restante só após o repasse', async () => {
        const res = await vender(A, 'vendedor', {
            pagamentos: [{ forma_pagamento: 'pix', valor: 40 }, { forma_pagamento: 'dinheiro', valor: 60 }]
        });
        const vendaId = res.body.data.id;

        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '4.00', status: 'parcial' });

        const [repasse] = await repassesDaVenda(vendaId);
        expect(repasse.valor).toBe('60.00');

        await request(app).post(`/comissoes/repasses/${repasse.id}/confirmar`).set(auth(A, 'gerente')).send({});
        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '10.00', status: 'liberada' });
    });
});

describe('venda parcelada (crediário): proporcional a cada parcela paga', () => {
    test('3 parcelas de R$ 33,33 / 33,33 / 33,34: libera 3,33 → 6,66 → 10,00 (sem resto)', async () => {
        const res = await vender(A, 'vendedor', { cliente_id: A.clienteId, pagamentos: [{ forma_pagamento: 'crediario', valor: 100, numero_parcelas: 3, meses_prazo: 1 }] });
        if (res.status !== 201) throw new Error(JSON.stringify(res.body));
        const vendaId = res.body.data.id;

        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '0.00', status: 'pendente' });

        const { rows: parcelas } = await db.query(
            `SELECT pp.id, pp.valor FROM parcelas_pagamento pp JOIN pagamentos_venda pv ON pv.id = pp.pagamento_id
             WHERE pv.venda_id = $1 ORDER BY pp.numero`, [vendaId]
        );

        const esperados = [['3.33', 'parcial'], ['6.66', 'parcial'], ['10.00', 'liberada']];

        for (let i = 0; i < parcelas.length; i++) {
            const receber = await request(app).patch(`/parcelas/${parcelas[i].id}/receber`).set(auth(A, 'admin'))
                .send({ valor: Number(parcelas[i].valor), forma_pagamento: 'pix' });

            expect(receber.status).toBe(201);
            expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: esperados[i][0], status: esperados[i][1] });
        }

        const comissao = await comissaoDaVenda(vendaId);
        const eventos = (await eventosDaComissao(comissao.id)).filter((e) => e.tipo === 'liberacao');

        expect(eventos.map((e) => e.origem)).toEqual(['pagamento', 'pagamento', 'pagamento']);
        expect(eventos.reduce((soma, e) => soma + Number(e.delta), 0).toFixed(2)).toBe('10.00');
    });
});

describe('estorno de pagamento e cancelamento', () => {
    test('estornar metade do pagamento reduz a comissão liberada pela metade, com evento de redução', async () => {
        const res = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });
        const vendaId = res.body.data.id;
        const pagamentoId = res.body.data.pagamentos[0].id;

        const estorno = await request(app).post(`/pagamentos/${pagamentoId}/estornar`).set(auth(A, 'admin')).send({ valor: 50, motivo: 'Devolução parcial' });

        expect(estorno.status).toBeLessThan(300);
        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '5.00', status: 'parcial' });

        const comissao = await comissaoDaVenda(vendaId);
        const eventos = await eventosDaComissao(comissao.id);
        expect(eventos[eventos.length - 1]).toMatchObject({ tipo: 'reducao', origem: 'estorno_pagamento', delta: '-5.00', executado_por: A.u.admin });
    });

    test('cancelar a venda estorna a comissão (zera o liberado), cancela o repasse pendente e registra', async () => {
        const res = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 60 }, { forma_pagamento: 'dinheiro', valor: 40 }] });
        const vendaId = res.body.data.id;

        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '6.00' });

        const cancelamento = await request(app).patch(`/vendas/${vendaId}/cancelar`).set(auth(A, 'admin')).send({ motivo: 'Cliente desistiu da compra' });
        expect(cancelamento.status).toBe(200);

        const comissao = await comissaoDaVenda(vendaId);
        expect(comissao).toMatchObject({ status: 'estornada', valor_liberado: '0.00' });
        expect(comissao.estornado_em).not.toBeNull();
        expect((await repassesDaVenda(vendaId))[0].status).toBe('cancelado');

        const eventos = await eventosDaComissao(comissao.id);
        expect(eventos[eventos.length - 1]).toMatchObject({ tipo: 'estorno', origem: 'cancelamento_venda', delta: '-6.00' });

        const repasse = (await repassesDaVenda(vendaId))[0];
        expect((await request(app).post(`/comissoes/repasses/${repasse.id}/confirmar`).set(auth(A, 'gerente')).send({})).status).toBe(409);
    });
});

describe('venda legada (sem pagamentos[])', () => {
    test('à vista libera na hora; a prazo só quando a conta a receber é recebida', async () => {
        const aVista = await vender(A, 'vendedor', { forma_pagamento: 'a_vista' });
        expect(await comissaoDaVenda(aVista.body.data.id)).toMatchObject({ valor_liberado: '10.00', status: 'liberada' });

        const aPrazo = await vender(A, 'vendedor', { cliente_id: A.clienteId, forma_pagamento: 'prazo', meses_prazo: 1 });
        const vendaId = aPrazo.body.data.id;
        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '0.00', status: 'pendente' });

        const conta = await request(app).patch(`/contas-receber/${aPrazo.body.data.conta_receber.id}/receber`).set(auth(A, 'admin')).send({});
        expect(conta.status).toBe(200);
        expect(await comissaoDaVenda(vendaId)).toMatchObject({ valor_liberado: '10.00', status: 'liberada' });

        const comissao = await comissaoDaVenda(vendaId);
        const eventos = await eventosDaComissao(comissao.id);
        expect(eventos[eventos.length - 1]).toMatchObject({ origem: 'conta_receber', executado_por: A.u.admin });
    });
});

describe('histórico e visões', () => {
    test('o vendedor vê o histórico da própria comissão; a de outro é 404; o gerente vê qualquer; outra empresa é 404', async () => {
        const res = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });
        const comissao = await comissaoDaVenda(res.body.data.id);

        const dono = await request(app).get(`/comissoes/${comissao.id}/historico`).set(auth(A, 'vendedor'));
        expect(dono.status).toBe(200);
        expect(dono.body.data.eventos.map((e) => e.tipo)).toEqual(['apurada', 'liberacao']);
        expect(dono.body.data.eventos[1].executado_por_nome).toContain(`vendedor ${sufixo}`);

        expect((await request(app).get(`/comissoes/${comissao.id}/historico`).set(auth(A, 'vendedor2'))).status).toBe(404);
        expect((await request(app).get(`/comissoes/${comissao.id}/historico`).set(auth(A, 'gerente'))).status).toBe(200);
        expect((await request(app).get(`/comissoes/${comissao.id}/historico`).set(auth(B, 'gerente'))).status).toBe(404);
    });

    test('equipe: totais fecham (comissão = liberado + pendente) e o admin sem percentual próprio aparece sem percentual', async () => {
        const res = await request(app).get('/comissoes/equipe').set(auth(A, 'gerente'));

        expect(res.status).toBe(200);

        const { items, totais } = res.body.data;
        const admin = items.find((i) => i.usuario_id === A.u.admin);
        expect(admin.percentual).toBeNull();

        expect(Number(totais.total_comissao).toFixed(2)).toBe((Number(totais.total_liberado) + Number(totais.total_pendente)).toFixed(2));
        expect(items.every((i) => Number(i.total_comissao).toFixed(2) === (Number(i.total_liberado) + Number(i.total_pendente)).toFixed(2))).toBe(true);
    });

    test('vendedor sem permissão de equipe: 403; repasses só para quem vende ou administra', async () => {
        expect((await request(app).get('/comissoes/equipe').set(auth(A, 'vendedor'))).status).toBe(403);
        expect((await request(app).post('/comissoes/repasses/1/confirmar').set(auth(A, 'vendedor')).send({})).status).toBe(403);
        expect((await request(app).get('/comissoes/repasses?status=invalido').set(auth(A, 'gerente'))).status).toBe(400);
    });

    test('estoque e totais da venda não mudam por causa da comissão (regressão do PDV)', async () => {
        const antes = (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.produtoId])).rows[0].estoque_atual;
        const res = await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] });
        const depois = (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [A.produtoId])).rows[0].estoque_atual;

        expect(Number(res.body.data.total)).toBe(100);
        expect(depois).toBe(antes - 1);
        expect(JSON.stringify(res.body)).not.toMatch(/comiss/i);
    });
});

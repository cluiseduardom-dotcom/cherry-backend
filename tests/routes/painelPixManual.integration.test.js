// Integração: sinalização e bloqueio do Pix manual (Taxas a receber, etapa 6, T7). Vendas REAIS pela API do ERP
// (rota -> repository -> Postgres), operador do painel real, trilha real. O que se prova:
//  - bloqueado, o lançamento de Pix manual na venda é recusado NO BACKEND (a venda inteira, sem efeito colateral);
//  - Pix do Mercado Pago, dinheiro e débito seguem; outra empresa não é afetada;
//  - a mensagem ao caixa não cita taxa nem motivo (taxa nunca aparece na API de vendas);
//  - liberar exige justificativa e reabre; tudo com responsável da sessão e na trilha.
jest.setTimeout(90000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { darEstoqueInicial } = require('../helpers/estoqueInicial');
const { hojeSP } = require('../../src/utils/dataSaoPaulo');

const registro = criarRegistroDeEmpresas(db);
const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');
const PRECO = 120;

const A = {};
const B = {};
let operador;

async function montarEmpresa(alvo, rotulo) {
    const emp = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste PixManual ${rotulo} ${SUFIXO}`]);
    alvo.id = registro.registrar(emp.rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.id])).rows[0].id;

    const email = `pixmanual-${rotulo}-${SUFIXO}@teste.invalid`;
    alvo.usuarioId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.id, `Teste admin ${rotulo}`, email, await bcrypt.hash(SENHA, 4)]
    )).rows[0].id;
    const login = await request(app).post('/auth/login').send({ email, senha: SENHA });
    if (login.status !== 200) throw new Error(`login: ${login.status} ${JSON.stringify(login.body)}`);
    alvo.token = login.body.data.token;

    const prod = await request(app).post('/produtos').set('Authorization', `Bearer ${alvo.token}`)
        .send({ nome: `Peça ${rotulo}`, preco_venda: PRECO, custo: 0.5, estoque_minimo: 1 });
    if (prod.status !== 201) throw new Error(`produto: ${prod.status} ${JSON.stringify(prod.body)}`);
    alvo.produtoId = prod.body.data.id;
    await darEstoqueInicial(app, alvo.token, alvo.produtoId, 50);
    const preco = await request(app).put(`/produtos/${alvo.produtoId}/precos/${alvo.canalId}`).set('Authorization', `Bearer ${alvo.token}`).send({ preco_venda: PRECO });
    if (preco.status !== 201) throw new Error(`preço: ${preco.status} ${JSON.stringify(preco.body)}`);
}

const vender = (alvo, pagamentos) => request(app).post('/vendas').set('Authorization', `Bearer ${alvo.token}`)
    .send({ canal: 'loja_fisica', itens: [{ produto_id: alvo.produtoId, quantidade: 1 }], pagamentos });

const pix = (extra = {}) => [{ forma_pagamento: 'pix', valor: PRECO, ...extra }];
const estoque = async (alvo) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [alvo.produtoId])).rows[0].estoque_atual;
const contarVendas = async (alvo) => Number((await db.query('SELECT COUNT(*) FROM vendas WHERE empresa_id = $1', [alvo.id])).rows[0].count);

const bloquear = (alvo, corpo) => request(app).post(`/painel/empresas/${alvo.id}/pix-manual/bloquear`).set(operador.cabecalho).send(corpo);
const liberar = (alvo, corpo) => request(app).post(`/painel/empresas/${alvo.id}/pix-manual/liberar`).set(operador.cabecalho).send(corpo);

// Pix cobrado pelo Mercado Pago: a cobrança precisa estar paga e ser do usuário que vende (a origem "gateway" nasce no backend).
async function cobrancaPaga(alvo) {
    const codigo = crypto.randomUUID();
    await db.query(
        `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, metodo, status, criado_por, id_externo)
         VALUES ($1, $2, $3, 'pix', 'pago', $4, $5)`,
        [codigo, alvo.id, PRECO, alvo.usuarioId, `mp-${crypto.randomBytes(4).toString('hex')}`]
    );
    return codigo;
}

async function removerTrilhaDasEmpresas(ids) {
    const c = await db.connect();
    try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL vertumno.limpeza_teste = 'on'`);
        await c.query('DELETE FROM plataforma_eventos WHERE alvo_empresa_id = ANY($1::int[])', [ids]);
        await c.query('COMMIT');
    } catch (erro) {
        await c.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        c.release();
    }
}

beforeAll(async () => {
    operador = await criarOperadorComSessao('pixmanual');
    await montarEmpresa(A, 'A');
    await montarEmpresa(B, 'B');
});

afterAll(async () => {
    try {
        await removerTrilhaDasEmpresas(registro.ids());
        await registro.limpar();
        await removerOperador(operador);
    } finally {
        await db.end();
    }
});

describe('antes do bloqueio', () => {
    test('Pix manual funciona normalmente', async () => {
        expect((await vender(A, pix())).status).toBe(201);
    });
});

describe('bloquear o Pix manual (operador do painel)', () => {
    test('exige justificativa (400); só operador do painel (ERP 401)', async () => {
        expect((await bloquear(A, {})).status).toBe(400);
        expect((await bloquear(A, { justificativa: 'curta' })).status).not.toBe(400); // 5 caracteres já valem
        // desfaz o bloqueio acima para o resto do roteiro começar do zero
        expect((await liberar(A, { justificativa: 'teste de validação' })).status).toBe(200);

        const tokenErp = makeToken({ id: A.usuarioId, empresa_id: A.id, papel: 'admin' });
        const r = await request(app).post(`/painel/empresas/${A.id}/pix-manual/bloquear`).set('Authorization', `Bearer ${tokenErp}`).send({ justificativa: 'tentativa do ERP' });
        expect(r.status).toBe(401);
        expect((await request(app).post(`/painel/empresas/${A.id}/pix-manual/bloquear`).send({ justificativa: 'sem sessão' })).status).toBe(401);
    });

    test('empresa inexistente: 404; corpo com campo extra (responsável forjado): 400', async () => {
        expect((await request(app).post('/painel/empresas/999999999/pix-manual/bloquear').set(operador.cabecalho).send({ justificativa: 'não existe' })).status).toBe(404);
        expect((await bloquear(A, { justificativa: 'campo extra', responsavel: 'forjado' })).status).toBe(400);
    });

    test('bloqueia, grava quem e por quê; repetir é 409 (um bloqueio ativo por empresa)', async () => {
        const res = await bloquear(A, { justificativa: 'Pix manual acima do padrão em outubro' });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ empresa_id: A.id, motivo: 'pix_manual_sinalizado', aberto_por: `painel:${operador.email} (#${operador.id})` });

        expect((await bloquear(A, { justificativa: 'segundo clique' })).status).toBe(409);
    });
});

describe('com o Pix manual bloqueado (venda no PDV)', () => {
    test('Pix manual é RECUSADO no backend, a venda inteira, sem efeito colateral', async () => {
        const antes = { estoque: await estoque(A), vendas: await contarVendas(A) };
        const res = await vender(A, pix());

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/Pix manual está indisponível/);
        // taxa e motivo nunca aparecem na API de vendas (R6)
        expect(res.body.message).not.toMatch(/taxa|sinaliz|fuga|padrão|bloque/i);
        expect(await estoque(A)).toBe(antes.estoque);
        expect(await contarVendas(A)).toBe(antes.vendas);
    });

    test('Pix manual misturado com outra forma também é recusado (nada de vender parte)', async () => {
        const antes = await contarVendas(A);
        const res = await vender(A, [{ forma_pagamento: 'pix', valor: 20 }, { forma_pagamento: 'dinheiro', valor: PRECO - 20 }]);
        expect(res.status).toBe(403);
        expect(await contarVendas(A)).toBe(antes);
    });

    test('dinheiro e débito seguem funcionando', async () => {
        expect((await vender(A, [{ forma_pagamento: 'dinheiro', valor: PRECO }])).status).toBe(201);
        expect((await vender(A, [{ forma_pagamento: 'debito', valor: PRECO }])).status).toBe(201);
    });

    test('Pix cobrado pelo Mercado Pago segue funcionando e fica com origem gateway', async () => {
        const codigo = await cobrancaPaga(A);
        const res = await vender(A, pix({ cobranca_codigo: codigo }));
        expect(res.status).toBe(201);

        const { rows } = await db.query('SELECT origem FROM pagamentos_venda WHERE venda_id = $1', [res.body.data.id]);
        expect(rows).toEqual([{ origem: 'gateway' }]);
    });

    test('outra empresa não é afetada', async () => {
        expect((await vender(B, pix())).status).toBe(201);
    });

    test('o resumo do mês mostra a proporção Pix MP × manual e o bloqueio da loja', async () => {
        const res = await request(app).get('/painel/taxas/cobranca').set(operador.cabecalho)
            .query({ competencia: hojeSP().slice(0, 7), empresa_id: A.id });
        const loja = res.body.data.items.find((i) => i.empresa_id === A.id);

        // A vendeu 1 Pix manual (antes do bloqueio) e 1 Pix pelo Mercado Pago: 50% cada.
        expect(loja).toMatchObject({ pix_manual: PRECO, pix_mp: PRECO, pct_manual: 50 });
        expect(loja.bloqueio_pix_manual).toMatchObject({ justificativa: 'Pix manual acima do padrão em outubro', aberto_por: `painel:${operador.email} (#${operador.id})` });

        const deB = (await request(app).get('/painel/taxas/cobranca').set(operador.cabecalho)
            .query({ competencia: hojeSP().slice(0, 7), empresa_id: B.id })).body.data.items.find((i) => i.empresa_id === B.id);
        expect(deB).toMatchObject({ pct_manual: 100, bloqueio_pix_manual: null });
    });
});

describe('liberar o Pix manual', () => {
    test('exige justificativa (400); sem bloqueio ativo é 409', async () => {
        expect((await liberar(A, {})).status).toBe(400);
        expect((await liberar(B, { justificativa: 'B nunca foi bloqueada' })).status).toBe(409);
    });

    test('libera com justificativa, e o Pix manual volta a funcionar', async () => {
        const res = await liberar(A, { justificativa: 'Revisado: operação legítima de atacado' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ liberado_por: `painel:${operador.email} (#${operador.id})` });
        expect((await vender(A, pix())).status).toBe(201);

        expect((await liberar(A, { justificativa: 'já está liberado' })).status).toBe(409);
    });

    test('dá para bloquear de novo (nasce outro registro) e o histórico fica completo e imutável', async () => {
        expect((await bloquear(A, { justificativa: 'Voltou a fugir do padrão' })).status).toBe(201);
        const { rows } = await db.query('SELECT liberado_em, justificativa FROM bloqueios_pix_empresa WHERE empresa_id = $1 ORDER BY id', [A.id]);
        expect(rows.map((r) => [r.justificativa, r.liberado_em !== null])).toEqual([
            ['curta', true],
            ['Pix manual acima do padrão em outubro', true],
            ['Voltou a fugir do padrão', false]
        ]);

        await expect(db.query('DELETE FROM bloqueios_pix_empresa WHERE empresa_id = $1', [A.id])).rejects.toThrow(/não pode ser apagado/);
        await expect(db.query(`UPDATE bloqueios_pix_empresa SET justificativa = 'reescrita do histórico' WHERE empresa_id = $1 AND liberado_em IS NOT NULL`, [A.id]))
            .rejects.toThrow(/imutável/);
        await expect(db.query(`UPDATE bloqueios_pix_empresa SET justificativa = 'reescrita' WHERE empresa_id = $1 AND liberado_em IS NULL`, [A.id]))
            .rejects.toThrow(/só pode ser liberado/);
    });
});

describe('trilha', () => {
    test('cada bloqueio e cada liberação ficam em plataforma_eventos, com o operador e a justificativa', async () => {
        const { rows } = await db.query(
            `SELECT acao, operador_id, detalhe FROM plataforma_eventos
             WHERE alvo_empresa_id = $1 AND acao IN ('pix_manual_bloqueado', 'pix_manual_liberado') ORDER BY id`,
            [A.id]
        );
        expect(rows.map((r) => r.acao)).toEqual(['pix_manual_bloqueado', 'pix_manual_liberado', 'pix_manual_bloqueado', 'pix_manual_liberado', 'pix_manual_bloqueado']);
        expect(rows.every((r) => r.operador_id === operador.id)).toBe(true);
        expect(rows[2].detalhe).toMatchObject({ justificativa: 'Pix manual acima do padrão em outubro', responsavel: `painel:${operador.email} (#${operador.id})` });
    });
});

// Integração de verdade: Taxas a receber (etapa 2) — fechamento do período, pagamento, perdão, ajuste e
// estorno de venda cancelada após o fechamento. Rotas /painel/* (operador do painel), banco de testes.
// Cada empresa de teste usa competências antigas e próprias; o fechamento é sempre filtrado pela empresa,
// para não fechar dados de outras suítes. O mês corrente é o real (horário de Brasília).
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const vendasRepository = require('../../src/repositories/vendasRepository');
const { makeToken } = require('../helpers/token');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { hojeSP } = require('../../src/utils/dataSaoPaulo');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);

const A = {};
const B = {};
const C = {};
let politica;
let operador;

const MES_CORRENTE = hojeSP().slice(0, 7);
const chave = (rotulo) => `${rotulo}-${sufixo}`;

async function criarEmpresa(alvo, rotulo) {
    const nome = `Teste Cobranca Taxa ${rotulo} ${sufixo}`;
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [nome]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.adminId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.empresaId, `admin ${sufixo}`, `admin-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH]
    )).rows[0].id;
}

// Venda com taxa congelada (como a venda real grava) e, opcionalmente, o Pix do Mercado Pago com a comissão retida.
async function criarVendaComTaxa(alvo, instanteUtc, { base, valor, retido = 0 }) {
    const venda = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, usuario_id, total, status, data)
         VALUES ($1, $2, $3, $4, 'finalizada', ($5::timestamptz) AT TIME ZONE current_setting('TimeZone')) RETURNING id`,
        [alvo.empresaId, alvo.canalId, alvo.adminId, base, instanteUtc]
    );
    const vendaId = venda.rows[0].id;

    await db.query(
        `INSERT INTO taxas_venda (venda_id, empresa_id, politica_id, plano_id, origem, tipo, percentual, base_calculo, valor, status)
         VALUES ($1, $2, $3, $4, 'padrao_sem_plano', 'percentual', 0.5, $5, $6, 'apurada')`,
        [vendaId, alvo.empresaId, politica.id, politica.plano_id, base, valor]
    );

    if (retido > 0) {
        await db.query(
            `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, metodo, status, taxa_plataforma, venda_id, usada_em)
             VALUES ($1, $2, $3, 'pix', 'pago', $4, $5, NOW())`,
            [crypto.randomUUID(), alvo.empresaId, base, retido, vendaId]
        );
    }

    return vendaId;
}

const comOperador = (req) => req.set(operador.cabecalho);
const fechar = (body) => comOperador(request(app).post('/painel/taxas/periodos/fechar')).send(body);
const resumo = (query) => comOperador(request(app).get('/painel/taxas/cobranca')).query(query);
const detalhe = (id) => comOperador(request(app).get(`/painel/taxas/periodos/${id}`));
const pagar = (id, body) => comOperador(request(app).post(`/painel/taxas/periodos/${id}/pagamentos`)).send(body);
const perdoar = (id, body) => comOperador(request(app).post(`/painel/taxas/periodos/${id}/perdoes`)).send(body);
const ajustar = (empresaId, body) => comOperador(request(app).post(`/painel/empresas/${empresaId}/taxas/ajustes`)).send(body);
const linha = (res, alvo) => res.body.data.items.find((i) => i.empresa_id === alvo.empresaId);

let vendasA = {};

beforeAll(async () => {
    operador = await criarOperadorComSessao('cobranca');
    politica = (await db.query('SELECT id, plano_id FROM politicas_taxa_plataforma ORDER BY id LIMIT 1')).rows[0];
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    await criarEmpresa(C, 'C');

    // A, março/2025: R$ 15,00 × 0,50% = 0,075 -> 0,08 por venda (arredondamento por venda, SPEC §3).
    // Três vendas: uma manual (0,08), uma Pix MP com 0,08 retido, uma manual de 40,00 (0,20). Devido 0,36; retido 0,08.
    vendasA.manual = await criarVendaComTaxa(A, '2025-03-10T15:00:00Z', { base: 15, valor: 0.08 });
    vendasA.mp = await criarVendaComTaxa(A, '2025-03-11T15:00:00Z', { base: 15, valor: 0.08, retido: 0.08 });
    vendasA.grande = await criarVendaComTaxa(A, '2025-03-12T15:00:00Z', { base: 40, valor: 0.20 });

    // B, março/2025: tudo retido no Mercado Pago -> fecha já pago.
    await criarVendaComTaxa(B, '2025-03-15T15:00:00Z', { base: 100, valor: 0.50, retido: 0.50 });

    // C, maio/2025: R$ 4.000 de Pix manual -> 20,00 devido (para pagamentos/perdão).
    await criarVendaComTaxa(C, '2025-05-10T15:00:00Z', { base: 4000, valor: 20 });
});

// plataforma_eventos não tem empresa_id (aponta para a empresa em alvo_empresa_id) e o estorno de venda não tem
// operador: a trilha das empresas de teste sai aqui, com o bypass de limpeza de teste, antes das empresas.
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

afterAll(async () => {
    try {
        // Trilha e empresas antes do operador: lançamentos e fechamentos referenciam o operador.
        await removerTrilhaDasEmpresas(registro.ids());
        await registro.limpar();
        await removerOperador(operador);
    } finally {
        await db.end();
    }
});

describe('acesso', () => {
    test('sem sessão do painel ou com token do ERP: recusado', async () => {
        const tokenErp = makeToken({ id: A.adminId, empresa_id: A.empresaId, papel: 'admin' });

        for (const req of [
            request(app).get('/painel/taxas/cobranca?competencia=2025-03'),
            request(app).get('/painel/taxas/cobranca?competencia=2025-03').set('Authorization', `Bearer ${tokenErp}`),
            request(app).post('/painel/taxas/periodos/fechar').set('Authorization', `Bearer ${tokenErp}`).send({ competencia: '2025-03' }),
            request(app).post(`/painel/empresas/${A.empresaId}/taxas/ajustes`).set('Authorization', `Bearer ${tokenErp}`)
                .send({ valor: 1, justificativa: 'tentativa do ERP' })
        ]) {
            expect((await req).status).toBe(401);
        }
    });
});

describe('fechamento', () => {
    test('mês corrente (ou futuro) não fecha', async () => {
        const res = await fechar({ competencia: MES_CORRENTE, empresa_id: A.empresaId });
        expect(res.status).toBe(409);
    });

    test('entrada inválida: 400', async () => {
        expect((await fechar({ competencia: '2025-3', empresa_id: A.empresaId })).status).toBe(400);
        expect((await fechar({ competencia: '2025-03', empresa_id: A.empresaId, extra: 1 })).status).toBe(400);
    });

    test('antes de fechar, o mês aparece aberto com valores vivos', async () => {
        const res = await resumo({ competencia: '2025-03', empresa_id: A.empresaId });
        expect(res.status).toBe(200);
        expect(linha(res, A)).toMatchObject({ status: 'aberto', periodo_id: null, devido: 0.36, retido_mp: 0.08, saldo: 0.28, a_receber: 0.28 });
    });

    test('fecha: congela devido (soma por venda) e retido, vence dia 05 do mês seguinte, grava a trilha', async () => {
        const res = await fechar({ competencia: '2025-03', empresa_id: A.empresaId });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ fechados: 1, ja_fechados: 0 });

        const periodoId = res.body.data.items[0].periodo_id;
        A.marco = periodoId;

        const d = (await detalhe(periodoId)).body.data;
        expect(d.periodo).toMatchObject({
            competencia: '2025-03', status: 'fechado', vencimento: '2025-04-05',
            devido: 0.36, retido_mp: 0.08, saldo: 0.28, fechado_por: `painel:${operador.email} (#${operador.id})`
        });

        const { rows } = await db.query(
            `SELECT acao, operador_id, detalhe FROM plataforma_eventos WHERE alvo_empresa_id = $1 AND acao = 'taxa_periodo_fechado'`,
            [A.empresaId]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].operador_id).toBe(operador.id);
        expect(rows[0].detalhe).toMatchObject({ periodo_id: periodoId, competencia: '2025-03', status: 'fechado' });
    });

    test('fechar de novo é seguro: só informa que já estava fechado', async () => {
        const res = await fechar({ competencia: '2025-03', empresa_id: A.empresaId });
        expect(res.body.data).toMatchObject({ fechados: 0, ja_fechados: 1 });
    });

    test('tudo retido no Mercado Pago: fecha já como pago (saldo zero)', async () => {
        const res = await fechar({ competencia: '2025-03', empresa_id: B.empresaId });
        expect(res.body.data.items[0]).toMatchObject({ status: 'pago', saldo: 0 });
    });

    test('empresa inexistente: 404', async () => {
        expect((await fechar({ competencia: '2025-03', empresa_id: 999999999 })).status).toBe(404);
    });
});

describe('pagamento e perdão', () => {
    beforeAll(async () => {
        const res = await fechar({ competencia: '2025-05', empresa_id: C.empresaId });
        C.maio = res.body.data.items[0].periodo_id;
    });

    test('período aberto não recebe pagamento', async () => {
        const aberto = await ajustar(C.empresaId, { valor: 1, justificativa: 'abre o período corrente' });
        expect(aberto.status).toBe(201);
        const res = await pagar(aberto.body.data.periodo.id, { valor: 1, data_pagamento: hojeSP(), forma_pagamento: 'pix' });
        expect(res.status).toBe(409);
    });

    test('validação: forma fora da lista, data futura, valor com 3 casas, campo extra', async () => {
        const base = { valor: 1, data_pagamento: hojeSP(), forma_pagamento: 'pix' };
        expect((await pagar(C.maio, { ...base, forma_pagamento: 'cheque' })).status).toBe(400);
        expect((await pagar(C.maio, { ...base, data_pagamento: '2999-01-01' })).status).toBe(400);
        expect((await pagar(C.maio, { ...base, valor: 1.001 })).status).toBe(400);
        expect((await pagar(C.maio, { ...base, responsavel: 'forjado' })).status).toBe(400);
    });

    test('parcial -> parcialmente_pago; excedente recusado; restante -> pago', async () => {
        const parcial = await pagar(C.maio, { valor: 12.5, data_pagamento: hojeSP(), forma_pagamento: 'transferencia' });
        expect(parcial.status).toBe(201);
        expect(parcial.body.data.periodo).toMatchObject({ status: 'parcialmente_pago', saldo: 7.5 });

        const excedente = await pagar(C.maio, { valor: 7.51, data_pagamento: hojeSP(), forma_pagamento: 'pix' });
        expect(excedente.status).toBe(409);
        expect(excedente.body.message).toMatch(/maior que o saldo do período \(R\$ 7,50\)/);

        const perdao = await perdoar(C.maio, { valor: 2.5, justificativa: 'desconto negociado no piloto' });
        expect(perdao.status).toBe(201);
        expect(perdao.body.data.periodo).toMatchObject({ status: 'parcialmente_pago', saldo: 5 });

        const resto = await pagar(C.maio, { valor: 5, data_pagamento: hojeSP(), forma_pagamento: 'boleto' });
        expect(resto.body.data.periodo).toMatchObject({ status: 'pago', saldo: 0 });

        const semSaldo = await pagar(C.maio, { valor: 0.01, data_pagamento: hojeSP(), forma_pagamento: 'pix' });
        expect(semSaldo.status).toBe(409);
    });

    test('lançamentos com responsável da sessão e trilha de cada um', async () => {
        const { lancamentos } = (await detalhe(C.maio)).body.data;
        expect(lancamentos.map((l) => [l.tipo, l.valor])).toEqual([['pagamento', -12.5], ['perdao', -2.5], ['pagamento', -5]]);
        expect(lancamentos.every((l) => l.responsavel === `painel:${operador.email} (#${operador.id})`)).toBe(true);

        const { rows } = await db.query(
            `SELECT acao FROM plataforma_eventos WHERE alvo_empresa_id = $1 AND acao IN ('taxa_pagamento_registrado', 'taxa_perdao_registrado') ORDER BY id`,
            [C.empresaId]
        );
        expect(rows.map((r) => r.acao)).toEqual(['taxa_pagamento_registrado', 'taxa_perdao_registrado', 'taxa_pagamento_registrado']);
    });

    test('perdão sem justificativa: 400', async () => {
        expect((await perdoar(C.maio, { valor: 1 })).status).toBe(400);
    });

    test('mesma chave de idempotência: não duplica; chave reaproveitada em outro pedido: 409', async () => {
        await criarVendaComTaxa(C, '2025-06-10T15:00:00Z', { base: 2000, valor: 10 });
        const periodo = (await fechar({ competencia: '2025-06', empresa_id: C.empresaId })).body.data.items[0].periodo_id;

        const corpo = { valor: 4, data_pagamento: hojeSP(), forma_pagamento: 'pix', chave_idempotencia: chave('pg-junho') };
        const primeiro = await pagar(periodo, corpo);
        const repetido = await pagar(periodo, corpo);
        expect(primeiro.body.data.repetido).toBe(false);
        expect(repetido.body.data).toMatchObject({ repetido: true, lancamento_id: primeiro.body.data.lancamento_id });
        expect(repetido.body.data.periodo.saldo).toBe(6);

        expect((await pagar(periodo, { ...corpo, valor: 3 })).status).toBe(409);
    });

    test('período inexistente: 404', async () => {
        expect((await pagar(999999999, { valor: 1, data_pagamento: hojeSP(), forma_pagamento: 'pix' })).status).toBe(404);
    });
});

describe('ajuste', () => {
    test('vai para o período aberto do mês corrente, com sinal', async () => {
        const res = await ajustar(A.empresaId, { valor: -0.05, justificativa: 'divergência conferida com o MP' });
        expect(res.status).toBe(201);
        expect(res.body.data.periodo).toMatchObject({ competencia: MES_CORRENTE, status: 'aberto' });
        expect(res.body.data.lancamentos.at(-1)).toMatchObject({ tipo: 'ajuste', valor: -0.05 });
    });

    test('ligado a venda da própria empresa: aceito; venda de outra empresa: 404; empresa inexistente: 404; zero: 400', async () => {
        expect((await ajustar(A.empresaId, { valor: 1, justificativa: 'correção da venda de março', venda_id: vendasA.grande }))
            .status).toBe(201);
        const vendaDeB = (await db.query('SELECT id FROM vendas WHERE empresa_id = $1 LIMIT 1', [B.empresaId])).rows[0].id;
        expect((await ajustar(A.empresaId, { valor: 1, justificativa: 'venda alheia', venda_id: vendaDeB })).status).toBe(404);
        expect((await ajustar(999999999, { valor: 1, justificativa: 'empresa inexistente' })).status).toBe(404);
        expect((await ajustar(A.empresaId, { valor: 0, justificativa: 'sem efeito' })).status).toBe(400);
    });
});

describe('cancelamento de venda depois do fechamento (T2/T3)', () => {
    const cancelar = (alvo, vendaId) => vendasRepository.cancelar(vendaId, alvo.adminId, alvo.empresaId, {
        motivo: 'teste de estorno da taxa',
        login: 'admin-teste',
        faixaAutorizada: 'acima_30_dias',
        autorizador: { id: alvo.adminId, login: 'admin-teste' }
    });

    async function estornosDe(vendaId) {
        const { rows } = await db.query(
            `SELECT l.valor, to_char(p.competencia, 'YYYY-MM') AS competencia, l.responsavel
             FROM lancamentos_taxa l JOIN periodos_taxa p ON p.id = l.periodo_id
             WHERE l.venda_id = $1 AND l.tipo = 'estorno_venda'`,
            [vendaId]
        );
        return rows;
    }

    test('venda manual: estorno da taxa inteira no período aberto corrente; o fechado não muda', async () => {
        await cancelar(A, vendasA.manual);

        expect(await estornosDe(vendasA.manual)).toEqual([
            { valor: '-0.08', competencia: MES_CORRENTE, responsavel: `sistema: cancelamento da venda #${vendasA.manual} por admin-teste` }
        ]);

        const marco = (await detalhe(A.marco)).body.data.periodo;
        expect(marco).toMatchObject({ status: 'fechado', devido: 0.36, retido_mp: 0.08, saldo: 0.28 });

        const { rows } = await db.query(
            `SELECT detalhe FROM plataforma_eventos WHERE alvo_empresa_id = $1 AND acao = 'taxa_estorno_venda'`, [A.empresaId]);
        expect(rows[0].detalhe).toMatchObject({ venda_id: vendasA.manual, competencia_venda: '2025-03', valor: -0.08 });
    });

    test('venda Pix MP com a taxa toda retida: nada a estornar (o retido nunca entrou no saldo)', async () => {
        await cancelar(A, vendasA.mp);
        expect(await estornosDe(vendasA.mp)).toEqual([]);
    });

    test('venda de mês ainda aberto: nenhum lançamento (o fechamento já não soma a taxa estornada)', async () => {
        const abril = await criarVendaComTaxa(A, '2025-04-10T15:00:00Z', { base: 100, valor: 0.5 });
        await cancelar(A, abril);
        expect(await estornosDe(abril)).toEqual([]);

        const res = await fechar({ competencia: '2025-04', empresa_id: A.empresaId });
        expect(res.body.data.items[0]).toMatchObject({ status: 'pago', saldo: 0 });
    });

    test('cancelamento concorrente com o fechamento: nunca perde nem duplica o estorno', async () => {
        for (let i = 0; i < 5; i += 1) {
            const competencia = `2024-0${i + 1}`;
            const cancelada = await criarVendaComTaxa(A, `${competencia}-10T15:00:00Z`, { base: 100, valor: 0.5 });
            await criarVendaComTaxa(A, `${competencia}-11T15:00:00Z`, { base: 40, valor: 0.2 });

            const [fechamento] = await Promise.all([
                fechar({ competencia, empresa_id: A.empresaId }),
                cancelar(A, cancelada)
            ]);
            expect(fechamento.status).toBe(200);

            const { periodo } = (await detalhe(fechamento.body.data.items[0].periodo_id)).body.data;
            const estornos = await estornosDe(cancelada);

            // Fechou antes do cancelamento: a taxa entrou no total e voltou como estorno no mês corrente.
            // Cancelou antes do fechamento: a taxa ficou fora do total e não há estorno.
            const coerente = (periodo.devido === 0.7 && estornos.length === 1 && estornos[0].valor === '-0.50')
                || (periodo.devido === 0.2 && estornos.length === 0);
            expect({ devido: periodo.devido, estornos: estornos.length, coerente }).toMatchObject({ coerente: true });
        }
    });

    test('resumo do mês corrente reflete ajustes e estornos', async () => {
        const res = await resumo({ competencia: MES_CORRENTE, empresa_id: A.empresaId });
        const corrente = linha(res, A);
        expect(corrente).toMatchObject({ status: 'aberto', ajustes: 0.95 });
        // 0,08 da venda manual de março + 0,50 de cada corrida em que o fechamento venceu o cancelamento.
        expect(Math.round((corrente.estornos - 0.08) * 100) % 50).toBe(0);
    });
});

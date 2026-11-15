// Comportamento da migration 114 no banco de testes (TEST_DATABASE_URL validada pelo globalSetup):
// gatilhos e restrições de periodos_taxa / lancamentos_taxa. Empresas de teste são removidas no fim.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const sufixo = crypto.randomBytes(4).toString('hex');
const registro = criarRegistroDeEmpresas(db);

const RESPONSAVEL = 'painel:teste@teste.invalid (#0)';

let empresaA;
let empresaB;
let vendaA;
let vendaB;

async function criarEmpresa(rotulo) {
    const { rows } = await db.query('INSERT INTO empresas (nome) VALUES ($1) RETURNING id', [`Teste taxa 114 ${rotulo} ${sufixo}`]);
    return registro.registrar(rows[0].id);
}

async function criarVenda(empresaId) {
    const canal = await db.query(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'Loja') RETURNING id`, [empresaId]);
    const venda = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, status, total) VALUES ($1, $2, 'finalizada', 15) RETURNING id`,
        [empresaId, canal.rows[0].id]
    );
    return venda.rows[0].id;
}

async function criarPeriodo(empresaId, competencia) {
    const { rows } = await db.query(
        'INSERT INTO periodos_taxa (empresa_id, competencia) VALUES ($1, $2) RETURNING *',
        [empresaId, competencia]
    );
    return rows[0];
}

// Fecha com totais congelados: devido = calculado - retido.
async function fechar(periodoId, calculado, retido) {
    const { rows } = await db.query(
        `UPDATE periodos_taxa
            SET status = 'fechado', total_calculado = $2, total_retido_mp = $3,
                vencimento = (competencia + INTERVAL '1 month' + INTERVAL '4 days')::date,
                fechado_em = NOW(), fechado_por = $4
          WHERE id = $1 RETURNING *`,
        [periodoId, calculado, retido, RESPONSAVEL]
    );
    return rows[0];
}

async function lancar(campos) {
    const c = { empresa_id: empresaA, responsavel: RESPONSAVEL, ...campos };
    const { rows } = await db.query(
        `INSERT INTO lancamentos_taxa
            (empresa_id, periodo_id, tipo, valor, venda_id, data_pagamento, forma_pagamento, comprovante,
             justificativa, responsavel, chave_idempotencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [c.empresa_id, c.periodo_id, c.tipo, c.valor, c.venda_id ?? null, c.data_pagamento ?? null,
            c.forma_pagamento ?? null, c.comprovante ?? null, c.justificativa ?? null, c.responsavel,
            c.chave_idempotencia ?? null]
    );
    return rows[0];
}

const pagamento = (periodo_id, valor, extra = {}) =>
    lancar({ periodo_id, tipo: 'pagamento', valor, data_pagamento: '2026-11-05', forma_pagamento: 'pix', ...extra });

beforeAll(async () => {
    empresaA = await criarEmpresa('A');
    empresaB = await criarEmpresa('B');
    vendaA = await criarVenda(empresaA);
    vendaB = await criarVenda(empresaB);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('periodos_taxa', () => {
    test('competência é sempre o dia 1 e única por empresa', async () => {
        await expect(criarPeriodo(empresaA, '2026-01-15')).rejects.toMatchObject({ code: '23514' });
        await criarPeriodo(empresaA, '2026-01-01');
        await expect(criarPeriodo(empresaA, '2026-01-01')).rejects.toMatchObject({ code: '23505' });
    });

    test('fechar exige totais, vencimento e responsável', async () => {
        const p = await criarPeriodo(empresaA, '2026-02-01');
        await expect(db.query(`UPDATE periodos_taxa SET status = 'fechado' WHERE id = $1`, [p.id]))
            .rejects.toMatchObject({ code: '23514' });

        const fechado = await fechar(p.id, '3.20', '1.10');
        expect(fechado.status).toBe('fechado');
        expect(fechado.total_calculado).toBe('3.20');
        expect(fechado.vencimento).toBeTruthy();
    });

    test('aberto não pula para pago', async () => {
        const p = await criarPeriodo(empresaA, '2026-03-01');
        await expect(db.query(`UPDATE periodos_taxa SET status = 'pago' WHERE id = $1`, [p.id]))
            .rejects.toThrow(/só pode ser fechado/);
    });

    test('fechado é imutável (T2): não reabre, não muda totais nem empresa/competência, não é apagado', async () => {
        const p = await fechar((await criarPeriodo(empresaA, '2026-04-01')).id, '5.00', '0.00');

        await expect(db.query(`UPDATE periodos_taxa SET total_calculado = 9 WHERE id = $1`, [p.id]))
            .rejects.toThrow(/imutável/);
        await expect(db.query(`UPDATE periodos_taxa SET status = 'aberto', total_calculado = NULL, total_retido_mp = NULL,
                vencimento = NULL, fechado_em = NULL, fechado_por = NULL WHERE id = $1`, [p.id]))
            .rejects.toThrow(/imutável/);
        await expect(db.query(`UPDATE periodos_taxa SET competencia = '2026-05-01' WHERE id = $1`, [p.id]))
            .rejects.toThrow(/imutáveis/);
        await expect(db.query('DELETE FROM periodos_taxa WHERE id = $1', [p.id]))
            .rejects.toThrow(/não pode ser apagado/);
    });

    test('status só avança: fechado -> parcialmente_pago -> pago, nunca volta', async () => {
        const p = await fechar((await criarPeriodo(empresaA, '2026-05-01')).id, '5.00', '0.00');
        await db.query(`UPDATE periodos_taxa SET status = 'parcialmente_pago' WHERE id = $1`, [p.id]);
        await db.query(`UPDATE periodos_taxa SET status = 'pago' WHERE id = $1`, [p.id]);
        await expect(db.query(`UPDATE periodos_taxa SET status = 'parcialmente_pago' WHERE id = $1`, [p.id]))
            .rejects.toThrow(/não volta/);
    });
});

describe('lancamentos_taxa', () => {
    let aberto;
    let fechado;

    beforeAll(async () => {
        fechado = await fechar((await criarPeriodo(empresaA, '2026-09-01')).id, '20.00', '5.00'); // saldo 15,00
        aberto = await criarPeriodo(empresaA, '2026-10-01');
    });

    test('pagamento parcial aceito; excedente ao saldo recusado (T4)', async () => {
        await pagamento(fechado.id, '-10.00');
        await expect(pagamento(fechado.id, '-5.01')).rejects.toThrow(/maior que o saldo/);
        await pagamento(fechado.id, '-5.00');
        await expect(pagamento(fechado.id, '-0.01')).rejects.toThrow(/maior que o saldo/);
    });

    test('pagamento exige data e forma; não aceita valor positivo nem período aberto', async () => {
        await expect(lancar({ periodo_id: fechado.id, tipo: 'pagamento', valor: '-1.00' })).rejects.toMatchObject({ code: '23514' });
        await expect(pagamento(fechado.id, '1.00')).rejects.toMatchObject({ code: '23514' });
        await expect(pagamento(aberto.id, '-1.00')).rejects.toThrow(/só em período fechado/);
    });

    test('perdão exige justificativa (T5) e respeita o saldo', async () => {
        const p = await fechar((await criarPeriodo(empresaA, '2026-08-01')).id, '2.00', '0.00');
        await expect(lancar({ periodo_id: p.id, tipo: 'perdao', valor: '-1.00' })).rejects.toMatchObject({ code: '23514' });
        await lancar({ periodo_id: p.id, tipo: 'perdao', valor: '-2.00', justificativa: 'cliente piloto' });
        await expect(lancar({ periodo_id: p.id, tipo: 'perdao', valor: '-0.01', justificativa: 'cliente piloto' }))
            .rejects.toThrow(/maior que o saldo/);
    });

    test('ajuste e estorno só no período aberto: fechado vira ajuste no seguinte (T2/T3)', async () => {
        await expect(lancar({ periodo_id: fechado.id, tipo: 'ajuste', valor: '1.00', justificativa: 'divergência MP' }))
            .rejects.toThrow(/só em período aberto/);
        await expect(lancar({ periodo_id: fechado.id, tipo: 'estorno_venda', valor: '-0.08', venda_id: vendaA }))
            .rejects.toThrow(/só em período aberto/);

        await lancar({ periodo_id: aberto.id, tipo: 'ajuste', valor: '-0.50', justificativa: 'divergência MP' });
        await lancar({ periodo_id: aberto.id, tipo: 'estorno_venda', valor: '-0.08', venda_id: vendaA });
    });

    test('ajuste nunca zero; estorno exige venda e é único por venda', async () => {
        await expect(lancar({ periodo_id: aberto.id, tipo: 'ajuste', valor: '0', justificativa: 'sem efeito' }))
            .rejects.toMatchObject({ code: '23514' });
        await expect(lancar({ periodo_id: aberto.id, tipo: 'estorno_venda', valor: '-0.08' }))
            .rejects.toMatchObject({ code: '23514' });
        // A venda A já foi estornada no teste anterior.
        await expect(lancar({ periodo_id: aberto.id, tipo: 'estorno_venda', valor: '-0.08', venda_id: vendaA }))
            .rejects.toMatchObject({ code: '23505' });
    });

    test('isolamento: período ou venda de outra empresa recusados pelo banco', async () => {
        await expect(lancar({ empresa_id: empresaB, periodo_id: aberto.id, tipo: 'ajuste', valor: '1.00', justificativa: 'outra empresa' }))
            .rejects.toMatchObject({ code: '23503' });
        await expect(lancar({ periodo_id: aberto.id, tipo: 'ajuste', valor: '1.00', justificativa: 'venda alheia', venda_id: vendaB }))
            .rejects.toMatchObject({ code: '23503' });
    });

    test('mesma chave de idempotência não duplica', async () => {
        const p = await fechar((await criarPeriodo(empresaA, '2026-07-01')).id, '9.00', '0.00');
        await pagamento(p.id, '-1.00', { chave_idempotencia: `pg-${sufixo}` });
        await expect(pagamento(p.id, '-1.00', { chave_idempotencia: `pg-${sufixo}` })).rejects.toMatchObject({ code: '23505' });
    });

    test('responsável obrigatório', async () => {
        await expect(lancar({ periodo_id: aberto.id, tipo: 'ajuste', valor: '1.00', justificativa: 'sem autor', responsavel: '  ' }))
            .rejects.toMatchObject({ code: '23514' });
    });

    test('UPDATE e DELETE em lançamentos recusados (só-inserção)', async () => {
        const { rows } = await db.query('SELECT id FROM lancamentos_taxa WHERE periodo_id = $1 LIMIT 1', [fechado.id]);
        await expect(db.query('UPDATE lancamentos_taxa SET valor = -1 WHERE id = $1', [rows[0].id])).rejects.toThrow(/só-inserção/);
        await expect(db.query('DELETE FROM lancamentos_taxa WHERE id = $1', [rows[0].id])).rejects.toThrow(/só-inserção/);
    });

    test('pagamentos concorrentes não ultrapassam o saldo (período travado)', async () => {
        const p = await fechar((await criarPeriodo(empresaA, '2026-06-01')).id, '10.00', '0.00');
        const resultados = await Promise.allSettled([pagamento(p.id, '-6.00'), pagamento(p.id, '-6.00')]);
        expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

        const { rows } = await db.query('SELECT SUM(valor) AS soma FROM lancamentos_taxa WHERE periodo_id = $1', [p.id]);
        expect(rows[0].soma).toBe('-6.00');
    });
});

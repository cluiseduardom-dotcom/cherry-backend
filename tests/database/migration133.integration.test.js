// Comportamento da migration 133 no banco de testes (TEST_DATABASE_URL validada pelo globalSetup):
// o BANCO impõe as regras do caixa (uma sessão aberta por caixa, isolamento entre empresas, imutabilidade).
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const sufixo = crypto.randomBytes(4).toString('hex');
const registro = criarRegistroDeEmpresas(db);

const E1 = {};
const E2 = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, cnpj, status) VALUES ($1, NULL, 'ativa') RETURNING id`, [`Empresa Teste Caixa ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.usuario = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'u', $2, 'x', 'admin') RETURNING id`,
        [alvo.empresaId, `caixa-${rotulo}-${sufixo}@teste.invalid`]
    )).rows[0].id;
    alvo.caixa = (await db.query(
        `INSERT INTO caixas (empresa_id, nome, criado_por) VALUES ($1, 'Balcão 1', $2) RETURNING id`, [alvo.empresaId, alvo.usuario]
    )).rows[0].id;
}

const abrirSessao = (alvo, caixa = alvo.caixa, saldo = 100) => db.query(
    `INSERT INTO caixa_sessoes (empresa_id, caixa_id, operador_id, saldo_inicial) VALUES ($1, $2, $3, $4) RETURNING id`,
    [alvo.empresaId, caixa, alvo.usuario, saldo]
);

const fecharSessao = (alvo, sessaoId) => db.query(
    `UPDATE caixa_sessoes SET status = 'fechada', fechada_em = NOW(), fechada_por = $3 WHERE id = $1 AND empresa_id = $2`,
    [sessaoId, alvo.empresaId, alvo.usuario]
);

const movimento = (alvo, sessaoId, tipo = 'sangria', valor = 10) => db.query(
    `INSERT INTO caixa_movimentos (empresa_id, sessao_id, tipo, valor, motivo, usuario_id) VALUES ($1, $2, $3, $4, 'motivo teste', $5) RETURNING id`,
    [alvo.empresaId, sessaoId, tipo, valor, alvo.usuario]
);

beforeAll(async () => {
    await criarEmpresa(E1, '1');
    await criarEmpresa(E2, '2');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 133 — o banco impõe as regras do caixa', () => {
    test('a funcionalidade `caixa` existe, é vendável e não está em nenhum plano', async () => {
        const f = (await db.query(`SELECT tipo, vendavel FROM funcionalidades WHERE codigo = 'caixa'`)).rows[0];
        const emPlano = (await db.query(`SELECT count(*)::int AS n FROM plano_funcionalidades WHERE funcionalidade = 'caixa'`)).rows[0].n;

        expect(f).toEqual({ tipo: 'modulo', vendavel: true });
        expect(emPlano).toBe(0);
    });

    test('nome do caixa é único por empresa (sem diferenciar maiúscula) e pode repetir entre empresas', async () => {
        await expect(db.query(`INSERT INTO caixas (empresa_id, nome, criado_por) VALUES ($1, ' balcão 1 ', $2)`, [E1.empresaId, E1.usuario]))
            .rejects.toMatchObject({ code: '23505' });
        expect((await db.query(`SELECT count(*)::int AS n FROM caixas WHERE empresa_id = $1`, [E2.empresaId])).rows[0].n).toBe(1);
    });

    test('caixa com usuário de outra empresa é recusado (FK composta)', async () => {
        await expect(db.query(`INSERT INTO caixas (empresa_id, nome, criado_por) VALUES ($1, 'Balcão 2', $2)`, [E1.empresaId, E2.usuario]))
            .rejects.toMatchObject({ code: '23503' });
    });

    test('só uma sessão aberta por caixa, mesmo em aberturas simultâneas', async () => {
        const resultados = await Promise.allSettled([abrirSessao(E1), abrirSessao(E1), abrirSessao(E1)]);
        const ok = resultados.filter((r) => r.status === 'fulfilled');
        const falhas = resultados.filter((r) => r.status === 'rejected');

        expect(ok).toHaveLength(1);
        expect(falhas).toHaveLength(2);
        falhas.forEach((f) => expect(f.reason.code).toBe('23505'));

        await fecharSessao(E1, ok[0].value.rows[0].id);
        await expect(abrirSessao(E1)).resolves.toBeTruthy();
    });

    test('sessão de um caixa de outra empresa é recusada (FK composta)', async () => {
        // Operador novo, sem sessão aberta: isola a FK do caixa (a migration 134 recusa um segundo caixa aberto por operador).
        const operador = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'u2', $2, 'x', 'admin') RETURNING id`,
            [E1.empresaId, `caixa-fk-${sufixo}@teste.invalid`]
        )).rows[0].id;

        await expect(db.query(
            `INSERT INTO caixa_sessoes (empresa_id, caixa_id, operador_id, saldo_inicial) VALUES ($1, $2, $3, 0)`, [E1.empresaId, E2.caixa, operador]
        )).rejects.toMatchObject({ code: '23503' });
    });

    test('saldo inicial negativo e fechamento incoerente são recusados', async () => {
        await expect(abrirSessao(E2, E2.caixa, -1)).rejects.toMatchObject({ code: '23514' });
        const sessao = (await db.query(`SELECT id FROM caixa_sessoes WHERE empresa_id = $1 AND status = 'aberta'`, [E1.empresaId])).rows[0].id;
        await expect(db.query(`UPDATE caixa_sessoes SET status = 'fechada' WHERE id = $1`, [sessao])).rejects.toMatchObject({ code: '23514' });
    });

    test('movimento só entra em sessão aberta, com valor positivo e motivo; a abertura não pode ser alterada', async () => {
        const sessao = (await db.query(`SELECT id FROM caixa_sessoes WHERE empresa_id = $1 AND status = 'aberta'`, [E1.empresaId])).rows[0].id;

        await expect(movimento(E1, sessao, 'suprimento', 50)).resolves.toBeTruthy();
        await expect(movimento(E1, sessao, 'sangria', 0)).rejects.toMatchObject({ code: '23514' });
        await expect(movimento(E1, sessao, 'troca', 5)).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(
            `INSERT INTO caixa_movimentos (empresa_id, sessao_id, tipo, valor, motivo, usuario_id) VALUES ($1, $2, 'sangria', 5, ' ', $3)`,
            [E1.empresaId, sessao, E1.usuario]
        )).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(`UPDATE caixa_sessoes SET saldo_inicial = 999 WHERE id = $1`, [sessao])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query(`UPDATE caixa_sessoes SET operador_id = $2 WHERE id = $1`, [sessao, E1.usuario])).resolves.toBeTruthy();
    });

    test('movimento com sessão de outra empresa é recusado', async () => {
        const sessaoE2 = (await abrirSessao(E2)).rows[0].id;

        await expect(db.query(
            `INSERT INTO caixa_movimentos (empresa_id, sessao_id, tipo, valor, motivo, usuario_id) VALUES ($1, $2, 'sangria', 5, 'motivo teste', $3)`,
            [E1.empresaId, sessaoE2, E1.usuario]
        )).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23514)$/) });
    });

    test('fechamento: conferência por forma (diferença calculada), e depois nada mais entra nem muda', async () => {
        const sessao = (await db.query(`SELECT id FROM caixa_sessoes WHERE empresa_id = $1 AND status = 'aberta'`, [E1.empresaId])).rows[0].id;

        await db.query(`INSERT INTO caixa_conferencias (empresa_id, sessao_id, forma, esperado, informado) VALUES ($1, $2, 'dinheiro', 150, 148.5)`, [E1.empresaId, sessao]);
        await expect(db.query(`INSERT INTO caixa_conferencias (empresa_id, sessao_id, forma, esperado, informado) VALUES ($1, $2, 'dinheiro', 1, 1)`, [E1.empresaId, sessao]))
            .rejects.toMatchObject({ code: '23505' });
        await fecharSessao(E1, sessao);

        const conf = (await db.query(`SELECT diferenca FROM caixa_conferencias WHERE sessao_id = $1`, [sessao])).rows[0];
        expect(Number(conf.diferenca)).toBe(-1.5);

        await expect(fecharSessao(E1, sessao)).rejects.toMatchObject({ code: '23001' });
        await expect(movimento(E1, sessao)).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(`INSERT INTO caixa_conferencias (empresa_id, sessao_id, forma, esperado, informado) VALUES ($1, $2, 'pix', 1, 1)`, [E1.empresaId, sessao]))
            .rejects.toMatchObject({ code: '23514' });
        await expect(db.query(`DELETE FROM caixa_sessoes WHERE id = $1`, [sessao])).rejects.toMatchObject({ code: '23001' });
    });

    test('movimentos e conferências são insere-só (UPDATE e DELETE recusados)', async () => {
        const sessao = (await abrirSessao(E2, E2.caixa, 0).catch(() => null));
        const id = sessao ? sessao.rows[0].id : (await db.query(`SELECT id FROM caixa_sessoes WHERE empresa_id = $1 AND status = 'aberta'`, [E2.empresaId])).rows[0].id;
        const m = (await movimento(E2, id)).rows[0].id;

        await expect(db.query(`UPDATE caixa_movimentos SET valor = 1 WHERE id = $1`, [m])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query(`DELETE FROM caixa_movimentos WHERE id = $1`, [m])).rejects.toMatchObject({ code: '23001' });
    });
});

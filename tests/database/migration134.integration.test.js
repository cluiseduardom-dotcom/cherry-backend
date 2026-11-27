// Comportamento da migration 134 no banco de testes: o BANCO impõe a chave única por empresa e uma sessão aberta por operador.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const sufixo = crypto.randomBytes(4).toString('hex');
const registro = criarRegistroDeEmpresas(db);
const E1 = {};
const E2 = {};

async function criarEmpresa(alvo, rotulo) {
    alvo.empresaId = registro.registrar((await db.query(`INSERT INTO empresas (nome, cnpj, status) VALUES ($1, NULL, 'ativa') RETURNING id`, [`Empresa Teste Caixa134 ${rotulo} ${sufixo}`])).rows[0].id);
    alvo.usuario = (await db.query(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'u', $2, 'x', 'admin') RETURNING id`, [alvo.empresaId, `c134-${rotulo}-${sufixo}@teste.invalid`])).rows[0].id;
    alvo.caixa1 = (await db.query(`INSERT INTO caixas (empresa_id, nome, criado_por) VALUES ($1, 'Balcão 1', $2) RETURNING id`, [alvo.empresaId, alvo.usuario])).rows[0].id;
    alvo.caixa2 = (await db.query(`INSERT INTO caixas (empresa_id, nome, criado_por) VALUES ($1, 'Balcão 2', $2) RETURNING id`, [alvo.empresaId, alvo.usuario])).rows[0].id;
}

const abrir = (alvo, caixa) => db.query(`INSERT INTO caixa_sessoes (empresa_id, caixa_id, operador_id, saldo_inicial) VALUES ($1, $2, $3, 0) RETURNING id`, [alvo.empresaId, caixa, alvo.usuario]);
const mov = (alvo, sessao, chave) => db.query(
    `INSERT INTO caixa_movimentos (empresa_id, sessao_id, tipo, valor, motivo, usuario_id, chave_idempotencia) VALUES ($1, $2, 'suprimento', 5, 'motivo teste', $3, $4)`,
    [alvo.empresaId, sessao, alvo.usuario, chave]
);

beforeAll(async () => { await criarEmpresa(E1, '1'); await criarEmpresa(E2, '2'); });
afterAll(async () => { try { await registro.limpar(); } finally { await db.end(); } });

describe('migration 134 — o banco impõe', () => {
    test('o mesmo operador não abre dois caixas ao mesmo tempo (nem em corrida); depois de fechar, abre outro', async () => {
        const r = await Promise.allSettled([abrir(E1, E1.caixa1), abrir(E1, E1.caixa2)]);
        const ok = r.filter((x) => x.status === 'fulfilled');

        expect(ok).toHaveLength(1);
        expect(r.find((x) => x.status === 'rejected').reason.code).toBe('23505');

        await db.query(`UPDATE caixa_sessoes SET status = 'fechada', fechada_em = NOW(), fechada_por = $2 WHERE id = $1`, [ok[0].value.rows[0].id, E1.usuario]);
        await expect(abrir(E1, E1.caixa2)).resolves.toBeTruthy();
    });

    test('chave de idempotência: única por empresa quando preenchida, livre quando ausente e repetível entre empresas', async () => {
        const sessaoE1 = (await db.query(`SELECT id FROM caixa_sessoes WHERE empresa_id = $1 AND status = 'aberta'`, [E1.empresaId])).rows[0].id;
        const sessaoE2 = (await abrir(E2, E2.caixa1)).rows[0].id;

        await expect(mov(E1, sessaoE1, 'chave-igual-1')).resolves.toBeTruthy();
        await expect(mov(E1, sessaoE1, 'chave-igual-1')).rejects.toMatchObject({ code: '23505' });
        await expect(mov(E1, sessaoE1, null)).resolves.toBeTruthy();
        await expect(mov(E1, sessaoE1, null)).resolves.toBeTruthy();
        await expect(mov(E2, sessaoE2, 'chave-igual-1')).resolves.toBeTruthy();
    });
});

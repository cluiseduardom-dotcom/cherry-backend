// Integração de verdade (Postgres de testes): o alerta de estoque baixo/esgotado informa o `tipo` de cada item
// (acabado ou insumo), para o menu do ERP contar só o que a tela de Estoque mostra. Isolamento entre empresas.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = {};
const B = {};
const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;

async function criarEmpresa(E) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Alerta ${sufixo}`]));
    const usuario = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'admin', $2, 'x', 'admin') RETURNING id`, [E.id, `admin-${E.id}-${sufixo}@teste.local`]);
    E.token = makeToken({ id: usuario, role: 'admin', empresa_id: E.id, tv: 0 });
}

const produto = (E, nome, tipo, estoque, ativo = true) =>
    um(`INSERT INTO produtos (empresa_id, nome, custo, tipo, ativo, estoque_atual, estoque_minimo) VALUES ($1, $2, 5, $3, $4, $5, 2) RETURNING id`, [E.id, nome, tipo, ativo, estoque]);

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await produto(A, 'Anel esgotado', 'acabado', 0);
    await produto(A, 'Brinco baixo', 'acabado', 1);
    await produto(A, 'Fio esgotado', 'insumo', 0);
    await produto(A, 'Colar com estoque', 'acabado', 9);
    await produto(A, 'Pulseira inativa', 'acabado', 0, false);
    await produto(B, 'SoDaLojaB', 'acabado', 0);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

test('o alerta traz o tipo de cada item e só da própria empresa, sem inativos nem itens com estoque', async () => {
    const res = await request(app).get('/produtos/estoque-baixo').set('Authorization', `Bearer ${A.token}`);
    const porNome = Object.fromEntries(res.body.data.map((i) => [i.nome, i.tipo]));

    expect(res.status).toBe(200);
    expect(porNome).toEqual({ 'Anel esgotado': 'acabado', 'Brinco baixo': 'acabado', 'Fio esgotado': 'insumo' });
    expect(JSON.stringify(res.body)).not.toContain('SoDaLojaB');
});

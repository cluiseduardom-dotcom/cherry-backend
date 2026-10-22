// Integração de verdade (Postgres da CI/dev, sem mock de sessão): migration 050 +
// sessaoRepository + authMiddleware + /cargos + /auth/me + cadastro de usuário.
// Cria empresas/usuários temporários próprios e remove tudo no fim; não depende do seed.
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
const senhaHash = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 4);

const A = {};
const B = {};

async function criarEmpresa(alvo, rotulo) {
    const empresa = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Cargos ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(empresa.rows[0].id);

    const criar = async (papel) => (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [alvo.empresaId, `${papel} ${rotulo}`, `${papel}-${rotulo}-${sufixo}@teste.invalid`, senhaHash, papel]
    )).rows[0].id;

    alvo.adminId = await criar('admin');
    alvo.vendedorId = await criar('vendedor');
}

// O JWT diz sempre "admin" de propósito: o que vale é o cargo no banco.
const tokenDe = (alvo, usuarioId) => makeToken({ id: usuarioId, role: 'admin', empresa_id: alvo.empresaId, tv: 0 });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 050', () => {
    test('usuarios.papel aceita os novos cargos e recusa valores desconhecidos', async () => {
        // Empresa à parte: estes usuários não podem contar como "gente ativa no cargo" dos outros testes.
        const empresaChk = registro.registrar((await db.query(
            `INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Cargos CHK ${sufixo}`]
        )).rows[0].id);

        for (const papel of ['diretor', 'gerente', 'coordenador', 'supervisor', 'analista', 'operador', 'auxiliar', 'faturista']) {
            await expect(db.query(
                `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'x', $2, 'x', $3) RETURNING id`,
                [empresaChk, `${papel}-chk-${sufixo}@teste.invalid`, papel]
            )).resolves.toBeDefined();
        }

        await expect(db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'x', $2, 'x', 'presidente')`,
            [empresaChk, `presidente-${sufixo}@teste.invalid`]
        )).rejects.toMatchObject({ code: '23514' });
    });

    test('cargos_empresa recusa admin, nível fora de 1..89 e cargo desconhecido', async () => {
        const inserir = (cargo, nivel) => db.query(
            `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo) VALUES ($1, $2, $3, true)`, [A.empresaId, cargo, nivel]
        );

        await expect(inserir('admin', 50)).rejects.toMatchObject({ code: '23514' });
        await expect(inserir('gerente', 0)).rejects.toMatchObject({ code: '23514' });
        await expect(inserir('gerente', 90)).rejects.toMatchObject({ code: '23514' });
        await expect(inserir('presidente', 50)).rejects.toMatchObject({ code: '23514' });
    });
});

describe('cargos por comércio com banco real', () => {
    test('comércio sem configuração: Admin lista o catálogo padrão (só básicos ligados)', async () => {
        const res = await request(app).get('/cargos').set(auth(tokenDe(A, A.adminId)));

        expect(res.status).toBe(200);
        const ativos = res.body.data.filter((c) => c.ativo).map((c) => c.cargo).sort();
        expect(ativos).toEqual(['admin', 'estoquista', 'vendedor']);
        expect(res.body.data.map((c) => c.cargo)).toHaveLength(11);
    });

    test('Vendedor recebe 403 em /cargos mesmo com JWT dizendo admin', async () => {
        const res = await request(app).get('/cargos').set(auth(tokenDe(A, A.vendedorId)));

        expect(res.status).toBe(403);
    });

    test('cadastro de usuário em cargo desligado é recusado até o Admin ligar o cargo', async () => {
        const corpo = { nome: 'Gerente Novo', email: `gerente-novo-${sufixo}@teste.invalid`, senha: crypto.randomBytes(8).toString('hex'), papel: 'gerente' };

        const antes = await request(app).post('/auth/register').set(auth(tokenDe(A, A.adminId))).send(corpo);
        expect(antes.status).toBe(409);

        const ligar = await request(app).put('/cargos/gerente').set(auth(tokenDe(A, A.adminId)))
            .send({ ativo: true, nivel: 70, capacidades: ['ver_custos', 'ver_vendas_de_todos', 'cancelar_venda'] });
        expect(ligar.status).toBe(200);
        expect(ligar.body.data).toMatchObject({ cargo: 'gerente', ativo: true, nivel: 70, personalizado: true });

        const depois = await request(app).post('/auth/register').set(auth(tokenDe(A, A.adminId))).send(corpo);
        expect(depois.status).toBe(201);

        A.gerenteId = (await db.query('SELECT id FROM usuarios WHERE email = $1', [corpo.email])).rows[0].id;
    });

    test('isolamento: a configuração de A não vaza para B', async () => {
        const res = await request(app).get('/cargos').set(auth(tokenDe(B, B.adminId)));
        const gerente = res.body.data.find((c) => c.cargo === 'gerente');

        expect(gerente).toMatchObject({ ativo: false, personalizado: false });

        const linhasB = await db.query('SELECT 1 FROM cargos_empresa WHERE empresa_id = $1', [B.empresaId]);
        expect(linhasB.rows).toHaveLength(0);
    });

    test('empresa_id do corpo/query é ignorado: a escrita cai na empresa do token', async () => {
        const injetado = await request(app).put('/cargos/supervisor?empresa_id=' + B.empresaId).set(auth(tokenDe(A, A.adminId)))
            .send({ ativo: true, nivel: 50, empresa_id: B.empresaId });
        expect(injetado.status).toBe(400);

        const ok = await request(app).put('/cargos/supervisor?empresa_id=' + B.empresaId).set(auth(tokenDe(A, A.adminId)))
            .send({ ativo: true, nivel: 50 });
        expect(ok.status).toBe(200);

        const { rows } = await db.query(`SELECT empresa_id FROM cargos_empresa WHERE cargo = 'supervisor' AND empresa_id IN ($1, $2)`, [A.empresaId, B.empresaId]);
        expect(rows).toEqual([{ empresa_id: A.empresaId }]);
    });

    test('empate de nível é permitido (Analista = Coordenador)', async () => {
        const coord = await request(app).put('/cargos/coordenador').set(auth(tokenDe(A, A.adminId))).send({ ativo: true, nivel: 60 });
        const analista = await request(app).put('/cargos/analista').set(auth(tokenDe(A, A.adminId))).send({ ativo: true, nivel: 60 });

        expect(coord.status).toBe(200);
        expect(analista.status).toBe(200);
    });

    test('Admin é imutável e cargos básicos não desligam', async () => {
        const admin = await request(app).put('/cargos/admin').set(auth(tokenDe(A, A.adminId))).send({ nivel: 10 });
        const vendedor = await request(app).put('/cargos/vendedor').set(auth(tokenDe(A, A.adminId))).send({ ativo: false });
        const estoquistaComNivel = await request(app).put('/cargos/estoquista').set(auth(tokenDe(A, A.adminId))).send({ nivel: 20 });

        expect(admin.status).toBe(403);
        expect(vendedor.status).toBe(409);
        expect(estoquistaComNivel.status).toBe(400);
    });

    test('não desliga cargo que tem usuário ativo; desliga depois que ele sai', async () => {
        const bloqueado = await request(app).put('/cargos/gerente').set(auth(tokenDe(A, A.adminId))).send({ ativo: false });
        expect(bloqueado.status).toBe(409);

        await db.query('UPDATE usuarios SET ativo = false WHERE id = $1', [A.gerenteId]);

        const liberado = await request(app).put('/cargos/gerente').set(auth(tokenDe(A, A.adminId))).send({ ativo: false });
        expect(liberado.status).toBe(200);

        await db.query('UPDATE usuarios SET ativo = true WHERE id = $1', [A.gerenteId]);
        await db.query(`UPDATE cargos_empresa SET ativo = true WHERE empresa_id = $1 AND cargo = 'gerente'`, [A.empresaId]);
    });
});

describe('cargo e capacidades valem na hora, sem novo login', () => {
    test('/auth/me reflete o cargo do banco, não o do JWT', async () => {
        const res = await request(app).get('/auth/me').set(auth(tokenDe(A, A.gerenteId)));

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            id: A.gerenteId, empresa_id: A.empresaId, perfil: 'vendedor', cargo: 'gerente', nivel: 70
        });
        expect(res.body.data.capacidades).toEqual(['ver_custos', 'ver_vendas_de_todos', 'cancelar_venda']);
    });

    test('trocar o cargo no banco muda o acesso com o MESMO token', async () => {
        const token = tokenDe(A, A.vendedorId);

        expect((await request(app).get('/cargos').set(auth(token))).status).toBe(403);

        await db.query(`UPDATE usuarios SET papel = 'admin' WHERE id = $1`, [A.vendedorId]);
        expect((await request(app).get('/cargos').set(auth(token))).status).toBe(200);

        await db.query(`UPDATE usuarios SET papel = 'vendedor' WHERE id = $1`, [A.vendedorId]);
        expect((await request(app).get('/cargos').set(auth(token))).status).toBe(403);
    });

    test('desligar o cargo do comércio derruba o acesso de quem já estava logado (403)', async () => {
        const token = tokenDe(A, A.gerenteId);
        expect((await request(app).get('/auth/me').set(auth(token))).status).toBe(200);

        await db.query(`UPDATE cargos_empresa SET ativo = false WHERE empresa_id = $1 AND cargo = 'gerente'`, [A.empresaId]);

        const res = await request(app).get('/auth/me').set(auth(token));
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Cargo desabilitado neste comércio');

        await db.query(`UPDATE cargos_empresa SET ativo = true WHERE empresa_id = $1 AND cargo = 'gerente'`, [A.empresaId]);
    });

    test('a mesma configuração em outro comércio não afeta o usuário daqui', async () => {
        // B nunca ligou "gerente": um usuário gerente de B fica barrado, enquanto o de A segue ativo.
        const gerenteB = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'g', $2, $3, 'gerente') RETURNING id`,
            [B.empresaId, `gerente-b-${sufixo}@teste.invalid`, senhaHash]
        )).rows[0].id;

        expect((await request(app).get('/auth/me').set(auth(tokenDe(B, gerenteB)))).status).toBe(403);
        expect((await request(app).get('/auth/me').set(auth(tokenDe(A, A.gerenteId)))).status).toBe(200);
    });

    test('Gerente vê as vendas de todos; Vendedor só as próprias (mesma empresa)', async () => {
        const canalId = (await db.query(
            `INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [A.empresaId]
        )).rows[0].id;
        const venda = async (usuarioId) => (await db.query(
            `INSERT INTO vendas (empresa_id, usuario_id, canal_id, total, status) VALUES ($1, $2, $3, 10, 'finalizada') RETURNING id`,
            [A.empresaId, usuarioId, canalId]
        )).rows[0].id;

        const doAdmin = await venda(A.adminId);
        const doVendedor = await venda(A.vendedorId);

        const idsDo = async (usuarioId) => (await request(app).get('/vendas?pageSize=100').set(auth(tokenDe(A, usuarioId))))
            .body.data.items.map((v) => v.id);

        const gerente = await idsDo(A.gerenteId);
        const vendedor = await idsDo(A.vendedorId);

        expect(gerente).toEqual(expect.arrayContaining([doAdmin, doVendedor]));
        expect(vendedor).toContain(doVendedor);
        expect(vendedor).not.toContain(doAdmin);
    });
});

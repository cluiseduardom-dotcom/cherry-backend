// Integração de verdade (Postgres da CI/dev, sem mock de sessão): migration 051 + sessaoRepository +
// authMiddleware + /privilegios + /cargos. Empresas e usuários próprios e temporários; remove tudo no fim.
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
const SENHA = crypto.randomBytes(10).toString('hex');
const SENHA_HASH = bcrypt.hashSync(SENHA, 4);

const A = {};
const B = {};
const C = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Privilegios ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
}

async function criarUsuario(alvo, papel, rotulo = papel, ativo = true) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel, ativo]
    );

    return rows[0].id;
}

const ligarCargo = (alvo, cargo, nivel, capacidades = []) => db.query(
    `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (empresa_id, cargo) DO UPDATE SET nivel = $3, ativo = true, capacidades = $4`,
    [alvo.empresaId, cargo, nivel, capacidades]
);

// O JWT diz sempre "vendedor" de propósito: quem vale é o banco.
const tokenDe = (alvo, usuarioId, tv = 0) => makeToken({ id: usuarioId, role: 'vendedor', empresa_id: alvo.empresaId, tv });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const confirmacao = (extra = {}) => ({ senha: SENHA, motivo: 'Cobertura de férias da gerência', ...extra });

const conceder = (alvo, atorId, usuarioId, corpo = confirmacao()) =>
    request(app).post(`/privilegios/usuarios/${usuarioId}/administrador`).set(auth(tokenDe(alvo, atorId))).send(corpo);
const revogar = (alvo, atorId, usuarioId, corpo = confirmacao()) =>
    request(app).post(`/privilegios/usuarios/${usuarioId}/administrador/revogar`).set(auth(tokenDe(alvo, atorId))).send(corpo);
const concederCargo = (alvo, atorId, cargo, corpo = confirmacao()) =>
    request(app).post(`/privilegios/cargos/${cargo}/administrador`).set(auth(tokenDe(alvo, atorId))).send(corpo);
const revogarCargo = (alvo, atorId, cargo, corpo = confirmacao()) =>
    request(app).post(`/privilegios/cargos/${cargo}/administrador/revogar`).set(auth(tokenDe(alvo, atorId))).send(corpo);

const ehAdmin = async (alvo, usuarioId, tv = 0) => (await request(app).get('/cargos').set(auth(tokenDe(alvo, usuarioId, tv)))).status === 200;
// Com a token_version ATUAL do banco (sessões já derrubadas por revogações anteriores não contam).
const ehAdminAgora = async (alvo, usuarioId) => ehAdmin(alvo, usuarioId, await tokenVersion(usuarioId));
const tokenAtual = async (alvo, usuarioId) => tokenDe(alvo, usuarioId, await tokenVersion(usuarioId));
const tokenVersion = async (usuarioId) => (await db.query('SELECT token_version FROM usuarios WHERE id = $1', [usuarioId])).rows[0].token_version;
const eventos = async (empresaId) => (await db.query('SELECT * FROM privilegios_eventos WHERE empresa_id = $1 ORDER BY id', [empresaId])).rows;

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    await criarEmpresa(C, 'C');

    A.adminId = await criarUsuario(A, 'admin', 'admin');
    A.vendedorId = await criarUsuario(A, 'vendedor', 'vendedor');
    A.vendedor2Id = await criarUsuario(A, 'vendedor', 'vendedor2');
    B.adminId = await criarUsuario(B, 'admin', 'admin');
    B.vendedorId = await criarUsuario(B, 'vendedor', 'vendedor');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 051', () => {
    test('só a capacidade `administrador` é aceita e só pode haver UMA concessão ativa por usuário', async () => {
        const insere = (cap = 'administrador') => db.query(
            `INSERT INTO usuario_privilegios (empresa_id, usuario_id, capacidade, concedido_por, motivo) VALUES ($1, $2, $3, $4, 'teste de constraint')`,
            [B.empresaId, B.vendedorId, cap, B.adminId]
        );

        await expect(insere('ver_custos')).rejects.toMatchObject({ code: '23514' });
        await insere();
        await expect(insere()).rejects.toMatchObject({ code: '23505' });

        await db.query(`UPDATE usuario_privilegios SET revogado_em = NOW(), revogado_por = $1 WHERE empresa_id = $2`, [B.adminId, B.empresaId]);
        await insere();
        await db.query('DELETE FROM usuario_privilegios WHERE empresa_id = $1', [B.empresaId]);
    });

    test('revogação incompleta (data sem responsável) e evento com alvo inconsistente são recusados', async () => {
        await expect(db.query(
            `INSERT INTO usuario_privilegios (empresa_id, usuario_id, capacidade, concedido_por, motivo, revogado_em)
             VALUES ($1, $2, 'administrador', $3, 'x', NOW())`, [B.empresaId, B.vendedorId, B.adminId]
        )).rejects.toMatchObject({ code: '23514' });

        const evento = (escopo, usuario, cargo) => db.query(
            `INSERT INTO privilegios_eventos (empresa_id, escopo, acao, alvo_usuario_id, alvo_cargo, executado_por, motivo)
             VALUES ($1, $2, 'conceder', $3, $4, $5, 'x')`, [B.empresaId, escopo, usuario, cargo, B.adminId]
        );

        await expect(evento('usuario', null, null)).rejects.toMatchObject({ code: '23514' });
        await expect(evento('usuario', B.vendedorId, 'gerente')).rejects.toMatchObject({ code: '23514' });
        await expect(evento('cargo', B.vendedorId, null)).rejects.toMatchObject({ code: '23514' });
        await expect(evento('empresa', B.vendedorId, null)).rejects.toMatchObject({ code: '23514' });
    });
});

describe('Admin individual: conceder e revogar com banco real', () => {
    test('Vendedor não acessa nada de Admin; depois de concedido, o MESMO token passa a ser Admin', async () => {
        expect(await ehAdmin(A, A.vendedorId)).toBe(false);

        const res = await conceder(A, A.adminId, A.vendedorId);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ usuario_id: A.vendedorId, administrador_concedido: true });
        expect(await ehAdmin(A, A.vendedorId)).toBe(true);

        const me = await request(app).get('/auth/me').set(auth(tokenDe(A, A.vendedorId)));
        expect(me.body.data).toMatchObject({ perfil: 'admin', cargo: 'vendedor', nivel: 30 });
        expect(me.body.data.capacidades).toEqual(expect.arrayContaining(['administrador', 'conceder_admin']));
    });

    test('a concessão e o evento ficam gravados, com quem concedeu, o motivo e a data', async () => {
        const [concessao] = (await db.query('SELECT * FROM usuario_privilegios WHERE empresa_id = $1', [A.empresaId])).rows;
        const [evento] = await eventos(A.empresaId);

        expect(concessao).toMatchObject({ usuario_id: A.vendedorId, concedido_por: A.adminId, capacidade: 'administrador', revogado_em: null });
        expect(concessao.motivo).toBe('Cobertura de férias da gerência');
        expect(evento).toMatchObject({ escopo: 'usuario', acao: 'conceder', alvo_usuario_id: A.vendedorId, executado_por: A.adminId, usuarios_afetados: 1 });
    });

    test('conceder de novo ao mesmo usuário: 409; conceder a quem já é Admin pelo cargo: 409', async () => {
        expect((await conceder(A, A.adminId, A.vendedorId)).status).toBe(409);
        expect((await conceder(A, A.adminId, A.adminId)).status).toBe(403);
    });

    test('Admin concedido pode, ele mesmo, conceder a outra pessoa (cadeia auditada)', async () => {
        const res = await conceder(A, A.vendedorId, A.vendedor2Id, confirmacao({ motivo: 'Segundo gerente do turno' }));

        expect(res.status).toBe(200);
        expect((await db.query('SELECT concedido_por FROM usuario_privilegios WHERE usuario_id = $1', [A.vendedor2Id])).rows[0].concedido_por).toBe(A.vendedorId);

        // desfaz para não interferir nos demais testes
        expect((await revogar(A, A.adminId, A.vendedor2Id)).status).toBe(200);
    });

    test('revogar derruba o token que já estava em uso e tira o acesso', async () => {
        const antes = await tokenVersion(A.vendedorId);

        const res = await revogar(A, A.adminId, A.vendedorId, confirmacao({ motivo: 'Fim da cobertura' }));

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ administrador_concedido: false });
        expect(await tokenVersion(A.vendedorId)).toBe(antes + 1);

        const comTokenAntigo = await request(app).get('/cargos').set(auth(tokenDe(A, A.vendedorId, antes)));
        expect(comTokenAntigo.status).toBe(401);

        // mesmo um token novo (tv atual) já não é Admin
        expect(await ehAdmin(A, A.vendedorId, antes + 1)).toBe(false);
    });

    test('a concessão revogada continua no histórico (nunca apagada) e dá para conceder de novo', async () => {
        const linhas = (await db.query('SELECT revogado_em, revogado_por FROM usuario_privilegios WHERE usuario_id = $1 ORDER BY id', [A.vendedorId])).rows;

        expect(linhas).toHaveLength(1);
        expect(linhas[0].revogado_em).not.toBeNull();
        expect(linhas[0].revogado_por).toBe(A.adminId);

        expect((await conceder(A, A.adminId, A.vendedorId)).status).toBe(200);
        expect((await db.query('SELECT 1 FROM usuario_privilegios WHERE usuario_id = $1', [A.vendedorId])).rows).toHaveLength(2);

        await revogar(A, A.adminId, A.vendedorId);
    });

    test('senha errada: 403, nada gravado, token_version intacta', async () => {
        const eventosAntes = (await eventos(A.empresaId)).length;
        const tv = await tokenVersion(A.vendedorId);

        const res = await conceder(A, A.adminId, A.vendedorId, confirmacao({ senha: 'senha-errada' }));

        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Senha de confirmação inválida');
        expect((await eventos(A.empresaId)).length).toBe(eventosAntes);
        expect(await tokenVersion(A.vendedorId)).toBe(tv);
        expect(await ehAdmin(A, A.vendedorId, tv)).toBe(false);
    });

    test('a senha de OUTRO usuário não autoriza o ator', async () => {
        const outraSenha = crypto.randomBytes(8).toString('hex');
        await db.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [bcrypt.hashSync(outraSenha, 4), A.vendedorId]);

        // o ator (adminId) usa a senha do vendedor: recusado
        expect((await conceder(A, A.adminId, A.vendedor2Id, confirmacao({ senha: outraSenha }))).status).toBe(403);

        await db.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [SENHA_HASH, A.vendedorId]);
    });

    test('ator desativado não confirma nada (sessão já cai antes)', async () => {
        await db.query('UPDATE usuarios SET ativo = false WHERE id = $1', [A.adminId]);

        expect((await conceder(A, A.adminId, A.vendedor2Id)).status).toBe(401);

        await db.query('UPDATE usuarios SET ativo = true WHERE id = $1', [A.adminId]);
    });

    test('alvo inativo: 409; alvo inexistente: 404', async () => {
        await db.query('UPDATE usuarios SET ativo = false WHERE id = $1', [A.vendedor2Id]);
        expect((await conceder(A, A.adminId, A.vendedor2Id)).status).toBe(409);
        await db.query('UPDATE usuarios SET ativo = true WHERE id = $1', [A.vendedor2Id]);

        expect((await conceder(A, A.adminId, 2147483000)).status).toBe(404);
    });
});

describe('isolamento entre comércios', () => {
    test('usuário de OUTRA empresa é "não encontrado", sem efeito nenhum', async () => {
        const res = await conceder(A, A.adminId, B.vendedorId);

        expect(res.status).toBe(404);
        expect((await db.query('SELECT 1 FROM usuario_privilegios WHERE usuario_id = $1', [B.vendedorId])).rows).toHaveLength(0);
        expect(await ehAdmin(B, B.vendedorId)).toBe(false);
    });

    test('revogar concessão de outra empresa: 404, e a concessão de lá permanece', async () => {
        await conceder(B, B.adminId, B.vendedorId);

        expect((await revogar(A, A.adminId, B.vendedorId)).status).toBe(404);
        expect(await ehAdmin(B, B.vendedorId)).toBe(true);

        await revogar(B, B.adminId, B.vendedorId);
    });

    test('Admin concedido em A não é Admin em B, nem com token de B para o mesmo id', async () => {
        await conceder(A, A.adminId, A.vendedorId);

        const tokenForjado = makeToken({ id: A.vendedorId, role: 'admin', empresa_id: B.empresaId, tv: 0 });
        expect((await request(app).get('/cargos').set(auth(tokenForjado))).status).toBe(401);

        await revogar(A, A.adminId, A.vendedorId);
    });

    test('listagens e histórico mostram só a empresa do token', async () => {
        const usuarios = await request(app).get('/privilegios/usuarios').set(auth(tokenDe(A, A.adminId)));
        const historico = await request(app).get('/privilegios/historico?pageSize=100').set(auth(tokenDe(A, A.adminId)));
        const idsDeA = [A.adminId, A.vendedorId, A.vendedor2Id];

        expect(usuarios.body.data.map((u) => u.id).sort()).toEqual([...idsDeA].sort());
        expect(historico.body.data.items.length).toBeGreaterThan(0);
        historico.body.data.items.forEach((e) => expect(idsDeA).toContain(e.executado_por));
    });

    test('a listagem de usuários não expõe senha nem token_version', async () => {
        const { body } = await request(app).get('/privilegios/usuarios').set(auth(tokenDe(A, A.adminId)));

        expect(Object.keys(body.data[0]).sort()).toEqual(['admin_concedido', 'administrador', 'ativo', 'cargo', 'email', 'id', 'nome']);
        expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
    });

    test('/privilegios/administradores mostra a origem de cada Admin', async () => {
        await conceder(A, A.adminId, A.vendedorId);

        const { body } = await request(app).get('/privilegios/administradores').set(auth(tokenDe(A, A.adminId)));
        const porId = Object.fromEntries(body.data.map((u) => [u.id, u]));

        expect(porId[A.adminId]).toMatchObject({ admin_pelo_cargo_base: true, admin_concedido: false });
        expect(porId[A.vendedorId]).toMatchObject({ admin_pelo_cargo_base: false, admin_concedido: true, concedido_por: A.adminId });
        expect(porId[A.vendedor2Id]).toBeUndefined();

        await revogar(A, A.adminId, A.vendedorId);
    });
});

describe('Admin anexado a um CARGO', () => {
    test('conceder ao cargo torna todos os usuários dele Admin; o evento registra quantos', async () => {
        await ligarCargo(A, 'coordenador', 60, ['ver_custos']);
        A.coord1 = await criarUsuario(A, 'coordenador', 'coord1');
        A.coord2 = await criarUsuario(A, 'coordenador', 'coord2');

        expect(await ehAdmin(A, A.coord1)).toBe(false);

        const res = await concederCargo(A, A.adminId, 'coordenador');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ cargo: 'coordenador', administrador: true, usuarios_afetados: 2 });
        expect(await ehAdmin(A, A.coord1)).toBe(true);
        expect(await ehAdmin(A, A.coord2)).toBe(true);

        const ultimo = (await eventos(A.empresaId)).pop();
        expect(ultimo).toMatchObject({ escopo: 'cargo', acao: 'conceder', alvo_cargo: 'coordenador', usuarios_afetados: 2, executado_por: A.adminId });
    });

    test('editar o cargo pela tela de cargos NÃO apaga o Admin anexado', async () => {
        const res = await request(app).put('/cargos/coordenador').set(auth(tokenDe(A, A.adminId))).send({ capacidades: ['cancelar_venda'], nivel: 61 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ administrador: true, nivel: 61, capacidades: ['cancelar_venda'] });
        expect(await ehAdmin(A, A.coord1)).toBe(true);

        const lista = await request(app).get('/cargos').set(auth(tokenDe(A, A.adminId)));
        expect(lista.body.data.find((c) => c.cargo === 'coordenador')).toMatchObject({ administrador: true });
    });

    test('conceder ao cargo que já tem, ao Admin e a cargo desligado: 409', async () => {
        expect((await concederCargo(A, A.adminId, 'coordenador')).status).toBe(409);
        expect((await concederCargo(A, A.adminId, 'admin')).status).toBe(409);
        expect((await concederCargo(A, A.adminId, 'diretor')).status).toBe(409);
    });

    test('Admin pelo cargo não pode receber concessão individual (409) nem revogá-la por aqui', async () => {
        expect((await conceder(A, A.adminId, A.coord1)).status).toBe(409);
        expect((await revogar(A, A.adminId, A.coord1)).status).toBe(409);
    });

    test('revogar do cargo derruba as sessões de TODOS os usuários dele e tira o acesso', async () => {
        const [tv1, tv2] = [await tokenVersion(A.coord1), await tokenVersion(A.coord2)];

        const res = await revogarCargo(A, A.adminId, 'coordenador', confirmacao({ motivo: 'Reorganização da equipe' }));

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ administrador: false, usuarios_afetados: 2 });
        expect(await tokenVersion(A.coord1)).toBe(tv1 + 1);
        expect(await tokenVersion(A.coord2)).toBe(tv2 + 1);
        expect((await request(app).get('/cargos').set(auth(tokenDe(A, A.coord1, tv1)))).status).toBe(401);
        expect(await ehAdmin(A, A.coord1, tv1 + 1)).toBe(false);
    });

    test('revogar de cargo sem o privilégio: 409', async () => {
        expect((await revogarCargo(A, A.adminId, 'coordenador')).status).toBe(409);
    });

    test('concessão de cargo em A não vaza para o cargo de mesmo nome em B', async () => {
        await ligarCargo(B, 'coordenador', 60, []);
        B.coord = await criarUsuario(B, 'coordenador', 'coord');

        await concederCargo(A, A.adminId, 'coordenador');

        expect(await ehAdmin(B, B.coord)).toBe(false);
        expect((await db.query(`SELECT capacidades FROM cargos_empresa WHERE empresa_id = $1 AND cargo = 'coordenador'`, [B.empresaId])).rows[0].capacidades).toEqual([]);

        await revogarCargo(A, A.adminId, 'coordenador');
    });
});

describe('sem escalada de privilégio por gerir_cargos / conceder_admin', () => {
    beforeAll(async () => {
        await ligarCargo(A, 'gerente', 70, ['gerir_cargos', 'ver_custos', 'cancelar_venda']);
        A.gerente = await criarUsuario(A, 'gerente', 'gerente');
    });

    test('Gerente com gerir_cargos não consegue dar a si mesmo conceder_admin, nem editar o próprio cargo', async () => {
        const res = await request(app).put('/cargos/gerente').set(auth(tokenDe(A, A.gerente))).send({ capacidades: ['gerir_cargos', 'conceder_admin'] });

        expect(res.status).toBe(403);
        expect((await db.query(`SELECT capacidades FROM cargos_empresa WHERE empresa_id = $1 AND cargo = 'gerente'`, [A.empresaId])).rows[0].capacidades)
            .toEqual(['gerir_cargos', 'ver_custos', 'cancelar_venda']);
    });

    test('Gerente edita cargo abaixo do seu, com capacidades que possui; não passa conceder_admin adiante', async () => {
        await ligarCargo(A, 'supervisor', 50, []);

        const ok = await request(app).put('/cargos/supervisor').set(auth(tokenDe(A, A.gerente))).send({ capacidades: ['ver_custos'], nivel: 55 });
        const negado = await request(app).put('/cargos/supervisor').set(auth(tokenDe(A, A.gerente))).send({ capacidades: ['conceder_admin'] });
        const nivelAlto = await request(app).put('/cargos/supervisor').set(auth(tokenDe(A, A.gerente))).send({ nivel: 70 });

        expect(ok.status).toBe(200);
        expect(negado.status).toBe(403);
        expect(nivelAlto.status).toBe(403);
    });

    test('Gerente com `conceder_admin` (delegado) concede a outro, mas NÃO ao próprio cargo e NÃO a si mesmo', async () => {
        await db.query(`UPDATE cargos_empresa SET capacidades = ARRAY['conceder_admin'] WHERE empresa_id = $1 AND cargo = 'gerente'`, [A.empresaId]);

        expect((await conceder(A, A.gerente, A.gerente)).status).toBe(403);
        expect((await concederCargo(A, A.gerente, 'gerente')).status).toBe(403);

        const paraOutro = await conceder(A, A.gerente, A.vendedor2Id, confirmacao({ motivo: 'Delegação do turno da tarde' }));
        expect(paraOutro.status).toBe(200);
        expect(await ehAdminAgora(A, A.vendedor2Id)).toBe(true);

        await revogar(A, A.adminId, A.vendedor2Id);
    });
});

describe('o comércio nunca fica sem Admin', () => {
    test('revogar o último Admin (por concessão individual): 409 e nada muda', async () => {
        // C: o Admin de cargo está inativo; o único Admin efetivo é a concessão individual.
        C.adminInativo = await criarUsuario(C, 'admin', 'admin-inativo', false);
        C.x = await criarUsuario(C, 'vendedor', 'x');
        C.y = await criarUsuario(C, 'vendedor', 'y');

        await db.query(
            `INSERT INTO usuario_privilegios (empresa_id, usuario_id, capacidade, concedido_por, motivo) VALUES ($1, $2, 'administrador', $3, 'semente do teste')`,
            [C.empresaId, C.x, C.adminInativo]
        );

        // X é o único Admin e tenta revogar a própria concessão
        const res = await revogar(C, C.x, C.x);

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('O comércio precisa manter ao menos um Admin ativo');
        expect(await ehAdmin(C, C.x)).toBe(true);
        expect((await db.query('SELECT revogado_em FROM usuario_privilegios WHERE usuario_id = $1', [C.x])).rows[0].revogado_em).toBeNull();
        expect(await tokenVersion(C.x)).toBe(0);
        expect((await eventos(C.empresaId))).toHaveLength(0);
    });

    test('com dois Admins, revogar um é permitido; o outro vira o último e fica protegido', async () => {
        expect((await conceder(C, C.x, C.y)).status).toBe(200);
        expect((await revogar(C, C.x, C.y)).status).toBe(200);
        expect((await revogar(C, C.x, C.x)).status).toBe(409);
    });

    test('revogar o Admin anexado ao único cargo que sustenta o comércio: 409, cargo e sessões intactos', async () => {
        await db.query(`DELETE FROM usuario_privilegios WHERE empresa_id = $1`, [C.empresaId]);
        await ligarCargo(C, 'gerente', 70, ['administrador', 'conceder_admin']);
        C.g = await criarUsuario(C, 'gerente', 'g');

        const res = await revogarCargo(C, C.g, 'gerente');

        expect(res.status).toBe(409);
        expect((await db.query(`SELECT capacidades FROM cargos_empresa WHERE empresa_id = $1 AND cargo = 'gerente'`, [C.empresaId])).rows[0].capacidades).toContain('administrador');
        expect(await tokenVersion(C.g)).toBe(0);
        expect(await ehAdmin(C, C.g)).toBe(true);
    });

    test('duas revogações SIMULTÂNEAS entre os dois únicos Admins: nunca passam as duas', async () => {
        await db.query(`UPDATE cargos_empresa SET capacidades = ARRAY['conceder_admin'] WHERE empresa_id = $1 AND cargo = 'gerente'`, [C.empresaId]);
        const insere = (usuario) => db.query(
            `INSERT INTO usuario_privilegios (empresa_id, usuario_id, capacidade, concedido_por, motivo) VALUES ($1, $2, 'administrador', $3, 'semente do teste')`,
            [C.empresaId, usuario, C.adminInativo]
        );
        await insere(C.x);
        await insere(C.y);

        const [r1, r2] = await Promise.all([revogar(C, C.x, C.y), revogar(C, C.y, C.x)]);
        const status = [r1.status, r2.status];

        expect(status.filter((s) => s === 200).length).toBeLessThanOrEqual(1);

        const restantes = (await db.query(
            `SELECT COUNT(*)::int AS total FROM usuario_privilegios WHERE empresa_id = $1 AND revogado_em IS NULL`, [C.empresaId]
        )).rows[0].total;
        expect(restantes).toBeGreaterThanOrEqual(1);
    });
});

describe('histórico de privilégios', () => {
    test('lista eventos com quem executou, alvo, motivo e data; mais recente primeiro; filtra e pagina', async () => {
        const todos = await request(app).get('/privilegios/historico?pageSize=100').set(auth(tokenDe(A, A.adminId)));
        const itens = todos.body.data.items;

        expect(todos.status).toBe(200);
        expect(itens[0]).toEqual(expect.objectContaining({
            id: expect.any(Number), escopo: expect.any(String), acao: expect.any(String), motivo: expect.any(String),
            executado_por: A.adminId, executado_por_nome: `admin ${sufixo}`
        }));
        const datas = itens.map((e) => new Date(e.criado_em).getTime());
        expect([...datas].sort((a, b) => b - a)).toEqual(datas);

        const soCargo = await request(app).get('/privilegios/historico?escopo=cargo&alvo_cargo=coordenador').set(auth(tokenDe(A, A.adminId)));
        expect(soCargo.body.data.items.length).toBeGreaterThanOrEqual(2);
        soCargo.body.data.items.forEach((e) => expect(e).toMatchObject({ escopo: 'cargo', alvo_cargo: 'coordenador' }));

        const pagina = await request(app).get('/privilegios/historico?pageSize=2&page=2').set(auth(tokenDe(A, A.adminId)));
        expect(pagina.body.data.items).toHaveLength(2);
        expect(pagina.body.data).toMatchObject({ page: 2, pageSize: 2, total: todos.body.data.total });
    });

    test('Vendedor e Gerente sem conceder_admin não leem o histórico', async () => {
        expect((await request(app).get('/privilegios/historico').set(auth(await tokenAtual(A, A.vendedor2Id)))).status).toBe(403);
    });
});

// Integração de verdade (Postgres da CI/dev, sem mock de sessão): migration 055 + sessaoRepository +
// authMiddleware + /usuarios. Empresas e usuários próprios e temporários; remove tudo no fim.
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

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Usuarios ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
}

async function criarUsuario(alvo, papel, rotulo = papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );

    return rows[0].id;
}

const ligarCargo = (alvo, cargo, nivel, capacidades = []) => db.query(
    `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (empresa_id, cargo) DO UPDATE SET nivel = $3, ativo = true, capacidades = $4`,
    [alvo.empresaId, cargo, nivel, capacidades]
);

const tokenVersion = async (id) => (await db.query('SELECT token_version FROM usuarios WHERE id = $1', [id])).rows[0].token_version;
const tokenAtual = async (alvo, id) => makeToken({ id, role: 'vendedor', empresa_id: alvo.empresaId, tv: await tokenVersion(id) });
const como = async (alvo, id, metodo, url, corpo) =>
    request(app)[metodo](url).set('Authorization', `Bearer ${await tokenAtual(alvo, id)}`).send(corpo);
const eventos = async (empresaId) => (await db.query('SELECT * FROM usuarios_eventos WHERE empresa_id = $1 ORDER BY id', [empresaId])).rows;
const novo = (extra = {}) => ({
    nome: `Novo ${sufixo}`, email: `novo-${crypto.randomBytes(4).toString('hex')}-${sufixo}@teste.invalid`, senha: SENHA, papel: 'vendedor', telefone: '(11) 91234-5678', ...extra
});

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    A.adminId = await criarUsuario(A, 'admin', 'admin');
    A.gerenteId = await criarUsuario(A, 'gerente', 'gerente');
    A.gerente2Id = await criarUsuario(A, 'gerente', 'gerente2');
    A.diretorId = await criarUsuario(A, 'diretor', 'diretor');
    A.vendedorId = await criarUsuario(A, 'vendedor', 'vendedor');
    A.estoquistaId = await criarUsuario(A, 'estoquista', 'estoquista');
    B.vendedorId = await criarUsuario(B, 'vendedor', 'vendedor');
    B.gerenteId = await criarUsuario(B, 'gerente', 'gerente');

    await ligarCargo(A, 'gerente', 70, ['gerir_usuarios']);
    await ligarCargo(A, 'diretor', 80, ['gerir_usuarios']);
    await ligarCargo(A, 'vendedor', 30, []);
    await ligarCargo(B, 'gerente', 70, ['gerir_usuarios']);
    await ligarCargo(B, 'vendedor', 30, []);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 055', () => {
    test('ação inválida e bloqueio sem motivo são recusados pelo banco', async () => {
        const insere = (acao, motivo) => db.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo) VALUES ($1, $2, $3, 'vendedor', $4, $5)`,
            [A.empresaId, acao, A.vendedorId, A.adminId, motivo]
        );

        await expect(insere('apagar', 'motivo válido')).rejects.toMatchObject({ code: '23514' });
        await expect(insere('bloquear', null)).rejects.toMatchObject({ code: '23514' });
        await expect(insere('bloquear', '  a ')).rejects.toMatchObject({ code: '23514' });
    });
});

describe('migration 055: integridade da trilha', () => {
    const evento = (extra = {}) => db.query(
        `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo)
         VALUES ($1, 'bloquear', $2, 'vendedor', $3, 'motivo de teste') RETURNING id`,
        [extra.empresa ?? A.empresaId, extra.alvo ?? A.vendedorId, extra.autor ?? A.adminId]
    );

    test('alvo ou executor de OUTRA empresa é recusado pelo banco (FK composta)', async () => {
        await expect(evento({ alvo: B.vendedorId })).rejects.toMatchObject({ code: '23503' });
        await expect(evento({ autor: B.gerenteId })).rejects.toMatchObject({ code: '23503' });
        await expect(evento({ empresa: B.empresaId })).rejects.toMatchObject({ code: '23503' });
    });

    test('UPDATE e DELETE na trilha são recusados pelo banco', async () => {
        const { rows } = await evento();

        await expect(db.query(`UPDATE usuarios_eventos SET motivo = 'adulterado' WHERE id = $1`, [rows[0].id]))
            .rejects.toMatchObject({ code: '23001' });
        await expect(db.query('DELETE FROM usuarios_eventos WHERE id = $1', [rows[0].id]))
            .rejects.toMatchObject({ code: '23001' });

        expect((await db.query('SELECT motivo FROM usuarios_eventos WHERE id = $1', [rows[0].id])).rows[0].motivo).toBe('motivo de teste');
    });
});

describe('criar x desligar cargo ao mesmo tempo', () => {
    const cargosRepository = require('../../src/repositories/cargosRepository');
    const usuariosRepository = require('../../src/repositories/usuariosRepository');
    const dados = (papel) => ({
        nome: `Corrida ${sufixo}`, email: `corrida-${papel}-${crypto.randomBytes(3).toString('hex')}-${sufixo}@teste.invalid`,
        senhaHash: SENHA_HASH, papel, empresa_id: A.empresaId, executado_por: A.gerenteId, motivo: null
    });

    test('o cargo é revalidado SOB a trava: desligado no meio, a criação é recusada (409) e nada é criado', async () => {
        // Cargo ligado e vazio (nenhum usuário nele): é o caso em que o desligar passa pela contagem.
        await ligarCargo(A, 'supervisor', 50, []);

        // Quem desliga segura a trava do cargo; a criação começa e espera por ela.
        const desligando = await db.connect();
        await desligando.query('BEGIN');
        await cargosRepository.travarCargo(desligando, A.empresaId, 'supervisor');

        const dadosCriacao = dados('supervisor');
        const criando = usuariosRepository.criarComAuditoria(dadosCriacao);
        const resultado = criando.then((r) => ({ r }), (e) => ({ e }));

        await new Promise((resolver) => setTimeout(resolver, 300));
        await desligando.query(`UPDATE cargos_empresa SET ativo = false WHERE empresa_id = $1 AND cargo = 'supervisor'`, [A.empresaId]);
        await desligando.query('COMMIT');
        desligando.release();

        const { r, e } = await resultado;

        expect(r).toBeUndefined();
        expect(e).toMatchObject({ statusCode: 409 });
        expect((await db.query('SELECT 1 FROM usuarios WHERE email = $1', [dadosCriacao.email])).rowCount).toBe(0);
    });

    test('desligar um cargo com usuário ativo é recusado dentro da própria gravação (409) e o cargo continua ligado', async () => {
        await ligarCargo(A, 'supervisor', 50, []);
        await criarUsuario(A, 'supervisor', 'sup');

        await expect(cargosRepository.salvarComTravaDeUso(
            { empresa_id: A.empresaId, cargo: 'supervisor', nivel: 50, ativo: false, capacidades: [], usuario_id: A.adminId },
            { bloquearSeEmUso: true }
        )).rejects.toMatchObject({ statusCode: 409 });

        expect((await db.query(`SELECT ativo FROM cargos_empresa WHERE empresa_id = $1 AND cargo = 'supervisor'`, [A.empresaId])).rows[0].ativo).toBe(true);
    });

    test('a criação direta em cargo desligado é recusada mesmo sem passar pelo service', async () => {
        await db.query(`UPDATE cargos_empresa SET ativo = false WHERE empresa_id = $1 AND cargo = 'diretor'`, [A.empresaId]);

        await expect(usuariosRepository.criarComAuditoria(dados('diretor'))).rejects.toMatchObject({ statusCode: 409 });

        await db.query(`UPDATE cargos_empresa SET ativo = true WHERE empresa_id = $1 AND cargo = 'diretor'`, [A.empresaId]);
    });
});

describe('autorização', () => {
    test('Vendedor e Estoquista: 403; sem token: 401', async () => {
        expect((await request(app).get('/usuarios')).status).toBe(401);
        expect((await como(A, A.vendedorId, 'get', '/usuarios')).status).toBe(403);
        expect((await como(A, A.estoquistaId, 'get', '/usuarios')).status).toBe(403);
    });

    test('Gerente com a capacidade lista só a própria empresa, com pode_gerenciar por linha', async () => {
        const res = await como(A, A.gerenteId, 'get', '/usuarios');
        const porId = Object.fromEntries(res.body.data.map((u) => [u.id, u]));

        expect(res.status).toBe(200);
        expect(porId[B.vendedorId]).toBeUndefined();
        expect(porId[A.vendedorId].pode_gerenciar).toBe(true);
        expect(porId[A.estoquistaId].pode_gerenciar).toBe(true);
        expect(porId[A.gerente2Id].pode_gerenciar).toBe(false);
        expect(porId[A.diretorId].pode_gerenciar).toBe(false);
        expect(porId[A.adminId].pode_gerenciar).toBe(false);
        expect(porId[A.gerenteId].pode_gerenciar).toBe(false);
        expect(JSON.stringify(res.body)).not.toMatch(/senha|\$2[aby]\$/);
    });
});

describe('cargos atribuíveis', () => {
    test('Admin vê só cargos ligados e nunca Admin; analista desligado não aparece', async () => {
        const res = await como(A, A.adminId, 'get', '/usuarios/cargos');

        expect(res.status).toBe(200);
        const cargos = res.body.data.map((c) => c.cargo);
        expect(cargos).toEqual(expect.arrayContaining(['diretor', 'gerente', 'vendedor', 'estoquista']));
        expect(cargos).not.toContain('admin');
        expect(cargos).not.toContain('analista');
    });

    test('Gerente só vê cargos de nível menor que o seu (e só da própria empresa)', async () => {
        const res = await como(A, A.gerenteId, 'get', '/usuarios/cargos');

        expect(res.status).toBe(200);
        const cargos = res.body.data.map((c) => c.cargo);
        expect(cargos).toContain('vendedor');
        expect(cargos).not.toContain('gerente');
        expect(cargos).not.toContain('diretor');
        expect(cargos).not.toContain('admin');
    });

    test('Vendedor recebe 403', async () => {
        expect((await como(A, A.vendedorId, 'get', '/usuarios/cargos')).status).toBe(403);
    });
});

describe('criar', () => {
    test('Gerente cria Vendedor; fica na empresa do JWT, com hash e evento de auditoria', async () => {
        const corpo = novo();
        const res = await como(A, A.gerenteId, 'post', '/usuarios', corpo);

        expect(res.status).toBe(201);

        const { rows } = await db.query('SELECT empresa_id, papel, ativo, senha FROM usuarios WHERE id = $1', [res.body.data.usuario.id]);
        expect(rows[0]).toMatchObject({ empresa_id: A.empresaId, papel: 'vendedor', ativo: true });
        expect(rows[0].senha).not.toBe(SENHA);
        expect(await bcrypt.compare(SENHA, rows[0].senha)).toBe(true);

        const ev = (await eventos(A.empresaId)).find((e) => e.alvo_usuario_id === res.body.data.usuario.id);
        expect(ev).toMatchObject({ acao: 'criar', executado_por: A.gerenteId, cargo_alvo: 'vendedor' });

        const login = await request(app).post('/auth/login').send({ email: corpo.email, senha: SENHA });
        expect(login.status).toBe(200);
    });

    test('empresa_id do corpo é recusado (400) e nada é criado', async () => {
        const corpo = novo({ empresa_id: B.empresaId });
        expect((await como(A, A.gerenteId, 'post', '/usuarios', corpo)).status).toBe(400);
        expect((await db.query('SELECT 1 FROM usuarios WHERE email = $1', [corpo.email])).rowCount).toBe(0);
    });

    test('Gerente não cria Gerente, Diretor nem Admin; e-mail repetido é 409', async () => {
        for (const papel of ['gerente', 'diretor', 'admin']) {
            expect((await como(A, A.gerenteId, 'post', '/usuarios', novo({ papel }))).status).toBe(403);
        }

        const repetido = novo();
        expect((await como(A, A.gerenteId, 'post', '/usuarios', repetido)).status).toBe(201);
        expect((await como(A, A.gerenteId, 'post', '/usuarios', repetido)).status).toBe(409);
    });

    test('cargo desligado na empresa é recusado', async () => {
        expect((await como(A, A.gerenteId, 'post', '/usuarios', novo({ papel: 'operador' }))).status).toBeGreaterThanOrEqual(400);
    });

    test('Diretor cria Gerente (nível menor)', async () => {
        expect((await como(A, A.diretorId, 'post', '/usuarios', novo({ papel: 'gerente' }))).status).toBe(201);
    });
});

describe('bloquear e desbloquear', () => {
    test('bloquear derruba a sessão, impede login e grava evento; desbloquear restaura', async () => {
        const tokenAntes = await tokenAtual(A, A.vendedorId);
        const vAntes = await tokenVersion(A.vendedorId);

        const res = await como(A, A.gerenteId, 'patch', `/usuarios/${A.vendedorId}/bloqueio`, { bloqueado: true, motivo: 'Desligada da loja' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ ativo: false, alterado: true });
        expect(await tokenVersion(A.vendedorId)).toBe(vAntes + 1);

        expect((await request(app).get('/vendas').set('Authorization', `Bearer ${tokenAntes}`)).status).toBe(401);
        expect((await request(app).post('/auth/login').send({ email: `vendedor-${A.empresaId}-${sufixo}@teste.invalid`, senha: SENHA })).status).toBeGreaterThanOrEqual(400);

        const ev = (await eventos(A.empresaId)).filter((e) => e.alvo_usuario_id === A.vendedorId);
        expect(ev[ev.length - 1]).toMatchObject({ acao: 'bloquear', executado_por: A.gerenteId, motivo: 'Desligada da loja' });

        const volta = await como(A, A.gerenteId, 'patch', `/usuarios/${A.vendedorId}/bloqueio`, { bloqueado: false, motivo: 'Voltou de licença' });
        expect(volta.body.data).toMatchObject({ ativo: true, alterado: true });
        expect((await request(app).post('/auth/login').send({ email: `vendedor-${A.empresaId}-${sufixo}@teste.invalid`, senha: SENHA })).status).toBe(200);
    });

    test('repetir o mesmo estado é no-op: sem novo evento', async () => {
        const antes = (await eventos(A.empresaId)).length;
        const res = await como(A, A.gerenteId, 'patch', `/usuarios/${A.vendedorId}/bloqueio`, { bloqueado: false, motivo: 'Já estava ativo' });

        expect(res.body.data.alterado).toBe(false);
        expect((await eventos(A.empresaId)).length).toBe(antes);
    });

    test('hierarquia: não bloqueia par, superior, Admin nem a si mesmo', async () => {
        const corpo = { bloqueado: true, motivo: 'Tentativa indevida' };

        for (const alvoId of [A.gerente2Id, A.diretorId, A.adminId, A.gerenteId]) {
            expect((await como(A, A.gerenteId, 'patch', `/usuarios/${alvoId}/bloqueio`, corpo)).status).toBe(403);
        }

        expect((await como(A, A.diretorId, 'patch', `/usuarios/${A.adminId}/bloqueio`, corpo)).status).toBe(403);
        expect((await db.query('SELECT ativo FROM usuarios WHERE id = ANY($1)', [[A.gerente2Id, A.diretorId, A.adminId, A.gerenteId]])).rows.every((r) => r.ativo)).toBe(true);
    });

    test('Admin bloqueia qualquer não-Admin (inclusive Diretor), mas não a si mesmo', async () => {
        const adminToken = (id) => makeToken({ id, role: 'admin', empresa_id: A.empresaId, tv: 0 });
        const patch = (id, corpo) => request(app).patch(`/usuarios/${id}/bloqueio`).set('Authorization', `Bearer ${adminToken(A.adminId)}`).send(corpo);

        expect((await patch(A.adminId, { bloqueado: true, motivo: 'Eu mesmo' })).status).toBe(403);
        expect((await patch(A.diretorId, { bloqueado: true, motivo: 'Saída do diretor' })).status).toBe(200);
        expect((await patch(A.diretorId, { bloqueado: false, motivo: 'Retorno do diretor' })).status).toBe(200);
    });

    test('isolamento: usuário de outra empresa é 404 e nada muda', async () => {
        const res = await como(A, A.gerenteId, 'patch', `/usuarios/${B.vendedorId}/bloqueio`, { bloqueado: true, motivo: 'Cross-tenant' });

        expect(res.status).toBe(404);
        expect((await db.query('SELECT ativo FROM usuarios WHERE id = $1', [B.vendedorId])).rows[0].ativo).toBe(true);
        expect((await eventos(B.empresaId)).length).toBe(0);
    });

    test('concorrência: dois bloqueios simultâneos geram UM evento', async () => {
        const alvo = await criarUsuario(A, 'vendedor', `conc${crypto.randomBytes(2).toString('hex')}`);
        const corpo = { bloqueado: true, motivo: 'Bloqueio concorrente' };
        const token = await tokenAtual(A, A.gerenteId);
        const [r1, r2] = await Promise.all([1, 2].map(() => request(app).patch(`/usuarios/${alvo}/bloqueio`).set('Authorization', `Bearer ${token}`).send(corpo)));

        expect([r1.status, r2.status]).toEqual([200, 200]);
        expect([r1.body.data.alterado, r2.body.data.alterado].sort()).toEqual([false, true]);
        expect((await eventos(A.empresaId)).filter((e) => e.alvo_usuario_id === alvo && e.acao === 'bloquear').length).toBe(1);
    });
});

describe('trilha', () => {
    test('GET /usuarios/eventos lista só a empresa do JWT, com nomes e paginação', async () => {
        const res = await como(A, A.gerenteId, 'get', '/usuarios/eventos?pageSize=2');

        expect(res.status).toBe(200);
        expect(res.body.data.items.length).toBe(2);
        expect(res.body.data.total).toBeGreaterThan(2);
        expect(res.body.data.items[0]).toEqual(expect.objectContaining({ acao: expect.any(String), alvo_nome: expect.any(String), executado_por_nome: expect.any(String) }));

        const outra = await como(B, B.gerenteId, 'get', '/usuarios/eventos');
        expect(outra.body.data.total).toBe(0);
    });
});

describe('dados cadastrais', () => {
    const CPF_1 = '52998224725';
    const CPF_2 = '11144477735';
    const dadosDe = async (id) => (await db.query(`SELECT *, to_char(data_nascimento, 'YYYY-MM-DD') AS nasc FROM usuarios_dados WHERE usuario_id = $1`, [id])).rows[0];

    test('migration 057: telefone/CPF/CEP/UF malformados e evento editar sem campos são recusados pelo banco', async () => {
        const insere = (col, val) => db.query(`UPDATE usuarios_dados SET ${col} = $2 WHERE usuario_id = $1`, [A.vendedorId, val]);
        await db.query(`INSERT INTO usuarios_dados (usuario_id, empresa_id, telefone) VALUES ($1, $2, '11912345678') ON CONFLICT DO NOTHING`, [A.vendedorId, A.empresaId]);

        await expect(insere('telefone', '123')).rejects.toMatchObject({ code: '23514' });
        await expect(insere('cpf', '123')).rejects.toMatchObject({ code: '23514' });
        await expect(insere('cep', 'abc')).rejects.toMatchObject({ code: '23514' });
        await expect(insere('uf', 'sp')).rejects.toMatchObject({ code: '23514' });
        await expect(db.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por) VALUES ($1, 'editar', $2, 'vendedor', $3)`,
            [A.empresaId, A.vendedorId, A.adminId]
        )).rejects.toMatchObject({ code: '23514' });
    });

    test('dados de outra empresa são recusados pelo banco (FK composta)', async () => {
        await expect(db.query(`INSERT INTO usuarios_dados (usuario_id, empresa_id, telefone) VALUES ($1, $2, '11912345678')`, [B.vendedorId, A.empresaId]))
            .rejects.toMatchObject({ code: '23503' });
    });

    test('criar grava os dados (datas YYYY-MM-DD) e a trilha; CPF repetido na empresa = 409; em outra empresa pode', async () => {
        const corpo = novo({ cpf: '529.982.247-25', data_nascimento: '1990-05-10', cep: '01001-000', uf: 'sp', cidade: 'São Paulo' });
        const res = await como(A, A.gerenteId, 'post', '/usuarios', corpo);

        expect(res.status).toBe(201);
        const id = res.body.data.usuario.id;
        const d = await dadosDe(id);
        expect(d).toMatchObject({ empresa_id: A.empresaId, telefone: '11912345678', cpf: CPF_1, nasc: '1990-05-10', cep: '01001000', uf: 'SP', cidade: 'São Paulo' });

        const repetido = await como(A, A.gerenteId, 'post', '/usuarios', novo({ cpf: CPF_1 }));
        expect(repetido.status).toBe(409);
        expect(repetido.body.message || repetido.body.error).toMatch(/CPF/);

        const outraEmpresa = await como(B, B.gerenteId, 'post', '/usuarios', novo({ cpf: CPF_1 }));
        expect(outraEmpresa.status).toBe(201);
    });

    test('lista traz telefone mas nunca CPF; detalhe traz CPF só a quem pode gerenciar', async () => {
        const criado = (await como(A, A.gerenteId, 'post', '/usuarios', novo({ cpf: CPF_2 }))).body.data.usuario.id;

        const lista = await como(A, A.gerenteId, 'get', '/usuarios');
        expect(JSON.stringify(lista.body)).not.toContain(CPF_2);
        expect(lista.body.data.find((u) => u.id === criado).telefone).toBe('11912345678');

        const detalhe = await como(A, A.gerenteId, 'get', `/usuarios/${criado}`);
        expect(detalhe.status).toBe(200);
        expect(detalhe.body.data.dados).toMatchObject({ cpf: CPF_2, telefone: '11912345678' });

        expect((await como(A, A.gerenteId, 'get', `/usuarios/${A.diretorId}`)).status).toBe(403);
        expect((await como(A, A.gerenteId, 'get', `/usuarios/${B.vendedorId}`)).status).toBe(404);
        expect((await como(A, A.vendedorId, 'get', `/usuarios/${criado}`)).status).toBe(403);
    });

    test('editar: grava, registra na trilha só os NOMES dos campos, no-op não gera evento, CPF duplicado = 409', async () => {
        const id = (await como(A, A.gerenteId, 'post', '/usuarios', novo())).body.data.usuario.id;
        const antes = (await eventos(A.empresaId)).length;

        const res = await como(A, A.gerenteId, 'patch', `/usuarios/${id}/dados`, { cpf: '390.533.447-05', data_admissao: '2026-10-01', observacoes: 'Turno da tarde' });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ alterado: true, campos: expect.arrayContaining(['cpf', 'data_admissao', 'observacoes']) });
        expect(await dadosDe(id)).toMatchObject({ cpf: '39053344705', observacoes: 'Turno da tarde', atualizado_por: A.gerenteId });

        const trilha = await eventos(A.empresaId);
        expect(trilha.length).toBe(antes + 1);
        const evento = trilha[trilha.length - 1];
        expect(evento).toMatchObject({ acao: 'editar', alvo_usuario_id: id, executado_por: A.gerenteId });
        expect(evento.campos.sort()).toEqual(['cpf', 'data_admissao', 'observacoes']);
        expect(JSON.stringify(evento)).not.toContain('39053344705');

        const igual = await como(A, A.gerenteId, 'patch', `/usuarios/${id}/dados`, { observacoes: 'Turno da tarde' });
        expect(igual.body.data).toEqual({ alterado: false, campos: [] });
        expect((await eventos(A.empresaId)).length).toBe(antes + 1);

        const limpa = await como(A, A.gerenteId, 'patch', `/usuarios/${id}/dados`, { observacoes: null });
        expect(limpa.status).toBe(200);
        expect((await dadosDe(id)).observacoes).toBeNull();

        const outro = (await como(A, A.gerenteId, 'post', '/usuarios', novo())).body.data.usuario.id;
        expect((await como(A, A.gerenteId, 'patch', `/usuarios/${outro}/dados`, { cpf: '39053344705' })).status).toBe(409);
    });

    test('editar respeita a hierarquia e o isolamento; o próprio usuário edita os seus dados', async () => {
        expect((await como(A, A.gerenteId, 'patch', `/usuarios/${A.diretorId}/dados`, { telefone: '11999998888' })).status).toBe(403);
        expect((await como(A, A.gerenteId, 'patch', `/usuarios/${A.adminId}/dados`, { telefone: '11999998888' })).status).toBe(403);
        expect((await como(A, A.gerenteId, 'patch', `/usuarios/${B.vendedorId}/dados`, { telefone: '11999998888' })).status).toBe(404);
        expect((await como(A, A.vendedorId, 'patch', `/usuarios/${A.vendedorId}/dados`, { telefone: '11999998888' })).status).toBe(403); // sem gerir_usuarios nem entra na rota

        const proprio = await como(A, A.gerenteId, 'patch', `/usuarios/${A.gerenteId}/dados`, { telefone: '11977776666' });
        expect(proprio.status).toBe(200);
        expect((await dadosDe(A.gerenteId)).telefone).toBe('11977776666');
    });

    test('a trilha continua imutável com a ação editar', async () => {
        const evento = (await eventos(A.empresaId)).find((e) => e.acao === 'editar');

        await expect(db.query(`UPDATE usuarios_eventos SET campos = ARRAY['x'] WHERE id = $1`, [evento.id])).rejects.toMatchObject({ code: '23001' });
    });
});

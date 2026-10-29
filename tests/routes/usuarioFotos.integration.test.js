// Integração de verdade (Postgres da CI/dev): migration 075 + foto de perfil do usuário. O armazenamento (R2) é
// substituído por um espelho em memória: o que se prova aqui é a regra do backend — chave com o empresa_id do JWT,
// troca apagando a foto anterior, validação do arquivo, trilha (só o NOME do campo), hierarquia (própria foto,
// gestor sobre cargo abaixo, nunca Admin por aqui), isolamento entre empresas e `foto_url` nas respostas.
// Empresas e usuários próprios e temporários.
jest.unmock('../../src/repositories/sessaoRepository');

const mockObjetos = new Map();
jest.mock('../../src/services/storage/imagensStorage', () => ({
    configurado: jest.fn(() => true),
    urlPublica: (chave) => (chave ? `https://fotos.exemplo.test/${chave}` : null),
    enviar: jest.fn(async ({ chave, buffer }) => { mockObjetos.set(chave, buffer); }),
    remover: jest.fn(async (chave) => { mockObjetos.delete(chave); })
}));

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const storage = require('../../src/services/storage/imagensStorage');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const A = { u: {} };
const B = { u: {} };

const jpeg = (marca = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, marca)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const gif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200, 1)]);

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Fotos ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
}

async function criarUsuario(alvo, chave, papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${chave} ${sufixo}`, `${chave}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[chave] = rows[0].id;
    alvo.papel = { ...(alvo.papel || {}), [chave]: papel };
}

const auth = (alvo, chave) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[chave], role: alvo.papel[chave], empresa_id: alvo.empresaId, tv: 0 })}` });
const propria = (alvo, chave, buffer = jpeg(), nome = 'foto.jpg') =>
    request(app).put('/auth/foto').set(auth(alvo, chave)).attach('arquivo', buffer, nome);
const deOutro = (alvo, chaveAtor, alvoId, buffer = jpeg(), nome = 'foto.jpg') =>
    request(app).put(`/usuarios/${alvoId}/foto`).set(auth(alvo, chaveAtor)).attach('arquivo', buffer, nome);

const fotoDoBanco = async (usuarioId) => (await db.query('SELECT * FROM usuarios_fotos WHERE usuario_id = $1', [usuarioId])).rows[0];
const eventosFoto = async (alvoId) => (await db.query(
    `SELECT acao, executado_por, campos, motivo FROM usuarios_eventos WHERE alvo_usuario_id = $1 AND 'foto' = ANY(campos) ORDER BY id`, [alvoId]
)).rows;

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    await criarUsuario(A, 'admin', 'admin');
    await criarUsuario(A, 'admin2', 'admin');
    await criarUsuario(A, 'vend1', 'vendedor');
    await criarUsuario(A, 'vend2', 'vendedor');
    await criarUsuario(A, 'estoq', 'estoquista');
    await criarUsuario(B, 'admin', 'admin');
});

beforeEach(() => {
    jest.clearAllMocks();
    storage.configurado.mockReturnValue(true);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('a própria foto (PUT /auth/foto)', () => {
    test('qualquer cargo envia: chave com o empresa_id do JWT, objeto no bucket, trilha só com o nome do campo', async () => {
        const res = await propria(A, 'estoq', jpeg(1));

        expect(res.status).toBe(200);

        const linha = await fotoDoBanco(A.u.estoq);
        expect(linha.chave).toMatch(new RegExp(`^${A.empresaId}/usuarios/${A.u.estoq}/[0-9a-f-]{36}\\.jpg$`));
        expect(linha).toMatchObject({ empresa_id: A.empresaId, content_type: 'image/jpeg', atualizado_por: A.u.estoq });
        expect(mockObjetos.has(linha.chave)).toBe(true);
        expect(res.body.data.foto_url).toBe(`https://fotos.exemplo.test/${linha.chave}`);

        const eventos = await eventosFoto(A.u.estoq);
        expect(eventos).toEqual([{ acao: 'editar', executado_por: A.u.estoq, campos: ['foto'], motivo: null }]);
    });

    test('aceita PNG e WebP; trocar a foto cria chave nova e apaga o objeto anterior', async () => {
        await propria(A, 'vend1', jpeg(1));
        const antes = (await fotoDoBanco(A.u.vend1)).chave;

        const res = await propria(A, 'vend1', png(), 'qualquer.png');
        expect(res.status).toBe(200);

        const depois = await fotoDoBanco(A.u.vend1);
        expect(depois.chave).not.toBe(antes);
        expect(depois.chave).toMatch(/\.png$/);
        expect(mockObjetos.has(antes)).toBe(false);
        expect(mockObjetos.has(depois.chave)).toBe(true);
        expect((await db.query('SELECT COUNT(*)::int AS n FROM usuarios_fotos WHERE usuario_id = $1', [A.u.vend1])).rows[0].n).toBe(1);
    });

    test('o nome e o content-type enviados não valem: confere os bytes (GIF disfarçado de .jpg é recusado)', async () => {
        const res = await propria(A, 'vend2', gif(), 'foto.jpg');

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/JPEG, PNG ou WebP/);
        expect(storage.enviar).not.toHaveBeenCalled();
        expect(await fotoDoBanco(A.u.vend2)).toBeUndefined();
    });

    test('sem arquivo, 400; acima de 2 MB, 413; sem bucket configurado, 412', async () => {
        const semArquivo = await request(app).put('/auth/foto').set(auth(A, 'vend2'));
        expect(semArquivo.status).toBe(400);

        const grande = await propria(A, 'vend2', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2 * 1024 * 1024 + 1, 7)]));
        expect(grande.status).toBe(413);

        storage.configurado.mockReturnValue(false);
        const semBucket = await propria(A, 'vend2');
        expect(semBucket.status).toBe(412);

        expect(await fotoDoBanco(A.u.vend2)).toBeUndefined();
    });

    test('sem token, 401', async () => {
        const res = await request(app).put('/auth/foto').attach('arquivo', jpeg(), 'foto.jpg');

        expect(res.status).toBe(401);
    });

    test('remover apaga a linha e o objeto, registra a trilha; remover de novo é no-op sem evento', async () => {
        await propria(A, 'vend2', jpeg(3));
        const { chave } = await fotoDoBanco(A.u.vend2);

        const r1 = await request(app).delete('/auth/foto').set(auth(A, 'vend2'));
        expect(r1.status).toBe(200);
        expect(r1.body.data).toEqual({ foto_url: null });
        expect(await fotoDoBanco(A.u.vend2)).toBeUndefined();
        expect(mockObjetos.has(chave)).toBe(false);
        expect(await eventosFoto(A.u.vend2)).toHaveLength(2);

        const r2 = await request(app).delete('/auth/foto').set(auth(A, 'vend2'));
        expect(r2.status).toBe(200);
        expect(await eventosFoto(A.u.vend2)).toHaveLength(2);
    });
});

describe('foto de outro usuário (/usuarios/:id/foto)', () => {
    test('admin define e remove a foto de um vendedor da própria empresa; a trilha mostra quem fez', async () => {
        const res = await deOutro(A, 'admin', A.u.vend2, jpeg(4));

        expect(res.status).toBe(200);
        expect((await fotoDoBanco(A.u.vend2)).atualizado_por).toBe(A.u.admin);

        const eventos = await eventosFoto(A.u.vend2);
        expect(eventos[eventos.length - 1]).toMatchObject({ acao: 'editar', executado_por: A.u.admin, campos: ['foto'] });

        const del = await request(app).delete(`/usuarios/${A.u.vend2}/foto`).set(auth(A, 'admin'));
        expect(del.status).toBe(200);
        expect(await fotoDoBanco(A.u.vend2)).toBeUndefined();
    });

    test('sem a capacidade gerir_usuarios (vendedor, estoquista), 403 — e nada vai ao bucket', async () => {
        const res = await deOutro(A, 'vend1', A.u.vend2);

        expect(res.status).toBe(403);
        expect(storage.enviar).not.toHaveBeenCalled();
    });

    test('Admin não é gerenciado por aqui (nem por outro Admin): 403 e nada é gravado', async () => {
        const res = await deOutro(A, 'admin', A.u.admin2);

        expect(res.status).toBe(403);
        expect(storage.enviar).not.toHaveBeenCalled();
        expect(await fotoDoBanco(A.u.admin2)).toBeUndefined();
    });

    test('o Admin pode trocar a própria foto, também por /usuarios/:id/foto', async () => {
        const res = await deOutro(A, 'admin', A.u.admin);

        expect(res.status).toBe(200);
        expect((await fotoDoBanco(A.u.admin)).atualizado_por).toBe(A.u.admin);
    });

    test('isolamento: admin de outra empresa recebe 404 e a foto do usuário de A não muda', async () => {
        const antes = await fotoDoBanco(A.u.vend1);

        const res = await deOutro(B, 'admin', A.u.vend1);

        expect(res.status).toBe(404);
        expect(storage.enviar).not.toHaveBeenCalled();
        expect(await fotoDoBanco(A.u.vend1)).toEqual(antes);

        const del = await request(app).delete(`/usuarios/${A.u.vend1}/foto`).set(auth(B, 'admin'));
        expect(del.status).toBe(404);
        expect(await fotoDoBanco(A.u.vend1)).toEqual(antes);
    });

    test('id inválido, 400; usuário inexistente, 404', async () => {
        expect((await request(app).put('/usuarios/abc/foto').set(auth(A, 'admin')).attach('arquivo', jpeg(), 'f.jpg')).status).toBe(400);
        expect((await deOutro(A, 'admin', 999999999)).status).toBe(404);
    });
});

describe('foto_url nas respostas', () => {
    test('/auth/me, lista, detalhe e trilha de usuários devolvem a url (ou null)', async () => {
        await propria(A, 'vend1', jpeg(9));
        const { chave } = await fotoDoBanco(A.u.vend1);
        const url = `https://fotos.exemplo.test/${chave}`;

        const me = await request(app).get('/auth/me').set(auth(A, 'vend1'));
        expect(me.body.data.foto_url).toBe(url);

        const semFoto = await request(app).get('/auth/me').set(auth(A, 'admin2'));
        expect(semFoto.body.data.foto_url).toBeNull();

        const lista = await request(app).get('/usuarios').set(auth(A, 'admin'));
        expect(lista.body.data.find((u) => u.id === A.u.vend1).foto_url).toBe(url);
        expect(lista.body.data.find((u) => u.id === A.u.admin2).foto_url).toBeNull();

        const detalhe = await request(app).get(`/usuarios/${A.u.vend1}`).set(auth(A, 'admin'));
        expect(detalhe.body.data.foto_url).toBe(url);

        const eventos = await request(app).get('/usuarios/eventos').set(auth(A, 'admin'));
        const item = eventos.body.data.items.find((e) => e.alvo_usuario_id === A.u.vend1 && e.campos?.includes('foto'));
        expect(item.alvo_foto_url).toBe(url);
        expect(Object.keys(item)).not.toContain('alvo_foto_chave');
        expect(Object.keys(item)).not.toContain('executado_por_foto_chave');
    });

    test('a lista de uma empresa nunca mostra foto de outra', async () => {
        const lista = await request(app).get('/usuarios').set(auth(B, 'admin'));

        expect(lista.body.data.every((u) => u.foto_url === null)).toBe(true);
    });
});

// Integração de verdade (Postgres de testes): retratos da abertura da Home geridos pelo ERP.
// Prova: só admin com a funcionalidade ligada gerencia; nasce inativo e sem autorização; só vai à loja pública o retrato
// ATIVO e AUTORIZADO (com quem e quando confirmou registrados); revogar a autorização desativa; remover tira da loja e do
// armazenamento; isolamento entre empresas; validação do arquivo. O armazenamento (R2) é um espelho em memória.
jest.unmock('../../src/repositories/sessaoRepository');

const mockObjetos = new Map();
jest.mock('../../src/services/storage/imagensStorage', () => ({
    configurado: jest.fn(() => true),
    urlPublica: (chave) => (chave ? `https://fotos.exemplo.test/${chave}` : null),
    enviar: jest.fn(async ({ chave, buffer }) => { mockObjetos.set(chave, buffer); }),
    remover: jest.fn(async (chave) => { mockObjetos.delete(chave); })
}));

const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { slug: `teste-ret-a-${sufixo}`, nome: 'Retratos A' };
const B = { slug: `teste-ret-b-${sufixo}`, nome: 'Retratos B' };
const SEM_FLAG = { slug: `teste-ret-c-${sufixo}`, nome: 'Retratos Sem Flag' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const webp = (marca = 0) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100, marca)]);
const gif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100, 1)]);

async function criarEmpresa(E, { comFlag = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, E.slug]));
    E.usuarios = {};
    for (const papel of ['admin', 'vendedor']) {
        const id = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, `${papel} ${E.nome}`, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.usuarios[papel] = { id, token: makeToken({ id, role: papel, empresa_id: E.id, tv: 0 }) };
    }
    if (comFlag) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

const como = (E, papel = 'admin') => ({ Authorization: `Bearer ${E.usuarios[papel].token}` });
const listar = (E) => request(app).get('/loja-retratos').set(como(E));
const publicos = (E) => request(app).get(`/loja/${E.slug}/retratos`);
const enviar = (E, { alt, nome, arquivo = webp(), papel = 'admin' } = {}) => {
    const r = request(app).post('/loja-retratos').set(como(E, papel));
    if (alt !== undefined) r.field('alt', alt);
    if (nome !== undefined) r.field('nome', nome);
    return r.attach('arquivo', arquivo, { filename: 'qualquer-nome.webp', contentType: 'image/webp' });
};
const patch = (E, id, corpo, papel = 'admin') => request(app).patch(`/loja-retratos/${id}`).set(como(E, papel)).send(corpo);

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await criarEmpresa(SEM_FLAG, { comFlag: false });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('quem pode gerir', () => {
    test('sem token 401; vendedor 403; sem a funcionalidade 403; admin 200', async () => {
        expect((await request(app).get('/loja-retratos')).status).toBe(401);
        expect((await listar({ ...A, usuarios: { admin: A.usuarios.vendedor } })).status).toBe(403);
        expect((await listar(SEM_FLAG)).status).toBe(403);
        expect((await listar(A)).status).toBe(200);
        expect((await enviar(A, { papel: 'vendedor' })).status).toBe(403);
    });
});

describe('ciclo do retrato', () => {
    let id;

    test('envia a foto: nasce inativa e sem autorização, com chave do próprio empresa_id (nome do cliente ignorado)', async () => {
        const res = await enviar(A, { alt: '  Retrato de um homem de barba  ', nome: '' });

        expect(res.status).toBe(201);
        id = res.body.data.id;
        expect(res.body.data).toMatchObject({ alt: 'Retrato de um homem de barba', nome: null, ativo: false, autorizacao_assinada: false, autorizado_por: null, autorizado_em: null });
        expect(res.body.data.url).toContain(`/${A.id}/retratos/`);
        expect(res.body.data.url).not.toContain('qualquer-nome');
        expect(mockObjetos.size).toBeGreaterThan(0);
        expect((await publicos(A)).body.data).toEqual([]);
    });

    test('não dá para ativar sem confirmar a autorização (409), nem confirmar e ativar sem descrição', async () => {
        expect((await patch(A, id, { ativo: true })).status).toBe(409);

        const { body } = await enviar(A);
        const semAlt = await patch(A, body.data.id, { autorizacao_assinada: true, ativo: true });
        expect(semAlt.status).toBe(409);
        expect(semAlt.body.message).toMatch(/descreva/i);
        await request(app).delete(`/loja-retratos/${body.data.id}`).set(como(A));
    });

    test('confirmar a autorização registra QUEM e QUANDO; ativar leva à loja pública (só url, alt e nome)', async () => {
        const res = await patch(A, id, { autorizacao_assinada: true, ativo: true, nome: 'Fulano' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ ativo: true, autorizacao_assinada: true, autorizado_por: `admin ${A.nome}`, nome: 'Fulano' });
        expect(res.body.data.autorizado_em).not.toBeNull();

        const pub = await publicos(A);
        expect(pub.body.data).toHaveLength(1);
        expect(Object.keys(pub.body.data[0]).sort()).toEqual(['alt', 'nome', 'url']);
        expect(JSON.stringify(pub.body)).not.toMatch(/autoriza|criado|chave|empresa|admin/i);
    });

    test('revogar a autorização desativa o retrato na hora e limpa quem/quando', async () => {
        const res = await patch(A, id, { autorizacao_assinada: false });

        expect(res.body.data).toMatchObject({ ativo: false, autorizacao_assinada: false, autorizado_por: null, autorizado_em: null });
        expect((await publicos(A)).body.data).toEqual([]);
    });

    test('desativar sem revogar tira da loja; reativar volta (a confirmação anterior não se perde)', async () => {
        await patch(A, id, { autorizacao_assinada: true, ativo: true });
        expect((await patch(A, id, { ativo: false })).body.data).toMatchObject({ ativo: false, autorizacao_assinada: true });
        expect((await publicos(A)).body.data).toEqual([]);
        expect((await patch(A, id, { ativo: true })).body.data.ativo).toBe(true);
        expect((await publicos(A)).body.data).toHaveLength(1);
    });

    test('ordem: o público segue a ordem da gestão', async () => {
        const outro = (await enviar(A, { alt: 'Segunda foto' })).body.data.id;
        await patch(A, outro, { autorizacao_assinada: true, ativo: true });
        await patch(A, outro, { ordem: 0 });
        await patch(A, id, { ordem: 5 });

        expect((await publicos(A)).body.data.map((r) => r.alt)).toEqual(['Segunda foto', 'Retrato de um homem de barba']);
        await request(app).delete(`/loja-retratos/${outro}`).set(como(A));
    });

    test('remover tira da loja e do armazenamento; a linha fica como trilha', async () => {
        const chaves = [...mockObjetos.keys()];
        const del = await request(app).delete(`/loja-retratos/${id}`).set(como(A));

        expect(del.status).toBe(200);
        expect((await publicos(A)).body.data).toEqual([]);
        expect((await listar(A)).body.data.find((r) => r.id === id)).toBeUndefined();
        expect([...mockObjetos.keys()].length).toBeLessThan(chaves.length);
        expect((await db.query('SELECT removido_em, ativo FROM loja_retratos WHERE id = $1', [id])).rows[0]).toMatchObject({ ativo: false });
        expect((await request(app).delete(`/loja-retratos/${id}`).set(como(A))).status).toBe(404);
    });
});

describe('segurança e validação', () => {
    test('uma empresa nunca vê nem mexe no retrato da outra', async () => {
        const meu = (await enviar(A, { alt: 'Foto da A' })).body.data.id;
        await patch(A, meu, { autorizacao_assinada: true, ativo: true });

        expect((await listar(B)).body.data).toEqual([]);
        expect((await publicos(B)).body.data).toEqual([]);
        expect((await patch(B, meu, { nome: 'invasor' })).status).toBe(404);
        expect((await request(app).delete(`/loja-retratos/${meu}`).set(como(B))).status).toBe(404);
        expect((await publicos(A)).body.data.map((r) => r.alt)).toContain('Foto da A');
    });

    test('arquivo que não é JPEG/PNG/WebP é 400; sem arquivo é 400; id inválido é 404; corpo desconhecido é 400', async () => {
        expect((await enviar(A, { arquivo: gif() })).status).toBe(400);
        expect((await request(app).post('/loja-retratos').set(como(A)).field('alt', 'x')).status).toBe(400);
        expect((await patch(A, 'abc', { ativo: true })).status).toBe(404);

        const id = (await enviar(A, { alt: 'x' })).body.data.id;
        expect((await patch(A, id, { empresa_id: 99 })).status).toBe(400);
        expect((await patch(A, id, { autorizacao_assinada: 'sim' })).status).toBe(400);
        expect((await patch(A, id, { alt: 'x'.repeat(301) })).status).toBe(400);
    });

    test('o banco também barra ativo sem autorização (defesa em profundidade)', async () => {
        const id = (await enviar(A, { alt: 'y' })).body.data.id;
        await expect(db.query('UPDATE loja_retratos SET ativo = true WHERE id = $1', [id])).rejects.toThrow();
    });

    test('a rota pública só responde para loja ativa com a funcionalidade (404 igual aos demais)', async () => {
        expect((await request(app).get(`/loja/${SEM_FLAG.slug}/retratos`)).status).toBe(404);
        expect((await request(app).get('/loja/nao-existe/retratos')).status).toBe(404);
    });
});

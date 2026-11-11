// Integração de verdade (Postgres de testes): faixas (banners) rotativas da Home geridas pelo ERP.
// Prova: só admin com a funcionalidade ligada gerencia; nasce vazia e inativa; só vai à loja a faixa ativa, com conteúdo e dentro
// da janela de datas; validação dura de link (caminho da loja ou https), botão, datas e imagens; no máximo 6 por empresa;
// trocar/remover imagem apaga o arquivo antigo; isolamento entre empresas. O armazenamento (R2) é um espelho em memória.
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
const A = { slug: `teste-ban-a-${sufixo}`, nome: 'Banners A' };
const B = { slug: `teste-ban-b-${sufixo}`, nome: 'Banners B' };
const SEM_FLAG = { slug: `teste-ban-c-${sufixo}`, nome: 'Banners Sem Flag' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const webp = (marca = 0) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100, marca)]);
const gif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100, 1)]);

async function criarEmpresa(E, { comFlag = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, E.slug]));
    E.usuarios = {};
    for (const papel of ['admin', 'vendedor']) {
        const id = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, papel, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.usuarios[papel] = { id, token: makeToken({ id, role: papel, empresa_id: E.id, tv: 0 }) };
    }
    if (comFlag) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

const como = (E, papel = 'admin') => ({ Authorization: `Bearer ${E.usuarios[papel].token}` });
const listar = (E, papel) => request(app).get('/loja-banners').set(como(E, papel));
const criar = (E, corpo = {}, papel) => request(app).post('/loja-banners').set(como(E, papel)).send(corpo);
const patch = (E, id, corpo, papel) => request(app).patch(`/loja-banners/${id}`).set(como(E, papel)).send(corpo);
const imagem = (E, id, lado, arquivo = webp()) => request(app).put(`/loja-banners/${id}/imagem/${lado}`).set(como(E)).attach('arquivo', arquivo, { filename: 'qualquer-nome.webp', contentType: 'image/webp' });
const publico = (E) => request(app).get(`/loja/${E.slug}/banners`);
const limpar = async (E) => db.query('UPDATE loja_banners SET removido_em = NOW(), ativo = false WHERE empresa_id = $1 AND removido_em IS NULL', [E.id]);

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
        expect((await request(app).get('/loja-banners')).status).toBe(401);
        expect((await listar(A, 'vendedor')).status).toBe(403);
        expect((await criar(A, {}, 'vendedor')).status).toBe(403);
        expect((await listar(SEM_FLAG)).status).toBe(403);
        expect((await listar(A)).status).toBe(200);
    });
});

describe('ciclo da faixa', () => {
    let id;

    test('nasce vazia e inativa, no fim da fila; o público não a mostra', async () => {
        const res = await criar(A, { rotulo: '  COMEÇOU  ', titulo: 'Promoção TESTE' });

        expect(res.status).toBe(201);
        id = res.body.data.id;
        expect(res.body.data).toMatchObject({ ativo: false, rotulo: 'COMEÇOU', titulo: 'Promoção TESTE', fundo: 'vinho', usa_retrato: false, imagem_esquerda: null, imagem_direita: null });
        expect((await publico(A)).body.data).toEqual([]);
        expect((await criar(A, { ativo: true, titulo: 'x' })).status).toBe(400);
    });

    test('ativar leva à loja pública, só com os campos de exibição (nada interno)', async () => {
        const res = await patch(A, id, { ativo: true, destaque: 'até 50% off', botao_texto: 'comprar', link: '/produtos?novidades=true', rodape_texto: '*Consulte o regulamento (TESTE)', fundo: 'ouro' });

        expect(res.status).toBe(200);
        const pub = (await publico(A)).body.data;
        expect(pub).toEqual([{ fundo: 'ouro', rotulo: 'COMEÇOU', titulo: 'Promoção TESTE', destaque: 'até 50% off', botao_texto: 'comprar', link: '/produtos?novidades=true', rodape_texto: '*Consulte o regulamento (TESTE)' }]);
        expect(JSON.stringify(pub)).not.toMatch(/ativo|ordem|criado|empresa|chave|inicio|fim_em/i);
    });

    test('a janela de datas esconde a faixa antes do início e depois do fim', async () => {
        const amanha = new Date(Date.now() + 86400000).toISOString();
        const ontem = new Date(Date.now() - 86400000).toISOString();

        await patch(A, id, { inicio_em: amanha });
        expect((await publico(A)).body.data).toEqual([]);

        await patch(A, id, { inicio_em: null, fim_em: ontem });
        expect((await publico(A)).body.data).toEqual([]);

        await patch(A, id, { inicio_em: ontem, fim_em: amanha });
        expect((await publico(A)).body.data).toHaveLength(1);
    });

    test('regras: botão sem link, fim antes do início, ativar sem conteúdo e data inválida', async () => {
        const vazia = (await criar(A, {})).body.data.id;

        expect((await patch(A, vazia, { botao_texto: 'comprar' })).status).toBe(400);
        expect((await patch(A, vazia, { inicio_em: '2030-02-01T00:00:00Z', fim_em: '2030-01-01T00:00:00Z' })).status).toBe(400);
        expect((await patch(A, vazia, { inicio_em: 'amanhã' })).status).toBe(400);

        const sem = await patch(A, vazia, { ativo: true });
        expect(sem.status).toBe(409);
        expect(sem.body.message).toMatch(/texto ou uma imagem/i);

        expect((await patch(A, vazia, { ativo: true, usa_retrato: true })).status).toBe(200); // o retrato do dia já é conteúdo
        await request(app).delete(`/loja-banners/${vazia}`).set(como(A));
    });

    test.each([
        ['//evil.com/x', /Link inválido/],
        ['javascript:alert(1)', /Link inválido/],
        ['data:text/html,x', /Link inválido/],
        ['http://insegura.com', /Link inválido/],
        ['https://user:senha@site.com', /Link inválido/],
        ['produtos', /Link inválido/]
    ])('rejeita o link %s', async (link, mensagem) => {
        const res = await patch(A, id, { link });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(mensagem);
    });

    test('aceita caminho da loja e https; rejeita cor, texto longo e campo desconhecido', async () => {
        expect((await patch(A, id, { link: 'https://www.instagram.com/perfil' })).status).toBe(200);
        expect((await patch(A, id, { link: '/produto/anel-1' })).status).toBe(200);
        expect((await patch(A, id, { fundo: 'neon' })).status).toBe(400);
        expect((await patch(A, id, { titulo: 'x'.repeat(101) })).status).toBe(400);
        expect((await patch(A, id, { empresa_id: 9 })).status).toBe(400);
        expect((await patch(A, 'abc', { rotulo: 'x' })).status).toBe(404);
    });

    test('ordem: o público segue a ordem da gestão', async () => {
        const segunda = (await criar(A, { titulo: 'Segunda TESTE' })).body.data.id;
        await patch(A, segunda, { ativo: true });
        await patch(A, segunda, { ordem: 0 });
        await patch(A, id, { ordem: 5 });

        expect((await publico(A)).body.data.map((b) => b.titulo)).toEqual(['Segunda TESTE', 'Promoção TESTE']);
        await request(app).delete(`/loja-banners/${segunda}`).set(como(A));
    });

    test('o banco também barra faixa ativa sem conteúdo (defesa em profundidade)', async () => {
        const vazia = (await criar(A, {})).body.data.id;
        await expect(db.query('UPDATE loja_banners SET ativo = true WHERE id = $1', [vazia])).rejects.toThrow();
        await request(app).delete(`/loja-banners/${vazia}`).set(como(A));
    });
});

describe('imagens', () => {
    let id;

    beforeAll(async () => {
        await limpar(A);
        id = (await criar(A, { titulo: 'Com imagens TESTE' })).body.data.id;
    });

    test('envia a imagem de cada lado: chave com o empresa_id do JWT (nome do cliente ignorado); o público recebe a URL', async () => {
        const esq = await imagem(A, id, 'esquerda');
        expect(esq.status).toBe(200);
        expect(esq.body.data.imagem_esquerda).toContain(`/${A.id}/banners/`);
        expect(esq.body.data.imagem_esquerda).not.toContain('qualquer-nome');

        await imagem(A, id, 'direita', webp(2));
        await patch(A, id, { ativo: true });

        const pub = (await publico(A)).body.data[0];
        expect(pub.imagem_esquerda).toMatch(/^https:\/\/fotos\.exemplo\.test\//);
        expect(pub.imagem_direita).toMatch(/^https:\/\/fotos\.exemplo\.test\//);
    });

    test('trocar a imagem apaga o arquivo antigo do armazenamento', async () => {
        const antes = (await listar(A)).body.data.find((b) => b.id === id).imagem_esquerda.split('exemplo.test/')[1];
        expect(mockObjetos.has(antes)).toBe(true);

        const nova = await imagem(A, id, 'esquerda', webp(9));
        expect(nova.status).toBe(200);
        expect(mockObjetos.has(antes)).toBe(false);
    });

    test('remover a imagem apaga o arquivo; faixa ativa que ficaria sem nenhum conteúdo não deixa (409)', async () => {
        const solo = (await criar(A, {})).body.data.id;
        await imagem(A, solo, 'direita');
        await patch(A, solo, { ativo: true });

        const bloqueio = await request(app).delete(`/loja-banners/${solo}/imagem/direita`).set(como(A));
        expect(bloqueio.status).toBe(409);

        await patch(A, solo, { titulo: 'Agora tem texto TESTE' });
        const chave = (await listar(A)).body.data.find((b) => b.id === solo).imagem_direita.split('exemplo.test/')[1];
        const ok = await request(app).delete(`/loja-banners/${solo}/imagem/direita`).set(como(A));
        expect(ok.status).toBe(200);
        expect(ok.body.data.imagem_direita).toBeNull();
        expect(mockObjetos.has(chave)).toBe(false);
    });

    test('a imagem central (foto dos itens): envia, vai ao público como imagem_centro e conta como conteúdo; lado inexistente é 400', async () => {
        const centro = (await criar(A, {})).body.data.id;
        const so = await imagem(A, centro, 'centro');

        expect(so.status).toBe(200);
        expect(so.body.data.imagem_centro).toContain(`/${A.id}/banners/`);
        expect((await patch(A, centro, { ativo: true })).status).toBe(200); // a imagem central basta para ligar a faixa

        const pub = (await publico(A)).body.data.find((b) => b.imagem_centro);
        expect(pub.imagem_centro).toMatch(/^https:\/\/fotos\.exemplo\.test\//);
        expect((await imagem(A, centro, 'meio')).status).toBe(400);
        expect((await imagem(A, centro, '__proto__')).status).toBe(400);

        const chave = so.body.data.imagem_centro.split('exemplo.test/')[1];
        const bloqueio = await request(app).delete(`/loja-banners/${centro}/imagem/centro`).set(como(A));
        expect(bloqueio.status).toBe(409); // faixa ativa que ficaria vazia
        await request(app).delete(`/loja-banners/${centro}`).set(como(A));
        expect(mockObjetos.has(chave)).toBe(false);
    });

    test('arquivo que não é JPEG/PNG/WebP é 400; sem arquivo é 400; lado inválido é 400; faixa inexistente é 404', async () => {
        expect((await imagem(A, id, 'esquerda', gif())).status).toBe(400);
        expect((await request(app).put(`/loja-banners/${id}/imagem/esquerda`).set(como(A))).status).toBe(400);
        expect((await imagem(A, id, 'meio')).status).toBe(400);
        expect((await imagem(A, 999999, 'esquerda')).status).toBe(404);
    });

    test('remover a faixa tira da loja e apaga os arquivos; a linha fica como trilha', async () => {
        const chaves = [...mockObjetos.keys()].length;
        const del = await request(app).delete(`/loja-banners/${id}`).set(como(A));

        expect(del.status).toBe(200);
        expect((await publico(A)).body.data.find((b) => b.titulo === 'Com imagens TESTE')).toBeUndefined();
        expect([...mockObjetos.keys()].length).toBeLessThan(chaves);
        expect((await request(app).delete(`/loja-banners/${id}`).set(como(A))).status).toBe(404);
        expect((await db.query('SELECT removido_em FROM loja_banners WHERE id = $1', [id])).rows[0].removido_em).not.toBeNull();
    });
});

describe('limites e isolamento', () => {
    test('no máximo 6 faixas por empresa (a 7ª é 409; remover libera)', async () => {
        await limpar(A);
        const ids = [];
        for (let i = 0; i < 6; i += 1) ids.push((await criar(A, { titulo: `F${i}` })).body.data.id);

        const setima = await criar(A, { titulo: 'F7' });
        expect(setima.status).toBe(409);
        expect(setima.body.message).toMatch(/6 faixas/);

        await request(app).delete(`/loja-banners/${ids[0]}`).set(como(A));
        expect((await criar(A, { titulo: 'F7' })).status).toBe(201);
        await limpar(A);
    });

    test('uma empresa nunca vê nem mexe na faixa da outra', async () => {
        const minha = (await criar(A, { titulo: 'Da A TESTE' })).body.data.id;
        await patch(A, minha, { ativo: true });

        expect((await listar(B)).body.data).toEqual([]);
        expect((await publico(B)).body.data).toEqual([]);
        expect((await patch(B, minha, { titulo: 'invasor' })).status).toBe(404);
        expect((await request(app).delete(`/loja-banners/${minha}`).set(como(B))).status).toBe(404);
        expect((await imagem(B, minha, 'esquerda')).status).toBe(404);
        expect((await publico(A)).body.data.map((b) => b.titulo)).toContain('Da A TESTE');
    });

    test('a rota pública só responde para loja ativa com a funcionalidade (404 igual aos demais)', async () => {
        expect((await request(app).get(`/loja/${SEM_FLAG.slug}/banners`)).status).toBe(404);
        expect((await request(app).get('/loja/nao-existe/banners')).status).toBe(404);
    });
});

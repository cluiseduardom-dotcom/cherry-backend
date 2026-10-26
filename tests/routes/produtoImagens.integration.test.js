// Integração de verdade (Postgres da CI/dev): migration 066 + fotos de produto. O armazenamento (R2) é
// substituído por um espelho em memória: o que se prova aqui é a regra do backend — chave com o empresa_id do
// JWT, limite de 5 sob concorrência, isolamento entre empresas, RBAC, validação do arquivo, ordem/principal e
// que a foto aparece como `imagem_url` na listagem. Empresas e usuários próprios e temporários.
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

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Imagens ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.produtoId = (await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 50, 10, 0) RETURNING id`,
        [alvo.empresaId, `Produto ${rotulo} ${sufixo}`]
    )).rows[0].id;
    await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true)`, [alvo.empresaId]);
}

async function criarUsuario(alvo, papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[papel] = rows[0].id;
}

const auth = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const enviar = (alvo, papel, produtoId, buffer = jpeg(), nome = 'foto.jpg') =>
    request(app).post(`/produtos/${produtoId}/imagens`).set(auth(alvo, papel)).attach('arquivo', buffer, nome);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    for (const alvo of [A, B]) {
        await criarUsuario(alvo, 'admin');
        await criarUsuario(alvo, 'estoquista');
        await criarUsuario(alvo, 'vendedor');
    }
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

describe('upload', () => {
    test('admin e estoquista enviam; a chave leva o empresa_id do JWT e o objeto vai ao bucket', async () => {
        const r1 = await enviar(A, 'admin', A.produtoId, jpeg(1));
        expect(r1.status).toBe(201);
        expect(r1.body.data).toMatchObject({ ordem: 0, principal: true, content_type: 'image/jpeg' });

        const { rows } = await db.query('SELECT chave, empresa_id, criado_por FROM produto_imagens WHERE id = $1', [r1.body.data.id]);
        expect(rows[0].chave).toMatch(new RegExp(`^${A.empresaId}/produtos/${A.produtoId}/[0-9a-f-]{36}\\.jpg$`));
        expect(rows[0].criado_por).toBe(A.u.admin);
        expect(mockObjetos.has(rows[0].chave)).toBe(true);
        expect(r1.body.data.url).toBe(`https://fotos.exemplo.test/${rows[0].chave}`);

        const r2 = await enviar(A, 'estoquista', A.produtoId, jpeg(2));
        expect(r2.status).toBe(201);
        expect(r2.body.data).toMatchObject({ ordem: 1, principal: false });
    });

    test('vendedor não envia (403) mas lê a galeria', async () => {
        expect((await enviar(A, 'vendedor', A.produtoId)).status).toBe(403);
        const lista = await request(app).get(`/produtos/${A.produtoId}/imagens`).set(auth(A, 'vendedor'));
        expect(lista.status).toBe(200);
        expect(lista.body.data.length).toBeGreaterThanOrEqual(2);
    });

    test('recusa arquivo que não é foto, mesmo com nome .jpg, e arquivo sem campo "arquivo"', async () => {
        const svg = await enviar(A, 'admin', A.produtoId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(40, ' ')), 'x.jpg');
        expect(svg.status).toBe(400);

        const semCampo = await request(app).post(`/produtos/${A.produtoId}/imagens`).set(auth(A, 'admin')).attach('outro', jpeg(), 'x.jpg');
        expect(semCampo.status).toBe(400);
    });

    test('recusa acima de 2 MB (413) sem gravar nada', async () => {
        const antes = (await db.query('SELECT COUNT(*)::int AS n FROM produto_imagens WHERE empresa_id = $1', [A.empresaId])).rows[0].n;
        const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2 * 1024 * 1024 + 10)]);
        const r = await enviar(A, 'admin', A.produtoId, grande);
        expect(r.status).toBe(413);
        const depois = (await db.query('SELECT COUNT(*)::int AS n FROM produto_imagens WHERE empresa_id = $1', [A.empresaId])).rows[0].n;
        expect(depois).toBe(antes);
    });

    test('412 quando o armazenamento não está configurado', async () => {
        storage.configurado.mockReturnValue(false);
        expect((await enviar(A, 'admin', A.produtoId)).status).toBe(412);
    });
});

describe('isolamento entre empresas', () => {
    test('empresa B não envia, lê, reordena nem apaga foto de produto da empresa A', async () => {
        const lista = await request(app).get(`/produtos/${A.produtoId}/imagens`).set(auth(B, 'admin'));
        expect(lista.status).toBe(404);

        expect((await enviar(B, 'admin', A.produtoId)).status).toBe(404);

        const alvo = (await db.query('SELECT id FROM produto_imagens WHERE empresa_id = $1 LIMIT 1', [A.empresaId])).rows[0].id;
        const del = await request(app).delete(`/produtos/${A.produtoId}/imagens/${alvo}`).set(auth(B, 'admin'));
        expect(del.status).toBe(404);

        const ord = await request(app).put(`/produtos/${A.produtoId}/imagens/ordem`).set(auth(B, 'admin')).send({ ids: [alvo] });
        expect(ord.status).toBe(404);

        expect((await db.query('SELECT 1 FROM produto_imagens WHERE id = $1', [alvo])).rowCount).toBe(1);
    });

    test('o banco recusa foto de uma empresa apontando para produto de outra (FK composta)', async () => {
        await expect(db.query(
            `INSERT INTO produto_imagens (empresa_id, produto_id, chave, content_type, tamanho_bytes) VALUES ($1, $2, $3, 'image/jpeg', 10)`,
            [B.empresaId, A.produtoId, `x/${sufixo}/cruzada.jpg`]
        )).rejects.toThrow();
    });
});

describe('limite de 5 fotos', () => {
    test('uploads simultâneos nunca passam de 5 e não deixam objeto órfão no bucket', async () => {
        const produto = (await db.query(
            `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'Concorrência', 50, 10, 0) RETURNING id`,
            [A.empresaId]
        )).rows[0].id;

        const respostas = await Promise.all(Array.from({ length: 8 }, (_, i) => enviar(A, 'admin', produto, jpeg(10 + i))));

        expect(respostas.filter((r) => r.status === 201)).toHaveLength(5);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(3);

        const { rows } = await db.query('SELECT chave, ordem FROM produto_imagens WHERE produto_id = $1 ORDER BY ordem', [produto]);
        expect(rows).toHaveLength(5);
        expect(rows.map((r) => r.ordem)).toEqual([0, 1, 2, 3, 4]);

        const doProduto = [...mockObjetos.keys()].filter((k) => k.startsWith(`${A.empresaId}/produtos/${produto}/`));
        expect(doProduto.sort()).toEqual(rows.map((r) => r.chave).sort());
    });
});

describe('ordem, principal e remoção', () => {
    let produto;
    let ids;

    beforeAll(async () => {
        produto = (await db.query(
            `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'Galeria', 50, 10, 0) RETURNING id`,
            [A.empresaId]
        )).rows[0].id;
        ids = [];
        for (let i = 0; i < 3; i += 1) {
            ids.push((await enviar(A, 'admin', produto, jpeg(40 + i))).body.data.id);
        }
    });

    test('reordenar troca a principal; lista incompleta ou repetida é recusada', async () => {
        const nova = [ids[2], ids[0], ids[1]];
        const ok = await request(app).put(`/produtos/${produto}/imagens/ordem`).set(auth(A, 'estoquista')).send({ ids: nova });
        expect(ok.status).toBe(200);
        expect(ok.body.data.map((i) => i.id)).toEqual(nova);
        expect(ok.body.data[0].principal).toBe(true);

        for (const ids_ of [[ids[0], ids[1]], [ids[0], ids[0], ids[1]], [ids[0], ids[1], 999999]]) {
            const r = await request(app).put(`/produtos/${produto}/imagens/ordem`).set(auth(A, 'admin')).send({ ids: ids_ });
            expect(r.status).toBe(400);
        }

        const semAcesso = await request(app).put(`/produtos/${produto}/imagens/ordem`).set(auth(A, 'vendedor')).send({ ids: nova });
        expect(semAcesso.status).toBe(403);
    });

    test('a principal aparece como imagem_url na listagem e no detalhe do produto', async () => {
        const principal = (await db.query('SELECT chave FROM produto_imagens WHERE produto_id = $1 ORDER BY ordem LIMIT 1', [produto])).rows[0].chave;

        const lista = await request(app).get('/produtos?canal=loja_fisica&pageSize=100').set(auth(A, 'admin'));
        expect(lista.status).toBe(200);
        const item = lista.body.data.items.find((p) => p.id === produto);
        expect(item.imagem_url).toBe(`https://fotos.exemplo.test/${principal}`);
        const semFoto = lista.body.data.items.find((p) => p.id === A.produtoId);
        expect(semFoto.imagem_url).toBeTruthy();

        const detalhe = await request(app).get(`/produtos/${produto}?canal=loja_fisica`).set(auth(A, 'vendedor'));
        expect(detalhe.body.data.imagens).toHaveLength(3);
        expect(detalhe.body.data.imagem_url).toBe(item.imagem_url);
    });

    test('apagar remove do banco e do bucket e fecha a ordem (principal continua sendo a de ordem 0)', async () => {
        const antes = (await db.query('SELECT id, chave FROM produto_imagens WHERE produto_id = $1 ORDER BY ordem', [produto])).rows;
        const r = await request(app).delete(`/produtos/${produto}/imagens/${antes[0].id}`).set(auth(A, 'admin'));
        expect(r.status).toBe(200);
        expect(mockObjetos.has(antes[0].chave)).toBe(false);

        const depois = (await db.query('SELECT id, ordem FROM produto_imagens WHERE produto_id = $1 ORDER BY ordem', [produto])).rows;
        expect(depois.map((x) => x.ordem)).toEqual([0, 1]);
        expect(depois[0].id).toBe(antes[1].id);

        expect((await request(app).delete(`/produtos/${produto}/imagens/${antes[0].id}`).set(auth(A, 'admin'))).status).toBe(404);
        expect((await request(app).delete(`/produtos/${produto}/imagens/${antes[1].id}`).set(auth(A, 'vendedor'))).status).toBe(403);
    });

    test('depois de apagar uma foto, cabe de novo uma nova (o limite conta as existentes)', async () => {
        const r = await enviar(A, 'admin', produto, jpeg(99));
        expect(r.status).toBe(201);
        expect(r.body.data.ordem).toBe(2);
    });
});

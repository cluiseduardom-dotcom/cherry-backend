// Integração de verdade (Postgres de testes): pedido de presente da loja (caixa "é presente" + mensagem do cartão). Prova: (1) sem
// presente nada muda; (2) presente e cartão são gravados e aparecem para a cliente e no ERP (só admin/gestão da própria empresa);
// (3) validação (cartão sem presente, texto longo, tipos); (4) idempotência considera o presente; (5) a anonimização LGPD apaga o
// cartão. Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { slug: `teste-a-${sufixo}`, p: {} };
const B = { slug: `teste-b-${sufixo}`, p: {} };
const SEM_FLAG = { slug: `teste-c-${sufixo}`, p: {} };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const gestao = (E, papel = 'admin') => {
    const token = papel === 'admin' ? E.tokenAdmin : E.tokenVendedor;

    return {
        get: () => request(app).get('/loja-condicoes').set('Authorization', `Bearer ${token}`),
        put: (corpo) => request(app).put('/loja-condicoes').set('Authorization', `Bearer ${token}`).send(corpo)
    };
};
let seq = 0;
const corpo = (E, extra = {}, email = `cli${++seq}-${sufixo}@teste.local`) => ({
    cliente: { nome: 'Maria Cliente', email, telefone: '(11) 91234-5678' },
    itens: [{ slug: E.p.anel.slug, quantidade: 1, preco_exibido: E.p.anel.preco }],
    ...extra
});
const pedir = (E, extra, chave = crypto.randomUUID(), email) => request(app).post(`/loja/${E.slug}/pedidos`).set('Idempotency-Key', chave).send(corpo(E, extra, email));

async function criarEmpresa(E, nome, { comLoja = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${nome} ${sufixo}`, E.slug]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'online') RETURNING id`, [E.id]);
    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.slug}@teste.local`]);
    E.vendedor = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Vend', $2, 'x', 'vendedor') RETURNING id`, [E.id, `ven-${E.slug}@teste.local`]);
    E.tokenAdmin = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    E.tokenVendedor = makeToken({ id: E.vendedor, role: 'vendedor', empresa_id: E.id, tv: 0 });

    if (comLoja) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

async function criarProduto(E, chave, preco) {
    const id = await um(`INSERT INTO produtos (empresa_id, nome, custo, preco_venda, tipo, ativo) VALUES ($1, $2, 11.11, 77.77, 'acabado', true) RETURNING id`, [E.id, `Peça ${chave}`]);
    const slug = `${chave}-${id}`;

    E.p[chave] = { id, slug, preco };
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 100, 50)`, [E.id, id, E.canal, preco]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 50)`, [id, E.central, E.id]);
    await db.query(`UPDATE produtos SET estoque_atual = 50 WHERE id = $1`, [id]);
    await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug) VALUES ($1, $2, true, $3)`, [id, E.id, slug]);
}

beforeAll(async () => {
    await criarEmpresa(A, 'Presente A');
    await criarEmpresa(B, 'Presente B');
    await criarEmpresa(SEM_FLAG, 'Presente Sem Flag', { comLoja: false });
    await criarProduto(A, 'anel', 100);
    await criarProduto(B, 'anel', 100);
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('sem presente nada muda', () => {
    test('pedido comum: presente false e sem cartão', async () => {
        const res = await pedir(A);

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ presente: false, mensagem_cartao: null });
    });

    test('presente false explícito também é pedido comum', async () => {
        const res = await pedir(A, { presente: false });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ presente: false, mensagem_cartao: null });
    });
});

describe('pedido de presente', () => {
    test('presente sem mensagem', async () => {
        const res = await pedir(A, { presente: true });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ presente: true, mensagem_cartao: null });
    });

    test('presente com mensagem: grava aparada, sem caracteres de controle, e a cliente vê de volta', async () => {
        const res = await pedir(A, { presente: true, mensagem_cartao: '  Feliz aniversário, Ana!\u0007 Com carinho.  ' });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ presente: true, mensagem_cartao: 'Feliz aniversário, Ana! Com carinho.' });

        const volta = await request(app).get(`/loja/${A.slug}/pedidos/${res.body.data.codigo}`);

        expect(volta.body.data).toMatchObject({ presente: true, mensagem_cartao: 'Feliz aniversário, Ana! Com carinho.' });
    });

    test('mensagem em branco vira sem mensagem; HTML é guardado como texto puro', async () => {
        const vazio = await pedir(A, { presente: true, mensagem_cartao: '   ' });
        const html = await pedir(A, { presente: true, mensagem_cartao: '<b>oi</b>' });

        expect(vazio.body.data.mensagem_cartao).toBeNull();
        expect(html.body.data.mensagem_cartao).toBe('<b>oi</b>');
    });

    test('limite de 200 caracteres', async () => {
        expect((await pedir(A, { presente: true, mensagem_cartao: 'a'.repeat(200) })).status).toBe(201);
        expect((await pedir(A, { presente: true, mensagem_cartao: 'a'.repeat(201) })).status).toBe(400);
    });

    test('cartão sem presente e tipos errados são recusados', async () => {
        expect((await pedir(A, { mensagem_cartao: 'oi' })).status).toBe(400);
        expect((await pedir(A, { presente: false, mensagem_cartao: 'oi' })).status).toBe(400);
        expect((await pedir(A, { presente: 'sim' })).status).toBe(400);
        expect((await pedir(A, { presente: true, mensagem_cartao: 5 })).status).toBe(400);
    });

    test('o banco também recusa cartão em pedido sem presente', async () => {
        await expect(db.query(`UPDATE pedidos_loja SET mensagem_cartao = 'x', presente = false WHERE empresa_id = $1`, [A.id])).rejects.toThrow(/pedidos_loja_cartao_chk/);
    });
});

describe('idempotência considera o presente', () => {
    test('mesma chave e mesmo conteúdo reaproveita; outro presente com a mesma chave é recusado', async () => {
        const chave = crypto.randomUUID();
        const email = `idem-${sufixo}@teste.local`;
        const a = await pedir(A, { presente: true, mensagem_cartao: 'Oi' }, chave, email);
        const b = await pedir(A, { presente: true, mensagem_cartao: 'Oi' }, chave, email);
        const c = await pedir(A, { presente: true, mensagem_cartao: 'Outra' }, chave, email);
        const d = await pedir(A, {}, chave, email);

        expect(a.status).toBe(201);
        expect(b.status).toBe(200);
        expect(b.body.data.codigo).toBe(a.body.data.codigo);
        expect(c.status).toBe(409);
        expect(d.status).toBe(409);
    });
});

describe('ERP: pedidos da loja', () => {
    const lista = (E, papel = 'admin') => request(app).get('/loja-pedidos?situacao=todos&limit=100').set('Authorization', `Bearer ${papel === 'admin' ? E.tokenAdmin : E.tokenVendedor}`);

    test('a equipe da loja vê presente e cartão; outra empresa não vê esses pedidos', async () => {
        const feito = await pedir(A, { presente: true, mensagem_cartao: 'Para você' });
        const res = await lista(A);

        expect(res.status).toBe(200);

        const achado = res.body.data.itens.find((p) => p.codigo === feito.body.data.codigo);

        expect(achado).toMatchObject({ presente: true, mensagem_cartao: 'Para você' });
        expect((await lista(B)).body.data.itens.some((p) => p.codigo === feito.body.data.codigo)).toBe(false);
    });
});

describe('LGPD: anonimização apaga o cartão', () => {
    test('a mensagem é removida junto dos dados pessoais', async () => {
        const feito = await pedir(A, { presente: true, mensagem_cartao: 'Maria, com amor' });
        await db.query(`UPDATE pedidos_loja SET status = 'expirado', encerrado_em = NOW(), motivo_encerramento = 'teste' WHERE codigo = $1`, [feito.body.data.codigo]);

        const { anonimizarPedidoLoja } = require('../../src/repositories/lgpdRepository');
        const r = await anonimizarPedidoLoja({ empresa_id: A.id, codigo: feito.body.data.codigo, executar: true, motivo: 'teste' });

        expect(r.resultado).toBe('anonimizado');

        const { rows: [p] } = await db.query('SELECT mensagem_cartao, presente FROM pedidos_loja WHERE codigo = $1', [feito.body.data.codigo]);

        expect(p).toEqual({ mensagem_cartao: null, presente: true });
    });
});

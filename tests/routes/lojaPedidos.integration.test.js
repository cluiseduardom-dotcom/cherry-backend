// Integração de verdade (Postgres de testes): pedidos da loja online com reserva de estoque.
//
// Prova, com concorrência real: (1) a última unidade nunca é vendida duas vezes; (2) o preço do navegador não vale e
// preço/estoque alterados são detectados; (3) idempotência (inclusive simultânea); (4) a reserva sai do Central e
// volta ao expirar, sem nunca descasar o estoque total; (5) uma loja nunca mexe no estoque de outra; (6) PDV e telas
// manuais não conseguem mexer na Reserva. Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const pedidosRepository = require('../../src/repositories/lojaPedidosRepository');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { slug: `teste-pa-${sufixo}`, p: {} };
const B = { slug: `teste-pb-${sufixo}`, p: {} };
const SEM_FLAG = { slug: `teste-pc-${sufixo}`, p: {} };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
let contador = 0;
const chaveNova = () => `chave-${sufixo}-${++contador}-${crypto.randomBytes(3).toString('hex')}`;
const emailNovo = () => `cliente${++contador}-${crypto.randomBytes(3).toString('hex')}@teste.local`;

async function criarEmpresa(E, { nome, comFlag = true }) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${nome} ${sufixo}`, E.slug]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'online') RETURNING id`, [E.id]);
    E.canalFisico = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'loja_fisica') RETURNING id`, [E.id]);
    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.slug}@teste.local`]);
    E.token = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    if (comFlag) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`,
            [E.id]
        );
    }
}

// estoque_atual = saldo do Central (invariante do ERP: a soma dos locais fecha com o total).
async function criarProduto(E, chave, { nome, preco = 100, saldo = 5, tipo = 'acabado', ativo = true, visivel = true, semPreco = false } = {}) {
    const id = await um(
        `INSERT INTO produtos (empresa_id, nome, custo, tipo, ativo, estoque_atual) VALUES ($1, $2, 9.99, $3, $4, $5) RETURNING id`,
        [E.id, nome ?? `Peça ${chave}`, tipo, ativo, saldo]
    );
    E.p[chave] = { id, slug: `${chave}-${id}`, preco };

    if (!semPreco) {
        await db.query(
            `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 1, 1)`,
            [E.id, id, E.canal, preco]
        );
    }
    if (saldo > 0) await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, E.central, E.id, saldo]);
    await db.query(
        `INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug) VALUES ($1, $2, $3, $4)`,
        [id, E.id, visivel, E.p[chave].slug]
    );
    return id;
}

// Saldos reais do banco: Central, Reserva, total do produto e se a soma dos locais fecha com o total.
async function estoque(E, chave) {
    const { id } = E.p[chave];
    const { rows } = await db.query(
        `SELECT l.tipo, COALESCE(el.saldo, 0) AS saldo FROM locais_estoque l
           LEFT JOIN estoque_locais el ON el.local_id = l.id AND el.produto_id = $2 AND el.empresa_id = l.empresa_id
          WHERE l.empresa_id = $1`,
        [E.id, id]
    );
    const por = Object.fromEntries(rows.map((r) => [r.tipo, r.saldo]));
    const { rows: [p] } = await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [id]);
    const soma = rows.reduce((acc, r) => acc + r.saldo, 0);

    return { central: por.central ?? 0, reserva: por.reserva ?? 0, total: p.estoque_atual, fecha: soma === p.estoque_atual };
}

const corpo = (E, chaves, cliente = {}) => ({
    cliente: { nome: 'Maria Cliente', email: emailNovo(), telefone: '(11) 91234-5678', ...cliente },
    itens: chaves.map((c) => (typeof c === 'string'
        ? { slug: E.p[c].slug, quantidade: 1, preco_exibido: E.p[c].preco }
        : { slug: E.p[c.chave].slug, quantidade: c.quantidade ?? 1, preco_exibido: c.preco_exibido ?? E.p[c.chave].preco }))
});

const postar = (E, body, chave = chaveNova()) => request(app).post(`/loja/${E.slug}/pedidos`).set('Idempotency-Key', chave).send(body);
const buscar = (E, codigo) => request(app).get(`/loja/${E.slug}/pedidos/${codigo}`);

beforeAll(async () => {
    await criarEmpresa(A, { nome: 'Pedidos A' });
    await criarEmpresa(B, { nome: 'Pedidos B' });
    await criarEmpresa(SEM_FLAG, { nome: 'Pedidos Sem Flag', comFlag: false });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('criar pedido: caminho feliz', () => {
    test('201, preço do servidor, peça sai do Central para a Reserva e o total do produto não muda', async () => {
        await criarProduto(A, 'feliz', { preco: 63, saldo: 5 });
        const res = await postar(A, corpo(A, [{ chave: 'feliz', quantidade: 2 }]));

        expect(res.status).toBe(201);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.data).toMatchObject({ status: 'aguardando_pagamento', subtotal: 126, desconto: 0, frete: null, total: 126 });
        expect(res.body.data.itens).toEqual([{ slug: A.p.feliz.slug, nome: 'Peça feliz', quantidade: 2, preco_unitario: 63, subtotal: 126 }]);
        expect(new Date(res.body.data.reserva_expira_em).getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);

        expect(await estoque(A, 'feliz')).toEqual({ central: 3, reserva: 2, total: 5, fecha: true });
    });

    test('deixa o rastro no livro de estoque e a trilha de eventos', async () => {
        await criarProduto(A, 'rastro', { saldo: 3 });
        const res = await postar(A, corpo(A, ['rastro']));
        const { rows: pedido } = await db.query('SELECT id FROM pedidos_loja WHERE codigo = $1', [res.body.data.codigo]);
        const id = pedido[0].id;

        const { rows: mov } = await db.query(
            `SELECT m.tipo, m.quantidade, l.tipo AS local, m.motivo, m.usuario_id FROM movimentacoes_estoque m
               JOIN locais_estoque l ON l.id = m.local_id WHERE m.produto_id = $1 ORDER BY m.id`,
            [A.p.rastro.id]
        );
        expect(mov).toEqual([
            { tipo: 'saida', quantidade: 1, local: 'central', motivo: `Reserva online #${id}`, usuario_id: null },
            { tipo: 'entrada', quantidade: 1, local: 'reserva', motivo: `Reserva online #${id}`, usuario_id: null }
        ]);

        const { rows: ev } = await db.query('SELECT tipo, status_anterior, status_novo FROM pedidos_loja_eventos WHERE pedido_id = $1', [id]);
        expect(ev).toEqual([{ tipo: 'criado', status_anterior: null, status_novo: 'aguardando_pagamento' }]);
    });

    test('a resposta não traz dado pessoal, chave, hash nem id interno', async () => {
        await criarProduto(A, 'privado', { saldo: 3 });
        const cliente = { nome: 'Fulana Secreta', email: emailNovo(), telefone: '11987654321' };
        const res = await postar(A, corpo(A, ['privado'], cliente));
        const texto = JSON.stringify(res.body);

        expect(res.status).toBe(201);
        expect(texto).not.toContain('Secreta');
        expect(texto).not.toContain(cliente.email);
        expect(texto).not.toContain('987654321');
        expect(texto).not.toMatch(/hash|idempot|chave|empresa_id|custo|"id"/i);
        expect(Object.keys(res.body.data).sort()).toEqual(['codigo', 'criado_em', 'desconto', 'frete', 'itens', 'pagamento', 'pago_em', 'reserva_expira_em', 'status', 'subtotal', 'total']);
    });

    test('guarda o preço e o nome congelados: mudar o preço depois não altera o pedido', async () => {
        await criarProduto(A, 'congela', { preco: 50, saldo: 3 });
        const res = await postar(A, corpo(A, ['congela']));
        await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, criado_em) VALUES ($1, $2, $3, 80, 1, 1, NOW() + INTERVAL '1 second')`, [A.id, A.p.congela.id, A.canal]);

        const depois = await buscar(A, res.body.data.codigo);
        expect(depois.body.data).toMatchObject({ total: 50 });
        expect(depois.body.data.itens[0].preco_unitario).toBe(50);
    });
});

describe('o que o navegador manda nunca vale', () => {
    test('preço diferente do vigente: 409 com o preço atual e NADA é reservado', async () => {
        await criarProduto(A, 'preco-errado', { preco: 100, saldo: 3 });
        const res = await postar(A, corpo(A, [{ chave: 'preco-errado', preco_exibido: 1 }]));

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, codigo: 'ITENS_ALTERADOS', detalhes: [{ slug: A.p['preco-errado'].slug, problema: 'preco_alterado', preco_atual: 100 }] });
        expect(await estoque(A, 'preco-errado')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
        expect((await db.query('SELECT COUNT(*)::int AS n FROM pedidos_loja WHERE empresa_id = $1 AND subtotal = 1', [A.id])).rows[0].n).toBe(0);
    });

    test('preço alterado antes do checkout (cliente viu 100, agora é 120): recusa e mostra o novo', async () => {
        await criarProduto(A, 'sobe', { preco: 100, saldo: 3 });
        await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, criado_em) VALUES ($1, $2, $3, 120, 1, 1, NOW() + INTERVAL '1 second')`, [A.id, A.p.sobe.id, A.canal]);

        const res = await postar(A, corpo(A, [{ chave: 'sobe', preco_exibido: 100 }]));

        expect(res.status).toBe(409);
        expect(res.body.detalhes[0]).toMatchObject({ problema: 'preco_alterado', preco_atual: 120 });

        const confirmado = await postar(A, corpo(A, [{ chave: 'sobe', preco_exibido: 120 }]));
        expect(confirmado.status).toBe(201);
        expect(confirmado.body.data.total).toBe(120);
    });

    test('campos extras (empresa_id, total, frete, desconto) são recusados', async () => {
        await criarProduto(A, 'extra', { saldo: 3 });

        for (const extra of [{ empresa_id: B.id }, { total: 1 }, { frete: 0 }, { desconto: 50 }]) {
            const res = await postar(A, { ...corpo(A, ['extra']), ...extra });
            expect([JSON.stringify(extra), res.status]).toEqual([JSON.stringify(extra), 400]);
        }

        const comExtraNoItem = corpo(A, ['extra']);
        comExtraNoItem.itens[0].preco_unitario = 1;
        expect((await postar(A, comExtraNoItem)).status).toBe(400);
        expect(await estoque(A, 'extra')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });
});

describe('estoque', () => {
    test('produto sem estoque: 409 estoque_insuficiente', async () => {
        await criarProduto(A, 'zerado', { saldo: 0 });
        const res = await postar(A, corpo(A, ['zerado']));

        expect(res.status).toBe(409);
        expect(res.body.detalhes).toEqual([{ slug: A.p.zerado.slug, problema: 'estoque_insuficiente', disponivel: 0 }]);
    });

    test('quantidade maior que o saldo: recusa e informa quanto há', async () => {
        await criarProduto(A, 'dois', { saldo: 2 });
        const res = await postar(A, corpo(A, [{ chave: 'dois', quantidade: 3 }]));

        expect(res.status).toBe(409);
        expect(res.body.detalhes[0]).toMatchObject({ problema: 'estoque_insuficiente', disponivel: 2 });
    });

    test('estoque alterado durante a compra: o que a cliente viu (5) já não existe (1)', async () => {
        await criarProduto(A, 'encolhe', { saldo: 5 });
        await db.query('UPDATE estoque_locais SET saldo = 1 WHERE produto_id = $1', [A.p.encolhe.id]);
        await db.query('UPDATE produtos SET estoque_atual = 1 WHERE id = $1', [A.p.encolhe.id]);

        const res = await postar(A, corpo(A, [{ chave: 'encolhe', quantidade: 3 }]));
        expect(res.status).toBe(409);
        expect(res.body.detalhes[0]).toMatchObject({ problema: 'estoque_insuficiente', disponivel: 1 });
    });

    test('tudo ou nada: com um item sem estoque, o item bom também NÃO é reservado', async () => {
        await criarProduto(A, 'bom', { saldo: 4 });
        await criarProduto(A, 'ruim', { saldo: 0 });
        const res = await postar(A, corpo(A, ['bom', 'ruim']));

        expect(res.status).toBe(409);
        expect(await estoque(A, 'bom')).toEqual({ central: 4, reserva: 0, total: 4, fecha: true });
    });

    test('saldo só na Reserva ou em outro local não conta como disponível', async () => {
        await criarProduto(A, 'so-reserva', { saldo: 0 });
        await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'reserva', 'Reserva online') ON CONFLICT DO NOTHING`, [A.id]);
        const reserva = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'reserva'`, [A.id])).rows[0].id;
        await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, 4) ON CONFLICT (produto_id, local_id) DO UPDATE SET saldo = 4`, [A.p['so-reserva'].id, reserva, A.id]);
        await db.query('UPDATE produtos SET estoque_atual = 4 WHERE id = $1', [A.p['so-reserva'].id]);

        expect((await postar(A, corpo(A, ['so-reserva']))).status).toBe(409);
    });
});

describe('última unidade com concorrência real', () => {
    test('duas clientes ao mesmo tempo: exatamente uma leva, a outra recebe 409', async () => {
        await criarProduto(A, 'ultima', { saldo: 1 });
        const [r1, r2] = await Promise.all([postar(A, corpo(A, ['ultima'])), postar(A, corpo(A, ['ultima']))]);

        expect([r1.status, r2.status].sort()).toEqual([201, 409]);
        const perdedora = r1.status === 409 ? r1 : r2;
        expect(perdedora.body.detalhes[0]).toMatchObject({ problema: 'estoque_insuficiente', disponivel: 0 });
        expect(await estoque(A, 'ultima')).toEqual({ central: 0, reserva: 1, total: 1, fecha: true });
    });

    test('doze clientes disputando 3 unidades: no máximo 3 pedidos, estoque exato e nunca negativo', async () => {
        await criarProduto(A, 'disputa', { saldo: 3 });
        const respostas = await Promise.all(Array.from({ length: 12 }, () => postar(A, corpo(A, ['disputa']))));
        const ok = respostas.filter((r) => r.status === 201).length;

        expect(ok).toBe(3);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(9);
        expect(await estoque(A, 'disputa')).toEqual({ central: 0, reserva: 3, total: 3, fecha: true });
    });

    test('pedidos com os mesmos produtos em ordem oposta não travam um ao outro (sem deadlock)', async () => {
        await criarProduto(A, 'x1', { saldo: 10 });
        await criarProduto(A, 'x2', { saldo: 10 });
        const lote = await Promise.all([
            ...Array.from({ length: 4 }, () => postar(A, corpo(A, ['x1', 'x2']))),
            ...Array.from({ length: 4 }, () => postar(A, corpo(A, ['x2', 'x1'])))
        ]);

        expect(lote.every((r) => r.status === 201)).toBe(true);
        expect(await estoque(A, 'x1')).toEqual({ central: 2, reserva: 8, total: 10, fecha: true });
        expect(await estoque(A, 'x2')).toEqual({ central: 2, reserva: 8, total: 10, fecha: true });
    });
});

describe('idempotência', () => {
    test('mesma chave e mesmo conteúdo: devolve o mesmo pedido e reserva uma única vez', async () => {
        await criarProduto(A, 'idem', { saldo: 5 });
        const body = corpo(A, ['idem']);
        const chave = chaveNova();

        const primeira = await postar(A, body, chave);
        const repetida = await postar(A, body, chave);

        expect(primeira.status).toBe(201);
        expect(repetida.status).toBe(200);
        expect(repetida.headers['idempotent-replayed']).toBe('true');
        expect(repetida.body.data.codigo).toBe(primeira.body.data.codigo);
        expect(await estoque(A, 'idem')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });
        expect((await db.query('SELECT COUNT(*)::int AS n FROM pedidos_loja WHERE chave_idempotencia = $1', [chave])).rows[0].n).toBe(1);
    });

    test('mesma chave com conteúdo diferente: 409 CHAVE_REUTILIZADA e nada novo reservado', async () => {
        await criarProduto(A, 'idem2', { saldo: 5 });
        const chave = chaveNova();
        const email = emailNovo();

        await postar(A, corpo(A, ['idem2'], { email }), chave);
        const outra = await postar(A, corpo(A, [{ chave: 'idem2', quantidade: 3 }], { email }), chave);

        expect(outra.status).toBe(409);
        expect(outra.body.codigo).toBe('CHAVE_REUTILIZADA');
        expect(await estoque(A, 'idem2')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });
    });

    test('seis requisições SIMULTÂNEAS com a mesma chave: um único pedido, todas com o mesmo código', async () => {
        await criarProduto(A, 'idem3', { saldo: 5 });
        const body = corpo(A, ['idem3']);
        const chave = chaveNova();

        const res = await Promise.all(Array.from({ length: 6 }, () => postar(A, body, chave)));

        expect(res.every((r) => [200, 201].includes(r.status))).toBe(true);
        expect(res.filter((r) => r.status === 201)).toHaveLength(1);
        expect(new Set(res.map((r) => r.body.data.codigo)).size).toBe(1);
        expect(await estoque(A, 'idem3')).toEqual({ central: 4, reserva: 1, total: 5, fecha: true });
    });

    test('sem a chave, ou com chave inválida: 400', async () => {
        await criarProduto(A, 'idem4', { saldo: 5 });
        const body = corpo(A, ['idem4']);

        expect((await request(app).post(`/loja/${A.slug}/pedidos`).send(body)).status).toBe(400);
        for (const ruim of ['curta', 'tem espaço na chave', 'x'.repeat(81), 'acento-é-não-vale']) {
            expect([ruim, (await postar(A, body, ruim)).status]).toEqual([ruim, 400]);
        }
    });

    test('a mesma chave em lojas diferentes não se mistura', async () => {
        await criarProduto(A, 'idem5', { saldo: 5 });
        await criarProduto(B, 'idem5', { saldo: 5 });
        const chave = chaveNova();

        const a = await postar(A, corpo(A, ['idem5']), chave);
        const b = await postar(B, corpo(B, ['idem5']), chave);

        expect([a.status, b.status]).toEqual([201, 201]);
        expect(a.body.data.codigo).not.toBe(b.body.data.codigo);
    });
});

describe('o que pode ser comprado e de quem', () => {
    test.each([
        ['invisível', { visivel: false }],
        ['inativo', { ativo: false }],
        ['insumo', { tipo: 'insumo' }],
        ['sem preço no canal online', { semPreco: true }]
    ])('produto %s: 409 indisponivel e nada é reservado', async (rotulo, opcoes) => {
        const chave = `nao-vende-${rotulo.replace(/\W+/g, '')}`;
        await criarProduto(A, chave, { saldo: 3, ...opcoes });
        const res = await postar(A, corpo(A, [chave]));

        expect(res.status).toBe(409);
        expect(res.body.detalhes).toEqual([{ slug: A.p[chave].slug, problema: 'indisponivel' }]);
        expect(await estoque(A, chave)).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });

    test('slug inexistente: indisponivel', async () => {
        const body = corpo(A, ['feliz']);
        body.itens[0].slug = 'nao-existe-9999';

        expect((await postar(A, body)).body.detalhes[0].problema).toBe('indisponivel');
    });

    test('ISOLAMENTO: o slug de um produto da loja B, usado na loja A, não reserva nada de B', async () => {
        await criarProduto(B, 'alheio', { saldo: 5 });
        const body = corpo(B, ['alheio']);
        const res = await postar(A, body);

        expect(res.status).toBe(409);
        expect(res.body.detalhes[0].problema).toBe('indisponivel');
        expect(await estoque(B, 'alheio')).toEqual({ central: 5, reserva: 0, total: 5, fecha: true });
    });

    test('empresa sem a funcionalidade loja_online: 404, sem reservar', async () => {
        await criarProduto(SEM_FLAG, 'sem-flag', { saldo: 3 });
        const res = await postar(SEM_FLAG, corpo(SEM_FLAG, ['sem-flag']));

        expect(res.status).toBe(404);
        expect(await estoque(SEM_FLAG, 'sem-flag')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });
});

describe('validação do corpo', () => {
    test.each([
        ['sem itens', (b) => { b.itens = []; }],
        ['quantidade zero', (b) => { b.itens[0].quantidade = 0; }],
        ['quantidade 11', (b) => { b.itens[0].quantidade = 11; }],
        ['quantidade fracionada', (b) => { b.itens[0].quantidade = 1.5; }],
        ['quantidade em texto', (b) => { b.itens[0].quantidade = '1'; }],
        ['preço exibido zero', (b) => { b.itens[0].preco_exibido = 0; }],
        ['preço exibido em texto', (b) => { b.itens[0].preco_exibido = '63'; }],
        ['e-mail inválido', (b) => { b.cliente.email = 'sem-arroba'; }],
        ['nome curto', (b) => { b.cliente.nome = 'A'; }],
        ['telefone curto', (b) => { b.cliente.telefone = '123'; }],
        ['item repetido', (b) => { b.itens.push({ ...b.itens[0] }); }],
        ['21 itens', (b) => { b.itens = Array.from({ length: 21 }, (_, i) => ({ slug: `peca-${i}`, quantidade: 1, preco_exibido: 1 })); }],
        ['slug malformado', (b) => { b.itens[0].slug = "'; DROP TABLE produtos;--"; }]
    ])('%s: 400', async (_rotulo, quebrar) => {
        const body = corpo(A, ['feliz']);
        quebrar(body);

        const res = await postar(A, body);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('telefone é opcional', async () => {
        await criarProduto(A, 'sem-fone', { saldo: 3 });
        const body = corpo(A, ['sem-fone']);
        delete body.cliente.telefone;

        expect((await postar(A, body)).status).toBe(201);
    });
});

describe('freio contra reserva sem pagamento', () => {
    test('no máximo 3 pedidos abertos por e-mail; o 4º é recusado', async () => {
        await criarProduto(A, 'freio', { saldo: 10 });
        const email = emailNovo();
        const respostas = [];

        for (let i = 0; i < 4; i += 1) respostas.push(await postar(A, corpo(A, ['freio'], { email })));

        expect(respostas.map((r) => r.status)).toEqual([201, 201, 201, 409]);
        expect(respostas[3].body.codigo).toBe('LIMITE_PEDIDOS_ABERTOS');
        expect(await estoque(A, 'freio')).toEqual({ central: 7, reserva: 3, total: 10, fecha: true });
    });

    test('o limite não se confunde com maiúsculas no e-mail e vale só para a mesma loja', async () => {
        await criarProduto(A, 'freio2', { saldo: 10 });
        await criarProduto(B, 'freio2', { saldo: 10 });
        const email = emailNovo();

        for (let i = 0; i < 3; i += 1) await postar(A, corpo(A, ['freio2'], { email: i === 0 ? email.toUpperCase() : email }));

        expect((await postar(A, corpo(A, ['freio2'], { email }))).status).toBe(409);
        expect((await postar(B, corpo(B, ['freio2'], { email }))).status).toBe(201);
    });

    test('pedidos simultâneos do mesmo e-mail também respeitam o limite', async () => {
        await criarProduto(A, 'freio3', { saldo: 20 });
        const email = emailNovo();
        const res = await Promise.all(Array.from({ length: 8 }, () => postar(A, corpo(A, ['freio3'], { email }))));

        expect(res.filter((r) => r.status === 201)).toHaveLength(3);
    });
});

describe('expiração: a peça volta ao Central', () => {
    async function pedidoVencido(chave, saldo = 3, quantidade = 2) {
        await criarProduto(A, chave, { saldo });
        const res = await postar(A, corpo(A, [{ chave, quantidade }]));
        await db.query(`UPDATE pedidos_loja SET reserva_expira_em = NOW() - INTERVAL '1 minute' WHERE codigo = $1`, [res.body.data.codigo]);
        return res.body.data.codigo;
    }

    test('ao consultar o pedido vencido, ele já aparece expirado e o estoque voltou', async () => {
        const codigo = await pedidoVencido('exp1');
        expect(await estoque(A, 'exp1')).toEqual({ central: 1, reserva: 2, total: 3, fecha: true });

        const res = await buscar(A, codigo);

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('expirado');
        expect(await estoque(A, 'exp1')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });

    test('deixa histórico completo: pedido preservado, motivo, evento e movimentações de volta', async () => {
        const codigo = await pedidoVencido('exp2');
        await buscar(A, codigo);

        const { rows: [p] } = await db.query('SELECT id, status, encerrado_em, motivo_encerramento FROM pedidos_loja WHERE codigo = $1', [codigo]);
        expect(p).toMatchObject({ status: 'expirado', motivo_encerramento: 'reserva_expirada' });
        expect(p.encerrado_em).not.toBeNull();

        const { rows: ev } = await db.query('SELECT tipo, status_anterior, status_novo FROM pedidos_loja_eventos WHERE pedido_id = $1 ORDER BY id', [p.id]);
        expect(ev.map((e) => e.tipo)).toEqual(['criado', 'expirado']);

        const { rows: mov } = await db.query(
            `SELECT m.tipo, l.tipo AS local FROM movimentacoes_estoque m JOIN locais_estoque l ON l.id = m.local_id WHERE m.produto_id = $1 ORDER BY m.id`,
            [A.p.exp2.id]
        );
        expect(mov.map((m) => `${m.tipo}:${m.local}`)).toEqual(['saida:central', 'entrada:reserva', 'saida:reserva', 'entrada:central']);
    });

    test('liberar duas vezes não devolve em dobro (cinco varreduras simultâneas)', async () => {
        await pedidoVencido('exp3');
        const contagens = await Promise.all(Array.from({ length: 5 }, () => pedidosRepository.expirarVencidos({ empresa_id: A.id })));

        expect(contagens.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
        expect(await estoque(A, 'exp3')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
        expect((await pedidosRepository.expirarVencidos({ empresa_id: A.id }))).toBe(0);
    });

    test('a varredura do cron (sem filtro de empresa) libera de todas as lojas, cada uma no seu estoque', async () => {
        await criarProduto(A, 'cron-a', { saldo: 2 });
        await criarProduto(B, 'cron-b', { saldo: 2 });
        const ra = await postar(A, corpo(A, ['cron-a']));
        const rb = await postar(B, corpo(B, ['cron-b']));
        await db.query(`UPDATE pedidos_loja SET reserva_expira_em = NOW() - INTERVAL '1 minute' WHERE codigo = ANY($1::uuid[])`, [[ra.body.data.codigo, rb.body.data.codigo]]);

        await pedidosRepository.expirarVencidos({ limite: 500 });

        expect(await estoque(A, 'cron-a')).toEqual({ central: 2, reserva: 0, total: 2, fecha: true });
        expect(await estoque(B, 'cron-b')).toEqual({ central: 2, reserva: 0, total: 2, fecha: true });
    });

    test('pedido ainda dentro do prazo não é tocado', async () => {
        await criarProduto(A, 'exp4', { saldo: 3 });
        const res = await postar(A, corpo(A, ['exp4']));
        await pedidosRepository.expirarVencidos({ empresa_id: A.id });

        expect((await buscar(A, res.body.data.codigo)).body.data.status).toBe('aguardando_pagamento');
        expect(await estoque(A, 'exp4')).toEqual({ central: 2, reserva: 1, total: 3, fecha: true });
    });

    test('pedido expirado não conta no limite por e-mail e a peça pode ser comprada de novo', async () => {
        await criarProduto(A, 'exp5', { saldo: 1 });
        const email = emailNovo();
        const r1 = await postar(A, corpo(A, ['exp5'], { email }));
        expect((await postar(A, corpo(A, ['exp5'], { email }))).status).toBe(409);

        await db.query(`UPDATE pedidos_loja SET reserva_expira_em = NOW() - INTERVAL '1 minute' WHERE codigo = $1`, [r1.body.data.codigo]);
        const nova = await postar(A, corpo(A, ['exp5'], { email }));

        expect(nova.status).toBe(201);
        expect(await estoque(A, 'exp5')).toEqual({ central: 0, reserva: 1, total: 1, fecha: true });
    });
});

describe('acompanhar o pedido', () => {
    test('pelo código; de outra loja, malformado ou inexistente: o mesmo 404', async () => {
        await criarProduto(A, 'acomp', { saldo: 3 });
        const criado = await postar(A, corpo(A, ['acomp']));
        const codigo = criado.body.data.codigo;

        expect((await buscar(A, codigo)).status).toBe(200);
        expect((await buscar(A, codigo.toUpperCase())).status).toBe(200);

        for (const alvo of [() => buscar(B, codigo), () => buscar(A, 'nao-e-uuid'), () => buscar(A, crypto.randomUUID()), () => buscar(SEM_FLAG, codigo)]) {
            const res = await alvo();
            expect(res.status).toBe(404);
        }
    });

    test('a consulta também não vaza dado pessoal', async () => {
        await criarProduto(A, 'acomp2', { saldo: 3 });
        const email = emailNovo();
        const criado = await postar(A, corpo(A, ['acomp2'], { email, nome: 'Nome Muito Privado' }));
        const texto = JSON.stringify((await buscar(A, criado.body.data.codigo)).body);

        expect(texto).not.toContain(email);
        expect(texto).not.toContain('Privado');
    });
});

describe('a Reserva é intocável fora do fluxo da loja', () => {
    let reservaId;

    beforeAll(async () => {
        await criarProduto(A, 'blindado', { saldo: 4 });
        await postar(A, corpo(A, ['blindado']));
        reservaId = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'reserva'`, [A.id])).rows[0].id;
        await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 10, 1, 1)`, [A.id, A.p.blindado.id, A.canalFisico]);
    });

    const vender = (local_id) => request(app).post('/vendas').set('Authorization', `Bearer ${A.token}`)
        .send({ canal: 'loja_fisica', itens: [{ produto_id: A.p.blindado.id, quantidade: 1, ...(local_id ? { local_id } : {}) }] });

    test('o PDV não vende a partir da Reserva (e o mesmo pedido, do Central, funciona)', async () => {
        const recusada = await vender(reservaId);

        expect(recusada.status).toBe(403);
        expect(recusada.body.message).toMatch(/não pode vender a partir deste local/i);
        expect(await estoque(A, 'blindado')).toEqual({ central: 3, reserva: 1, total: 4, fecha: true });

        // Controle: o corpo é válido; só o local muda o resultado.
        const controle = await vender(undefined);
        expect(controle.status).toBe(201);
        expect(await estoque(A, 'blindado')).toEqual({ central: 2, reserva: 1, total: 3, fecha: true });
    });

    const mover = (corpoMov) => request(app).post(`/produtos/${A.p.blindado.id}/movimentacoes`).set('Authorization', `Bearer ${A.token}`)
        .send({ quantidade: 1, observacao: 'teste de bloqueio', ...corpoMov });

    test('movimentação avulsa na Reserva é recusada (e no Central, a mesma, funciona)', async () => {
        for (const mov of [{ tipo: 'entrada', motivo_codigo: 'recebimento_sem_compra' }, { tipo: 'saida', motivo_codigo: 'perda' }, { tipo: 'ajuste', motivo_codigo: 'contagem' }]) {
            const res = await mover({ ...mov, local_id: reservaId });
            expect([JSON.stringify(mov), res.status, res.body.message]).toEqual([JSON.stringify(mov), 404, 'Local de estoque não encontrado']);
        }
        expect(await estoque(A, 'blindado')).toEqual({ central: 2, reserva: 1, total: 3, fecha: true });

        // Controle: mesmo corpo, no Central, é aceito.
        const controle = await mover({ tipo: 'saida', motivo_codigo: 'perda' });
        expect([200, 201]).toContain(controle.status);
        expect(await estoque(A, 'blindado')).toEqual({ central: 1, reserva: 1, total: 2, fecha: true });
    });

    test('transferência manual com a Reserva como origem ou destino é recusada', async () => {
        const centralId = A.central;
        const transferir = (origem, destino) => request(app).post('/estoque/transferencias').set('Authorization', `Bearer ${A.token}`)
            .send({ origem_local_id: origem, destino_local_id: destino, itens: [{ produto_id: A.p.blindado.id, quantidade: 1 }] });

        for (const [o, d] of [[reservaId, centralId], [centralId, reservaId]]) {
            const res = await transferir(o, d);
            expect([o, d, res.status, res.body.message]).toEqual([o, d, 400, 'A Reserva online é controlada pelos pedidos da loja e não participa de transferências']);
        }
        expect(await estoque(A, 'blindado')).toEqual({ central: 1, reserva: 1, total: 2, fecha: true });
        expect((await db.query('SELECT COUNT(*)::int AS n FROM transferencias_estoque WHERE empresa_id = $1', [A.id])).rows[0].n).toBe(0);
    });

    test('a Reserva não aparece na lista de locais da equipe', async () => {
        const lista = await request(app).get('/estoque/locais').set('Authorization', `Bearer ${A.token}`);
        const lista2 = await request(app).get('/produtos/locais-estoque').set('Authorization', `Bearer ${A.token}`);

        expect(JSON.stringify([lista.body, lista2.body])).not.toMatch(/"tipo":"reserva"|Reserva online/);
    });

    test('mas a tela de saldos por produto mostra onde a peça está, e a soma continua fechando', async () => {
        const res = await request(app).get(`/produtos/${A.p.blindado.id}/estoque-locais`).set('Authorization', `Bearer ${A.token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.consistente).toBe(true);
        expect(res.body.data.locais.find((l) => l.tipo === 'reserva')).toMatchObject({ nome: 'Reserva online', saldo: 1 });
    });
});

describe('verificação anti-robô (Turnstile)', () => {
    let fetchOriginal;
    let consultas;

    // Simula só a Cloudflare: supertest fala com o app direto e não usa fetch.
    beforeAll(() => {
        fetchOriginal = global.fetch;
        process.env.TURNSTILE_SECRET_KEY = 'segredo-de-teste';
        jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch = jest.fn(async (url, opcoes) => {
            const token = new URLSearchParams(opcoes.body).get('response');
            consultas.push(token);
            if (token === 'token-rede') throw new Error('ECONNRESET');
            return { ok: true, status: 200, json: async () => ({ success: token === 'token-valido' }) };
        });
    });

    afterAll(() => {
        global.fetch = fetchOriginal;
        delete process.env.TURNSTILE_SECRET_KEY;
        jest.restoreAllMocks();
    });

    beforeEach(() => { consultas = []; });

    const comToken = (E, chaves, token, chave) => postar(E, { ...corpo(E, chaves), ...(token ? { captcha_token: token } : {}) }, chave);

    test('sem token: 400 CAPTCHA_OBRIGATORIO e nada é reservado', async () => {
        await criarProduto(A, 'cap1', { saldo: 3 });
        const res = await comToken(A, ['cap1'], undefined);

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('CAPTCHA_OBRIGATORIO');
        expect(consultas).toEqual([]);
        expect(await estoque(A, 'cap1')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });

    test('token inválido: 403 CAPTCHA_INVALIDO e nada é reservado', async () => {
        await criarProduto(A, 'cap2', { saldo: 3 });
        const res = await comToken(A, ['cap2'], 'token-ruim');

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('CAPTCHA_INVALIDO');
        expect(await estoque(A, 'cap2')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });

    test('Cloudflare fora do ar: 503 e nada é reservado (falha fechada)', async () => {
        await criarProduto(A, 'cap3', { saldo: 3 });
        const res = await comToken(A, ['cap3'], 'token-rede');

        expect(res.status).toBe(503);
        expect(res.body.codigo).toBe('CAPTCHA_INDISPONIVEL');
        expect(await estoque(A, 'cap3')).toEqual({ central: 3, reserva: 0, total: 3, fecha: true });
    });

    test('token válido: cria o pedido', async () => {
        await criarProduto(A, 'cap4', { saldo: 3 });
        const res = await comToken(A, ['cap4'], 'token-valido');

        expect(res.status).toBe(201);
        expect(consultas).toEqual(['token-valido']);
        expect(await estoque(A, 'cap4')).toEqual({ central: 2, reserva: 1, total: 3, fecha: true });
    });

    test('a verificação vem antes de reservar: robô sem token não esgota a última unidade', async () => {
        await criarProduto(A, 'cap5', { saldo: 1 });
        const robos = await Promise.all(Array.from({ length: 5 }, () => comToken(A, ['cap5'], undefined)));

        expect(robos.every((r) => r.status === 400)).toBe(true);
        expect(await estoque(A, 'cap5')).toEqual({ central: 1, reserva: 0, total: 1, fecha: true });

        expect((await comToken(A, ['cap5'], 'token-valido')).status).toBe(201);
    });

    test('RETRY da cliente que perdeu a resposta: mesma chave e conteúdo devolve o pedido SEM nova verificação', async () => {
        await criarProduto(A, 'cap6', { saldo: 3 });
        const body = corpo(A, ['cap6']);
        const chave = chaveNova();

        const primeira = await postar(A, { ...body, captcha_token: 'token-valido' }, chave);
        consultas = [];
        // O token da primeira tentativa é de uso único; o retry leva um token vencido e mesmo assim passa.
        const retry = await postar(A, { ...body, captcha_token: 'token-ja-usado' }, chave);
        const retrySemToken = await postar(A, body, chave);

        expect(primeira.status).toBe(201);
        expect([retry.status, retrySemToken.status]).toEqual([200, 200]);
        expect(retry.headers['idempotent-replayed']).toBe('true');
        expect(retry.body.data.codigo).toBe(primeira.body.data.codigo);
        expect(consultas).toEqual([]);
        expect(await estoque(A, 'cap6')).toEqual({ central: 2, reserva: 1, total: 3, fecha: true });
    });

    test('mesma chave com conteúdo diferente continua exigindo verificação (e é 409 se passar)', async () => {
        await criarProduto(A, 'cap7', { saldo: 5 });
        const chave = chaveNova();
        const email = emailNovo();
        await postar(A, { ...corpo(A, ['cap7'], { email }), captcha_token: 'token-valido' }, chave);

        const semToken = await postar(A, corpo(A, [{ chave: 'cap7', quantidade: 3 }], { email }), chave);
        const comTokenValido = await postar(A, { ...corpo(A, [{ chave: 'cap7', quantidade: 3 }], { email }), captcha_token: 'token-valido' }, chave);

        expect(semToken.status).toBe(400);
        expect(comTokenValido.status).toBe(409);
        expect(comTokenValido.body.codigo).toBe('CHAVE_REUTILIZADA');
    });

    test('o token é limitado em tamanho e não vira parte do conteúdo do pedido', async () => {
        await criarProduto(A, 'cap8', { saldo: 3 });

        expect((await comToken(A, ['cap8'], 'x'.repeat(2049))).status).toBe(400);
        expect(consultas).toEqual([]);
    });

    test('a consulta de pedido e o catálogo não exigem verificação', async () => {
        await criarProduto(A, 'cap9', { saldo: 3 });
        const criado = await comToken(A, ['cap9'], 'token-valido');
        consultas = [];

        expect((await buscar(A, criado.body.data.codigo)).status).toBe(200);
        expect((await request(app).get(`/loja/${A.slug}/catalogo`)).status).toBe(200);
        expect(consultas).toEqual([]);
    });
});

describe('integridade no banco', () => {
    test('a trilha de eventos é só de inserção: UPDATE e DELETE são recusados', async () => {
        const { rows: [ev] } = await db.query('SELECT id FROM pedidos_loja_eventos WHERE empresa_id = $1 LIMIT 1', [A.id]);

        await expect(db.query(`UPDATE pedidos_loja_eventos SET tipo = 'x' WHERE id = $1`, [ev.id])).rejects.toThrow(/imutável/);
        await expect(db.query('DELETE FROM pedidos_loja_eventos WHERE id = $1', [ev.id])).rejects.toThrow(/imutável/);
    });

    test('o banco recusa pedido com total inconsistente, status inválido e chave repetida na mesma empresa', async () => {
        const base = [A.id, 'Teste', 't@teste.local', crypto.randomBytes(8).toString('hex'), 'a'.repeat(64)];
        const inserir = (extra) => db.query(
            `INSERT INTO pedidos_loja (codigo, empresa_id, cliente_nome, cliente_email, chave_idempotencia, hash_requisicao, subtotal, total, reserva_expira_em ${extra.colunas ?? ''})
             VALUES ($6, $1, $2, $3, $4, $5, $7, $8, NOW() ${extra.valores ?? ''})`,
            [...base, crypto.randomUUID(), extra.subtotal ?? 10, extra.total ?? 10, ...(extra.params ?? [])]
        );

        await expect(inserir({ total: 11 })).rejects.toThrow(/pedidos_loja_total_chk/);
        await expect(inserir({ colunas: ', status', valores: ", 'inventado'" })).rejects.toThrow(/pedidos_loja_status_chk/);

        const chave = crypto.randomBytes(8).toString('hex');
        const comChave = () => db.query(
            `INSERT INTO pedidos_loja (codigo, empresa_id, cliente_nome, cliente_email, chave_idempotencia, hash_requisicao, subtotal, total, reserva_expira_em)
             VALUES ($1, $2, 'Teste', 't@teste.local', $3, $4, 10, 10, NOW())`,
            [crypto.randomUUID(), A.id, chave, 'b'.repeat(64)]
        );
        await comChave();
        await expect(comChave()).rejects.toThrow(/pedidos_loja_idempotencia_uk/);
    });

    test('nenhum pedido ficou com total diferente da soma dos itens, e a soma dos locais fecha em todo produto', async () => {
        const { rows } = await db.query(
            `SELECT p.id FROM pedidos_loja p JOIN itens_pedido_loja i ON i.pedido_id = p.id
              WHERE p.empresa_id = $1 GROUP BY p.id, p.subtotal HAVING SUM(i.quantidade * i.preco_unitario) <> p.subtotal`,
            [A.id]
        );
        expect(rows).toEqual([]);

        const { rows: descasados } = await db.query(
            `SELECT p.id FROM produtos p
              WHERE p.empresa_id = ANY($1::int[])
                AND p.estoque_atual <> COALESCE((SELECT SUM(el.saldo) FROM estoque_locais el WHERE el.produto_id = p.id), 0)`,
            [[A.id, B.id, SEM_FLAG.id]]
        );
        expect(descasados).toEqual([]);

        const { rows: negativos } = await db.query('SELECT 1 FROM estoque_locais WHERE empresa_id = ANY($1::int[]) AND saldo < 0', [[A.id, B.id, SEM_FLAG.id]]);
        expect(negativos).toEqual([]);
    });
});

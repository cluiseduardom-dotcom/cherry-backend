// Integração (Postgres de testes): ordem de produção do PCP — planejada → em produção → concluída/cancelada.
// Conclusão consome insumos (produzido + perda) e dá entrada no acabado, numa transação; custo real congelado.
jest.setTimeout(60000);
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
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const A = { u: {}, p: {} };
const B = { u: {}, p: {} };
const C = { u: {}, p: {} }; // sem a funcionalidade pcp

async function criarEmpresa(alvo, rotulo, { pcp }) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste PCP Ordens ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'estoquista', 'vendedor']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
    if (pcp) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'pcp', true, 'teste', 'teste')`,
            [alvo.empresaId]
        );
    }
}

async function criarProduto(alvo, chave, { tipo = 'acabado', custo = 0, estoque = 0, ativo = true } = {}) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, tipo, ativo) VALUES ($1, $2, $3, $4, 1, $5, $6, $7) RETURNING id`,
        [alvo.empresaId, `ORD-${chave}-${alvo.empresaId}-${sufixo}`, `Item ${chave}`, custo, estoque, tipo, ativo]
    );
    alvo.p[chave] = rows[0].id;

    // O saldo mora por local (a movimentação de estoque confere o Central): espelha o estoque no Central da empresa.
    if (estoque > 0) {
        let central = (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0];

        if (!central) {
            central = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [alvo.empresaId])).rows[0];
        }
        await db.query(
            `INSERT INTO estoque_locais (empresa_id, local_id, produto_id, saldo) VALUES ($1, $2, $3, $4)`,
            [alvo.empresaId, central.id, rows[0].id, estoque]
        );
    }
}

async function criarFicha(alvo, produto, itens) {
    const { rows } = await db.query(
        `INSERT INTO fichas_tecnicas (empresa_id, produto_id, vigente, criado_por) VALUES ($1, $2, true, $3) RETURNING id`,
        [alvo.empresaId, alvo.p[produto], alvo.u.admin]
    );
    for (const [insumo, quantidade] of itens) {
        await db.query(
            `INSERT INTO itens_ficha_tecnica (ficha_tecnica_id, insumo_produto_id, quantidade_necessaria, empresa_id) VALUES ($1, $2, $3, $4)`,
            [rows[0].id, alvo.p[insumo], quantidade, alvo.empresaId]
        );
    }
    return rows[0].id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const enviar = (metodo) => (alvo, papel, url, corpo) => request(app)[metodo](url).set(como(alvo, papel)).send(corpo);
const post = enviar('post');
const patch = enviar('patch');
const estoque = async (alvo, chave) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [alvo.p[chave]])).rows[0].estoque_atual;

beforeAll(async () => {
    await criarEmpresa(A, 'A', { pcp: true });
    await criarEmpresa(B, 'B', { pcp: true });
    await criarEmpresa(C, 'C', { pcp: false });

    // Bolo: 2 ovos (custo 1) e 1 farinha (custo 4) por unidade.
    await criarProduto(A, 'bolo');
    await criarProduto(A, 'ovo', { tipo: 'insumo', custo: 1, estoque: 100 });
    await criarProduto(A, 'farinha', { tipo: 'insumo', custo: 4, estoque: 50 });
    A.ficha = await criarFicha(A, 'bolo', [['ovo', 2], ['farinha', 1]]);
    await criarProduto(A, 'semficha');
    await criarProduto(A, 'inativo', { ativo: false });
    await criarFicha(A, 'inativo', [['ovo', 1]]);

    // Cenários de insumo que ainda não deu entrada no sistema (saldo menor que o necessário, ou zero).
    await criarProduto(A, 'pudim');
    await criarProduto(A, 'leite', { tipo: 'insumo', custo: 2, estoque: 5 });
    await criarFicha(A, 'pudim', [['leite', 3]]);
    await criarProduto(A, 'sorvete');
    await criarProduto(A, 'calda', { tipo: 'insumo', custo: 5, estoque: 0 });
    await criarFicha(A, 'sorvete', [['calda', 2]]);

    await criarProduto(B, 'bolo');
    await criarProduto(B, 'ovo', { tipo: 'insumo', custo: 1, estoque: 100 });
    await criarFicha(B, 'bolo', [['ovo', 1]]);
    await criarProduto(C, 'bolo');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('POST /producoes/ordens (criar)', () => {
    test('cria a ordem planejada, amarrada à ficha vigente, sem mexer no estoque', async () => {
        const res = await post(A, 'estoquista', '/producoes/ordens', { produto_id: A.p.bolo, quantidade_planejada: 10, prazo: '2026-12-01', observacao: 'Encomenda de Natal' });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            produto_id: A.p.bolo,
            ficha_tecnica_id: A.ficha,
            quantidade_planejada: 10,
            quantidade_produzida: null,
            quantidade_perdida: 0,
            status: 'planejada',
            prazo: '2026-12-01',
            observacao: 'Encomenda de Natal',
            criado_por: A.u.estoquista
        });
        expect(await estoque(A, 'ovo')).toBe(100);
        expect(await estoque(A, 'bolo')).toBe(0);
    });
});

// ---- helpers dos próximos cenários ----
const ORD = '/producoes/ordens';
async function novaOrdem(alvo, produto, quantidade, papel = 'estoquista') {
    const res = await post(alvo, papel, ORD, { produto_id: alvo.p[produto], quantidade_planejada: quantidade });

    expect(res.status).toBe(201);
    return res.body.data.id;
}
async function emProducao(alvo, produto, quantidade) {
    const id = await novaOrdem(alvo, produto, quantidade);

    expect((await patch(alvo, 'estoquista', `${ORD}/${id}/iniciar`, {})).status).toBe(200);
    return id;
}
const movimentos = async (id) => (await db.query(`SELECT tipo, quantidade FROM movimentacoes_estoque WHERE motivo = $1 ORDER BY id`, [`Ordem de produção #${id}`])).rows;

describe('criar: validação e isolamento', () => {
    test('produto inexistente ou de outra empresa = 404; insumo, sem ficha e inativo = 400', async () => {
        expect((await post(A, 'estoquista', ORD, { produto_id: B.p.bolo, quantidade_planejada: 1 })).status).toBe(404);
        expect((await post(A, 'estoquista', ORD, { produto_id: 99999999, quantidade_planejada: 1 })).status).toBe(404);
        expect((await post(A, 'estoquista', ORD, { produto_id: A.p.ovo, quantidade_planejada: 1 })).status).toBe(400);
        const semFicha = await post(A, 'estoquista', ORD, { produto_id: A.p.semficha, quantidade_planejada: 1 });

        expect(semFicha.status).toBe(400);
        expect(semFicha.body.message).toBe('Produto não possui ficha técnica cadastrada');
        expect((await post(A, 'estoquista', ORD, { produto_id: A.p.inativo, quantidade_planejada: 1 })).status).toBe(400);
    });

    test('entrada inválida = 400 (quantidade, prazo, campo extra como empresa_id)', async () => {
        const base = { produto_id: A.p.bolo, quantidade_planejada: 5 };

        for (const corpo of [
            { ...base, quantidade_planejada: 0 }, { ...base, quantidade_planejada: 1.5 }, { ...base, quantidade_planejada: 2000000 },
            { ...base, quantidade_planejada: 'abc' }, { ...base, prazo: '01/12/2026' }, { ...base, prazo: '2026-02-30' },
            { ...base, observacao: 'x'.repeat(501) }, { ...base, empresa_id: B.empresaId }, { quantidade_planejada: 5 }
        ]) {
            expect((await post(A, 'estoquista', ORD, corpo)).status).toBe(400);
        }
    });
});

describe('iniciar', () => {
    test('planejada → em produção, com quem iniciou; não mexe no estoque; não repete', async () => {
        const id = await novaOrdem(A, 'bolo', 4);
        const ovoAntes = await estoque(A, 'ovo');
        const res = await patch(A, 'admin', `${ORD}/${id}/iniciar`, {});

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'em_producao', iniciada_por: A.u.admin });
        expect(res.body.data.iniciada_em).toBeTruthy();
        expect(await estoque(A, 'ovo')).toBe(ovoAntes);
        expect((await patch(A, 'admin', `${ORD}/${id}/iniciar`, {})).status).toBe(409);
    });

    test('ordem de outra empresa = 404', async () => {
        const idB = await novaOrdem(B, 'bolo', 1, 'admin');

        expect((await patch(A, 'admin', `${ORD}/${idB}/iniciar`, {})).status).toBe(404);
        expect((await patch(B, 'admin', `${ORD}/${idB}/iniciar`, {})).status).toBe(200);
    });
});

describe('concluir', () => {
    test('consome insumos de (produzida + perdida), dá entrada só da produzida e congela o custo real', async () => {
        const id = await emProducao(A, 'bolo', 10);
        const antes = { ovo: await estoque(A, 'ovo'), farinha: await estoque(A, 'farinha'), bolo: await estoque(A, 'bolo') };
        const res = await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 8, quantidade_perdida: 2 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            status: 'concluida', quantidade_planejada: 10, quantidade_produzida: 8, quantidade_perdida: 2,
            perda_pct: 20, concluida_por: A.u.admin
        });
        // 10 unidades feitas (8 boas + 2 perdidas): 20 ovos e 10 farinhas; custo 20×1 + 10×4 = 60; 60 ÷ 8 boas = 7,5.
        expect(res.body.data).toMatchObject({ custo_insumos: 60, custo_unitario_real: 7.5 });
        expect(await estoque(A, 'ovo')).toBe(antes.ovo - 20);
        expect(await estoque(A, 'farinha')).toBe(antes.farinha - 10);
        expect(await estoque(A, 'bolo')).toBe(antes.bolo + 8);
        expect((await movimentos(id)).map((m) => [m.tipo, m.quantidade])).toEqual([['saida', 20], ['saida', 10], ['entrada', 8]]);
    });

    test('estoquista não recebe nenhum campo de custo; admin recebe', async () => {
        const id = await emProducao(A, 'bolo', 2);
        const res = await patch(A, 'estoquista', `${ORD}/${id}/concluir`, { quantidade_produzida: 2 });

        expect(res.status).toBe(200);
        for (const campo of ['custo_insumos', 'custo_unitario_real']) expect(res.body.data).not.toHaveProperty(campo);
        const detalhe = await get(A, 'estoquista', `${ORD}/${id}`);

        for (const insumo of detalhe.body.data.insumos) expect(insumo).not.toHaveProperty('custo_unitario');
        expect((await get(A, 'admin', `${ORD}/${id}`)).body.data).toHaveProperty('custo_unitario_real');
    });

    test('só perda: consome insumos, não dá entrada no acabado e não calcula custo unitário', async () => {
        const id = await emProducao(A, 'bolo', 3);
        const bolo = await estoque(A, 'bolo');
        const res = await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 0, quantidade_perdida: 3 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ perda_pct: 100, custo_insumos: 18, custo_unitario_real: null });
        expect(await estoque(A, 'bolo')).toBe(bolo);
        expect((await movimentos(id)).map((m) => m.tipo)).toEqual(['saida', 'saida']);
    });

    test('só conclui ordem em produção; concluir de novo = 409 e o estoque não muda', async () => {
        const planejada = await novaOrdem(A, 'bolo', 1);

        expect((await patch(A, 'admin', `${ORD}/${planejada}/concluir`, { quantidade_produzida: 1 })).status).toBe(409);

        const id = await emProducao(A, 'bolo', 1);

        await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 1 });
        const ovo = await estoque(A, 'ovo');

        expect((await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 1 })).status).toBe(409);
        expect(await estoque(A, 'ovo')).toBe(ovo);
    });

    test('insumo insuficiente NÃO trava: baixa o que há, registra a pendência, estoque nunca fica negativo', async () => {
        // Pudim: 3 leites por unidade. 4 pudins pedem 12 leites; só há 5 (o resto pode não ter dado entrada ainda).
        const id = await emProducao(A, 'pudim', 4);
        const res = await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 4 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'concluida', quantidade_produzida: 4, tem_pendencia: true });
        expect(res.body.data.pendencias).toEqual([
            expect.objectContaining({ insumo_produto_id: A.p.leite, nome: 'Item leite', quantidade_prevista: 12, quantidade_baixada: 5, quantidade_pendente: 7 })
        ]);
        expect(await estoque(A, 'leite')).toBe(0); // baixou só o que existia; nunca negativo
        expect(await estoque(A, 'pudim')).toBe(4); // o acabado entra por inteiro
        // custo real usa a necessidade COMPLETA (12 × 2), não só o que foi baixado
        expect(res.body.data).toMatchObject({ custo_insumos: 24, custo_unitario_real: 6 });
        expect((await movimentos(id)).map((m) => [m.tipo, m.quantidade])).toEqual([['saida', 5], ['entrada', 4]]);
    });

    test('insumo sem nenhum saldo: produz do mesmo jeito e a pendência é a necessidade inteira', async () => {
        const id = await emProducao(A, 'sorvete', 3);
        const res = await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 3 });

        expect(res.status).toBe(200);
        expect(res.body.data.pendencias[0]).toMatchObject({ nome: 'Item calda', quantidade_prevista: 6, quantidade_baixada: 0, quantidade_pendente: 6 });
        expect(await estoque(A, 'calda')).toBe(0);
        expect(await estoque(A, 'sorvete')).toBe(3);
        expect((await movimentos(id)).map((m) => m.tipo)).toEqual(['entrada']); // só o acabado; nenhuma saída de insumo
    });

    test('ordem com insumo suficiente não tem pendência', async () => {
        const id = await emProducao(A, 'bolo', 1);
        const res = await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 1 });

        expect(res.body.data).toMatchObject({ tem_pendencia: false, pendencias: [] });
    });

    test('insumo inativo na conclusão = 400 e nada é gravado', async () => {
        await criarProduto(A, 'torta');
        await criarProduto(A, 'fermento', { tipo: 'insumo', custo: 3, estoque: 20 });
        await criarFicha(A, 'torta', [['fermento', 1]]);
        const id = await emProducao(A, 'torta', 2);

        await db.query('UPDATE produtos SET ativo = false WHERE id = $1', [A.p.fermento]);
        const res = await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 2 });

        expect(res.status).toBe(400);
        expect(await estoque(A, 'fermento')).toBe(20);
        expect((await get(A, 'admin', `${ORD}/${id}`)).body.data.status).toBe('em_producao');
    });

    test('duas conclusões simultâneas: só uma vale e o consumo acontece uma vez', async () => {
        const id = await emProducao(A, 'bolo', 5);
        const ovo = await estoque(A, 'ovo');
        const [r1, r2] = await Promise.all([
            patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: 5 }),
            patch(A, 'estoquista', `${ORD}/${id}/concluir`, { quantidade_produzida: 5 })
        ]);

        expect([r1.status, r2.status].sort()).toEqual([200, 409]);
        expect(await estoque(A, 'ovo')).toBe(ovo - 10);
    });

    test('quantidades inválidas = 400 (negativa, nenhuma, decimal, texto, campo extra)', async () => {
        const id = await emProducao(A, 'bolo', 1);

        for (const corpo of [
            { quantidade_produzida: -1 }, { quantidade_produzida: 0 }, { quantidade_produzida: 0, quantidade_perdida: 0 },
            { quantidade_produzida: 1.5 }, { quantidade_produzida: 'abc' }, { quantidade_produzida: 1, quantidade_perdida: -1 },
            { quantidade_produzida: 1, custo_insumos: 0 }, {}
        ]) {
            expect((await patch(A, 'admin', `${ORD}/${id}/concluir`, corpo)).status).toBe(400);
        }
    });
});

describe('cancelar', () => {
    test('planejada e em produção cancelam com motivo, sem mexer no estoque; concluída não', async () => {
        const planejada = await novaOrdem(A, 'bolo', 2);
        const ovo = await estoque(A, 'ovo');
        const res = await patch(A, 'estoquista', `${ORD}/${planejada}/cancelar`, { motivo: 'Cliente desistiu' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'cancelada', motivo_cancelamento: 'Cliente desistiu', cancelada_por: A.u.estoquista });

        const andamento = await emProducao(A, 'bolo', 2);

        expect((await patch(A, 'admin', `${ORD}/${andamento}/cancelar`, { motivo: 'Sem tempo' })).status).toBe(200);
        expect(await estoque(A, 'ovo')).toBe(ovo);

        const feita = await emProducao(A, 'bolo', 1);

        await patch(A, 'admin', `${ORD}/${feita}/concluir`, { quantidade_produzida: 1 });
        expect((await patch(A, 'admin', `${ORD}/${feita}/cancelar`, { motivo: 'Teste' })).status).toBe(409);
        expect((await patch(A, 'admin', `${ORD}/${planejada}/cancelar`, { motivo: 'De novo' })).status).toBe(409);
    });

    test('motivo é obrigatório', async () => {
        const id = await novaOrdem(A, 'bolo', 1);

        for (const corpo of [{}, { motivo: '' }, { motivo: 'ab' }, { motivo: 'x'.repeat(201) }, { motivo: 'ok sim', extra: 1 }]) {
            expect((await patch(A, 'admin', `${ORD}/${id}/cancelar`, corpo)).status).toBe(400);
        }
    });
});

describe('listar e detalhar', () => {
    test('filtra por status e produto, pagina, e mostra os insumos com saldo atual', async () => {
        const id = await novaOrdem(A, 'bolo', 7);
        const lista = await get(A, 'admin', `${ORD}?status=planejada&produto_id=${A.p.bolo}&pageSize=100`);

        expect(lista.status).toBe(200);
        expect(lista.body.data.items.every((o) => o.status === 'planejada' && o.produto_id === A.p.bolo)).toBe(true);
        expect(lista.body.data.items.map((o) => o.id)).toContain(id);
        expect(lista.body.data).toMatchObject({ page: 1 });

        const detalhe = await get(A, 'admin', `${ORD}/${id}`);
        const ovo = detalhe.body.data.insumos.find((i) => i.nome === 'Item ovo');

        expect(detalhe.body.data).toMatchObject({ produto_nome: 'Item bolo', quantidade_planejada: 7 });
        expect(ovo).toMatchObject({ por_unidade: 2, necessario_planejado: 14, disponivel: await estoque(A, 'ovo'), custo_unitario: 1 });
        expect((await get(A, 'admin', `${ORD}?status=outra`)).status).toBe(400);
        expect((await get(A, 'admin', `${ORD}/abc`)).status).toBe(400);
    });

    test('isolamento: empresa B não vê nem acessa as ordens de A', async () => {
        const id = await novaOrdem(A, 'bolo', 1);

        expect((await get(B, 'admin', `${ORD}/${id}`)).status).toBe(404);
        expect((await patch(B, 'admin', `${ORD}/${id}/cancelar`, { motivo: 'invasão' })).status).toBe(404);
        const listaB = await get(B, 'admin', `${ORD}?pageSize=100`);

        expect(listaB.body.data.items.every((o) => o.empresa_id === B.empresaId)).toBe(true);
        expect(listaB.body.data.items.map((o) => o.id)).not.toContain(id);
    });
});

describe('RBAC e flag', () => {
    test('vendedor 403, sem token 401, empresa sem pcp 403 em todas as rotas', async () => {
        const id = await novaOrdem(A, 'bolo', 1);

        expect((await get(A, 'vendedor', ORD)).status).toBe(403);
        expect((await post(A, 'vendedor', ORD, { produto_id: A.p.bolo, quantidade_planejada: 1 })).status).toBe(403);
        expect((await request(app).get(ORD)).status).toBe(401);

        expect((await get(C, 'admin', ORD)).status).toBe(403);
        expect((await post(C, 'admin', ORD, { produto_id: C.p.bolo, quantidade_planejada: 1 })).status).toBe(403);
        expect((await patch(C, 'admin', `${ORD}/${id}/iniciar`, {})).status).toBe(403);
        expect((await get(C, 'admin', '/producoes')).status).toBe(200); // rota antiga segue aberta
    });
});

describe('regularizar insumos pendentes', () => {
    const repor = async (alvo, chave, quantidade) => {
        const { rows } = await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId]);

        await db.query(
            `INSERT INTO estoque_locais (empresa_id, local_id, produto_id, saldo) VALUES ($1, $2, $3, $4)
             ON CONFLICT (produto_id, local_id) DO UPDATE SET saldo = estoque_locais.saldo + EXCLUDED.saldo`,
            [alvo.empresaId, rows[0].id, alvo.p[chave], quantidade]
        );
        await db.query('UPDATE produtos SET estoque_atual = estoque_atual + $1 WHERE id = $2', [quantidade, alvo.p[chave]]);
    };

    async function ordemComPendencia(produto, quantidade) {
        const id = await emProducao(A, produto, quantidade);

        expect((await patch(A, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: quantidade })).status).toBe(200);
        return id;
    }

    test('depois da entrada do insumo, baixa o que há (até o pendente); sem saldo, 409; sem pendência, 409', async () => {
        await db.query('UPDATE estoque_locais SET saldo = 0 WHERE produto_id = $1', [A.p.leite]);
        await db.query('UPDATE produtos SET estoque_atual = 0 WHERE id = $1', [A.p.leite]);
        const id = await ordemComPendencia('pudim', 3); // pede 9 leites, não há nenhum: pendente 9

        const semSaldo = await patch(A, 'admin', `${ORD}/${id}/regularizar-insumos`, {});

        expect(semSaldo.status).toBe(409);
        expect(semSaldo.body.message).toMatch(/Sem saldo/);

        await repor(A, 'leite', 4); // chegou a entrada, mas só parte
        const parcial = await patch(A, 'estoquista', `${ORD}/${id}/regularizar-insumos`, {});

        expect(parcial.status).toBe(200);
        expect(parcial.body.data.pendencias[0]).toMatchObject({ quantidade_baixada: 4, quantidade_pendente: 5 });
        expect(parcial.body.data.tem_pendencia).toBe(true);
        expect(await estoque(A, 'leite')).toBe(0);

        await repor(A, 'leite', 20); // chegou o resto
        const total = await patch(A, 'admin', `${ORD}/${id}/regularizar-insumos`, {});

        expect(total.body.data).toMatchObject({ tem_pendencia: false, pendencias: [] }); // quitada: some da lista
        expect(await estoque(A, 'leite')).toBe(15);
        const regularizacoes = await db.query(
            `SELECT quantidade FROM movimentacoes_estoque WHERE motivo = $1 AND tipo = 'saida' ORDER BY id`,
            [`Regularização ordem de produção #${id}`]
        );

        expect(regularizacoes.rows.map((m) => m.quantidade)).toEqual([4, 5]);

        expect((await patch(A, 'admin', `${ORD}/${id}/regularizar-insumos`, {})).status).toBe(409);
    });

    test('só ordem concluída; outra empresa = 404; sem a flag = 403', async () => {
        const andamento = await emProducao(A, 'bolo', 1);

        expect((await patch(A, 'admin', `${ORD}/${andamento}/regularizar-insumos`, {})).status).toBe(409);

        const id = await ordemComPendencia('sorvete', 1);

        expect((await patch(B, 'admin', `${ORD}/${id}/regularizar-insumos`, {})).status).toBe(404);
        expect((await patch(C, 'admin', `${ORD}/${id}/regularizar-insumos`, {})).status).toBe(403);
        expect((await patch(A, 'vendedor', `${ORD}/${id}/regularizar-insumos`, {})).status).toBe(403);
    });

    test('duas regularizações simultâneas: a baixa acontece uma vez só', async () => {
        const id = await ordemComPendencia('sorvete', 2); // pendente 4 de calda

        await repor(A, 'calda', 100);
        const antes = await estoque(A, 'calda');
        const [r1, r2] = await Promise.all([
            patch(A, 'admin', `${ORD}/${id}/regularizar-insumos`, {}),
            patch(A, 'estoquista', `${ORD}/${id}/regularizar-insumos`, {})
        ]);

        expect([r1.status, r2.status].sort()).toEqual([200, 409]);
        expect(await estoque(A, 'calda')).toBe(antes - 4);
    });

    test('lista e detalhe mostram a pendência; estoquista vê a pendência mas não o custo', async () => {
        await db.query('UPDATE estoque_locais SET saldo = 0 WHERE produto_id = $1', [A.p.calda]); // o teste anterior repôs calda
        await db.query('UPDATE produtos SET estoque_atual = 0 WHERE id = $1', [A.p.calda]);
        const id = await ordemComPendencia('sorvete', 1);
        const lista = await get(A, 'estoquista', `${ORD}?pageSize=100`);

        expect(lista.body.data.items.find((o) => o.id === id)).toMatchObject({ tem_pendencia: true, insumos_pendentes: 1 });

        const detalhe = await get(A, 'estoquista', `${ORD}/${id}`);

        expect(detalhe.body.data.pendencias[0]).toMatchObject({ nome: 'Item calda', quantidade_pendente: 2 });
        expect(detalhe.body.data.pendencias[0]).not.toHaveProperty('custo_unitario');
        expect((await get(A, 'admin', `${ORD}/${id}`)).body.data.pendencias[0]).toHaveProperty('custo_unitario');
    });
});


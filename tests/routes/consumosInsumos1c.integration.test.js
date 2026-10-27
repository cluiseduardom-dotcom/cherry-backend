// Integração de verdade (Postgres da CI/dev): migration 070. Consumo avulso, ajustes de consumo por venda
// (acrescentar, retirar, regularizar), substituição em lote na ficha de venda e relatório de consumo/custo.
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

const A = { u: {} };
const B = { u: {} };
const ids = {};

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Consumo1c ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.centralId = (await db.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING RETURNING id`, [alvo.empresaId]
    )).rows[0]?.id ?? (await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [alvo.empresaId])).rows[0].id;
    for (const papel of ['admin', 'vendedor', 'estoquista']) {
        const { rows: u } = await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
        );
        alvo.u[papel] = u[0].id;
    }
}

async function criarProduto(alvo, { sku, nome, tipo = 'acabado', estoque, custo, preco }) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual, estoque_minimo, tipo)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7) RETURNING id`,
        [alvo.empresaId, sku, nome, preco ?? null, custo, estoque, tipo]
    );
    const id = rows[0].id;
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, alvo.centralId, alvo.empresaId, estoque]);
    if (preco != null) {
        await db.query(
            `INSERT INTO precos_produto (produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, empresa_id) VALUES ($1, $2, $3, 100, 50, $4)`,
            [id, alvo.canalId, preco, alvo.empresaId]
        );
    }
    return id;
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const post = (alvo, papel, url, corpo) => request(app).post(url).set(como(alvo, papel)).send(corpo);
const patch = (alvo, papel, url) => request(app).patch(url).set(como(alvo, papel)).send({});
const ficha = (alvo, produtoId, itens) => post(alvo, 'admin', `/produtos/${produtoId}/ficha-venda`, { itens });
const total = async (alvo, id) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1 AND empresa_id = $2', [id, alvo.empresaId])).rows[0].estoque_atual;
const central = async (alvo, id) => (await db.query('SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2', [id, alvo.centralId])).rows[0].saldo;
const reporEstoque = async (alvo, id, quantidade) => {
    await db.query('UPDATE estoque_locais SET saldo = saldo + $1 WHERE produto_id = $2 AND local_id = $3', [quantidade, id, alvo.centralId]);
    await db.query('UPDATE produtos SET estoque_atual = estoque_atual + $1 WHERE id = $2', [quantidade, id]);
};

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    ids.colar = await criarProduto(A, { sku: 'COL-1', nome: 'Colar', estoque: 50, custo: 15, preco: 60 });
    ids.anel = await criarProduto(A, { sku: 'ANE-1', nome: 'Anel', estoque: 50, custo: 9, preco: 40 });
    ids.embA = await criarProduto(A, { sku: 'EMB-A', nome: 'Embalagem A', tipo: 'insumo', estoque: 20, custo: 0.8 });
    ids.embB = await criarProduto(A, { sku: 'EMB-B', nome: 'Embalagem B', tipo: 'insumo', estoque: 20, custo: 1.2 });
    ids.caneta = await criarProduto(A, { sku: 'CAN-1', nome: 'Caneta brinde', tipo: 'insumo', estoque: 3, custo: 2.5 });
    ids.tag = await criarProduto(A, { sku: 'TAG-1', nome: 'Tag', tipo: 'insumo', estoque: 1, custo: 0.35 });
    ids.insumoB = await criarProduto(B, { sku: 'EMB-X', nome: 'Embalagem X', tipo: 'insumo', estoque: 10, custo: 1 });

    expect((await ficha(A, ids.colar, [{ insumo_produto_id: ids.embA, quantidade: 1 }, { insumo_produto_id: ids.tag, quantidade: 2 }])).status).toBe(201);
    expect((await ficha(A, ids.anel, [{ insumo_produto_id: ids.embA, quantidade: 2 }])).status).toBe(201);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('RBAC e listagem de insumos', () => {
    test('vendedor não acessa nada de /consumos', async () => {
        for (const [metodo, url] of [['get', '/consumos/insumos'], ['get', '/consumos/relatorio'], ['get', '/consumos/avulsos']]) {
            expect((await request(app)[metodo](url).set(como(A, 'vendedor'))).status).toBe(403);
        }
        expect((await post(A, 'vendedor', '/consumos/avulsos', { produto_id: ids.embA, quantidade: 1, motivo: 'perda' })).status).toBe(403);
    });

    test('lista só insumos ativos da própria empresa, com o saldo do Central', async () => {
        const res = await get(A, 'admin', '/consumos/insumos');
        expect(res.status).toBe(200);
        const porSku = Object.fromEntries(res.body.data.map((i) => [i.sku, i]));
        expect(porSku['EMB-A'].saldo_central).toBe(20);
        expect(porSku['COL-1']).toBeUndefined(); // acabado não entra
        expect(porSku['EMB-X']).toBeUndefined(); // outra empresa
    });
});

describe('consumo avulso', () => {
    test('uso interno baixa do Central, grava quem retirou e para quê, e audita a movimentação', async () => {
        const res = await post(A, 'estoquista', '/consumos/avulsos', {
            produto_id: ids.caneta, quantidade: 2, motivo: 'uso_interno', responsavel_id: A.u.vendedor, finalidade: 'Uso no escritório'
        });
        expect(res.status).toBe(201);
        expect(await central(A, ids.caneta)).toBe(1);
        expect(await total(A, ids.caneta)).toBe(1);

        const { rows } = await db.query(`SELECT * FROM consumos_avulsos WHERE id = $1`, [res.body.data.id]);
        expect(rows[0]).toMatchObject({ responsavel_id: A.u.vendedor, criado_por: A.u.estoquista, finalidade: 'Uso no escritório', local_id: A.centralId });
        expect(Number(rows[0].custo_unitario)).toBe(2.5);

        const mov = await db.query(`SELECT tipo, quantidade FROM movimentacoes_estoque WHERE empresa_id = $1 AND motivo = $2`,
            [A.empresaId, `Consumo avulso #${res.body.data.id} (uso_interno)`]);
        expect(mov.rows).toEqual([{ tipo: 'saida', quantidade: 2 }]);
    });

    test('uso interno exige a finalidade; motivo inválido e quantidade inválida são recusados', async () => {
        const semFinalidade = await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.embA, quantidade: 1, motivo: 'uso_interno' });
        expect(semFinalidade.status).toBe(400);
        expect(semFinalidade.body.message).toMatch(/finalidade/i);
        expect((await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.embA, quantidade: 1, motivo: 'roubo' })).status).toBe(400);
        expect((await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.embA, quantidade: 0, motivo: 'perda' })).status).toBe(400);
        expect((await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.embA, quantidade: 1.5, motivo: 'perda' })).status).toBe(400);
    });

    test('nunca deixa o estoque negativo (409) e não grava o registro', async () => {
        const antes = (await db.query('SELECT COUNT(*) FROM consumos_avulsos WHERE empresa_id = $1', [A.empresaId])).rows[0].count;
        const res = await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.caneta, quantidade: 99, motivo: 'perda' });
        expect(res.status).toBe(409);
        expect((await db.query('SELECT COUNT(*) FROM consumos_avulsos WHERE empresa_id = $1', [A.empresaId])).rows[0].count).toBe(antes);
        expect(await central(A, ids.caneta)).toBe(1);
    });

    test('só insumo; insumo de outra empresa e responsável de outra empresa são 404/400', async () => {
        expect((await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.colar, quantidade: 1, motivo: 'perda' })).status).toBe(400);
        expect((await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.insumoB, quantidade: 1, motivo: 'perda' })).status).toBe(404);
        expect((await post(A, 'admin', '/consumos/avulsos', { produto_id: ids.embA, quantidade: 1, motivo: 'perda', responsavel_id: B.u.admin })).status).toBe(404);
    });

    test('histórico lista quem retirou e para quê; outra empresa não vê', async () => {
        const res = await get(A, 'admin', '/consumos/avulsos');
        expect(res.status).toBe(200);
        expect(res.body.data.items.some((i) => i.finalidade === 'Uso no escritório' && i.responsavel_nome)).toBe(true);
        const outra = await get(B, 'admin', '/consumos/avulsos');
        expect(outra.body.data.items).toHaveLength(0);
    });
});

describe('ajustes de consumo por venda', () => {
    test('acrescentar brinde baixa do Central; sem saldo vira pendência; retirar devolve; regularizar baixa depois de repor', async () => {
        const venda = await post(A, 'admin', '/vendas', { itens: [{ produto_id: ids.colar, quantidade: 1 }] });
        expect(venda.status).toBe(201);
        ids.venda = venda.body.data.id;

        // Colar pede 1 embalagem e 2 tags (tag tem 1): linha da tag nasce com pendência.
        const inicial = await get(A, 'admin', `/consumos/vendas/${ids.venda}`);
        expect(inicial.status).toBe(200);
        const linhaTag = inicial.body.data.linhas.find((l) => l.produto_id === ids.tag);
        expect(linhaTag).toMatchObject({ quantidade_prevista: 2, quantidade_baixada: 1, quantidade_pendente: 1, estado: 'pendente' });

        // Acrescenta 1 caneta de brinde (saldo 1) -> baixa 1.
        const add = await post(A, 'admin', `/consumos/vendas/${ids.venda}/linhas`, { produto_id: ids.caneta, quantidade: 1, motivo: 'brinde', observacao: 'Cliente VIP' });
        expect(add.status).toBe(201);
        expect(add.body.data.pendencias).toEqual([]);
        expect(add.body.data.linha).toMatchObject({ origem: 'brinde', quantidade_baixada: 1, observacao: 'Cliente VIP', criado_por: A.u.admin });
        expect(await central(A, ids.caneta)).toBe(0);

        // Outra caneta sem saldo -> pendência, sem bloquear.
        const semSaldo = await post(A, 'admin', `/consumos/vendas/${ids.venda}/linhas`, { produto_id: ids.caneta, quantidade: 2, motivo: 'outro' });
        expect(semSaldo.status).toBe(201);
        expect(semSaldo.body.data.pendencias).toEqual([expect.objectContaining({ quantidade_pendente: 2 })]);
        ids.linhaCanetaPendente = semSaldo.body.data.linha.id;

        // Regularizar sem saldo = 409; repõe 5 e regulariza (baixa 2).
        const semReposicao = await patch(A, 'admin', `/consumos/vendas/${ids.venda}/linhas/${ids.linhaCanetaPendente}/regularizar`);
        expect(semReposicao.status).toBe(409);
        await reporEstoque(A, ids.caneta, 5);
        const reg = await patch(A, 'admin', `/consumos/vendas/${ids.venda}/linhas/${ids.linhaCanetaPendente}/regularizar`);
        expect(reg.status).toBe(200);
        expect(reg.body.data.quantidade_baixada).toBe(2);
        expect(await central(A, ids.caneta)).toBe(3);
        expect((await patch(A, 'admin', `/consumos/vendas/${ids.venda}/linhas/${ids.linhaCanetaPendente}/regularizar`)).status).toBe(409);

        // Retirar a linha do brinde devolve 1 ao Central e marca a linha; retirar de novo = 409.
        const retirar = await patch(A, 'admin', `/consumos/vendas/${ids.venda}/linhas/${add.body.data.linha.id}/retirar`);
        expect(retirar.status).toBe(200);
        expect(retirar.body.data).toMatchObject({ devolucao_tipo: 'retirada', devolvido_por: A.u.admin });
        expect(await central(A, ids.caneta)).toBe(4);
        expect((await patch(A, 'admin', `/consumos/vendas/${ids.venda}/linhas/${add.body.data.linha.id}/retirar`)).status).toBe(409);
        ids.linhaBrinde = add.body.data.linha.id;
    });

    test('estado das linhas e invariante de estoque', async () => {
        const res = await get(A, 'admin', `/consumos/vendas/${ids.venda}`);
        const porId = Object.fromEntries(res.body.data.linhas.map((l) => [l.id, l]));
        expect(porId[ids.linhaBrinde].estado).toBe('retirada');
        expect(porId[ids.linhaCanetaPendente].estado).toBe('ativa');

        const { rows } = await db.query(
            `SELECT p.id FROM produtos p WHERE p.empresa_id = $1
               AND p.estoque_atual <> COALESCE((SELECT SUM(saldo) FROM estoque_locais el WHERE el.produto_id = p.id), 0)`, [A.empresaId]);
        expect(rows).toHaveLength(0);
    });

    test('cancelar a venda não devolve de novo a linha já retirada, e a venda cancelada não aceita ajuste', async () => {
        const antes = await central(A, ids.caneta);
        const cancelada = await request(app).patch(`/vendas/${ids.venda}/cancelar`).set(como(A, 'admin')).send({ motivo: 'Cliente desistiu da compra' });
        expect(cancelada.status).toBe(200);
        // caneta: só a linha regularizada (2) volta; a do brinde já tinha sido retirada (não duplica).
        expect(await central(A, ids.caneta)).toBe(antes + 2);

        const linhas = (await get(A, 'admin', `/consumos/vendas/${ids.venda}`)).body.data.linhas;
        expect(linhas.find((l) => l.id === ids.linhaBrinde).devolucao_tipo).toBe('retirada');
        expect(linhas.find((l) => l.id === ids.linhaCanetaPendente).devolucao_tipo).toBe('cancelamento');

        expect((await post(A, 'admin', `/consumos/vendas/${ids.venda}/linhas`, { produto_id: ids.embA, quantidade: 1, motivo: 'outro' })).status).toBe(409);
        expect((await patch(A, 'admin', `/consumos/vendas/${ids.venda}/linhas/${ids.linhaCanetaPendente}/retirar`)).status).toBe(409);
    });

    test('venda de outra empresa é 404; insumo inválido é recusado', async () => {
        expect((await get(B, 'admin', `/consumos/vendas/${ids.venda}`)).status).toBe(404);
        expect((await post(B, 'admin', `/consumos/vendas/${ids.venda}/linhas`, { produto_id: ids.insumoB, quantidade: 1, motivo: 'brinde' })).status).toBe(404);
        const nova = await post(A, 'admin', '/vendas', { itens: [{ produto_id: ids.anel, quantidade: 1 }] });
        ids.vendaNova = nova.body.data.id;
        expect((await post(A, 'admin', `/consumos/vendas/${ids.vendaNova}/linhas`, { produto_id: ids.colar, quantidade: 1, motivo: 'brinde' })).status).toBe(400);
        expect((await post(A, 'admin', `/consumos/vendas/${ids.vendaNova}/linhas`, { produto_id: ids.insumoB, quantidade: 1, motivo: 'brinde' })).status).toBe(404);
        expect((await post(A, 'admin', `/consumos/vendas/${ids.vendaNova}/linhas`, { produto_id: ids.embA, quantidade: 1, motivo: 'consumo_venda' })).status).toBe(400);
    });
});

describe('substituição em lote na ficha de venda', () => {
    test('prévia lista os SKUs afetados; só insumo', async () => {
        const res = await get(A, 'admin', `/consumos/substituicoes/previa?de_insumo_id=${ids.embA}`);
        expect(res.status).toBe(200);
        expect(res.body.data.afetados.map((a) => a.sku).sort()).toEqual(['ANE-1', 'COL-1']);
        expect((await get(A, 'admin', `/consumos/substituicoes/previa?de_insumo_id=${ids.colar}`)).status).toBe(400);
        expect((await get(A, 'admin', `/consumos/substituicoes/previa?de_insumo_id=${ids.insumoB}`)).status).toBe(404);
    });

    test('troca A por B criando nova versão em cada ficha; vendas antigas mantêm o snapshot', async () => {
        const vendaAntiga = (await post(A, 'admin', '/vendas', { itens: [{ produto_id: ids.anel, quantidade: 1 }] })).body.data.id;
        const res = await post(A, 'admin', '/consumos/substituicoes', { de_insumo_id: ids.embA, para_insumo_id: ids.embB });
        expect(res.status).toBe(200);
        expect(res.body.data.afetados).toHaveLength(2);

        const fichaAnel = (await get(A, 'admin', `/produtos/${ids.anel}/ficha-venda`)).body.data;
        expect(fichaAnel.itens.map((i) => [i.insumo_produto_id, i.quantidade])).toEqual([[ids.embB, 2]]);
        const hist = (await get(A, 'admin', `/produtos/${ids.anel}/ficha-venda/historico`)).body.data;
        expect(hist.length).toBeGreaterThanOrEqual(2);
        expect(hist.filter((f) => f.vigente)).toHaveLength(1);

        const antigo = await get(A, 'admin', `/consumos/vendas/${vendaAntiga}`);
        expect(antigo.body.data.linhas[0].produto_id).toBe(ids.embA);

        // Venda nova já consome a embalagem B.
        const nova = (await post(A, 'admin', '/vendas', { itens: [{ produto_id: ids.anel, quantidade: 1 }] })).body.data.id;
        expect((await get(A, 'admin', `/consumos/vendas/${nova}`)).body.data.linhas[0].produto_id).toBe(ids.embB);
    });

    test('se o substituto já estava na ficha, as quantidades somam; validações', async () => {
        await ficha(A, ids.colar, [{ insumo_produto_id: ids.embA, quantidade: 1 }, { insumo_produto_id: ids.embB, quantidade: 3 }]);
        const res = await post(A, 'admin', '/consumos/substituicoes', { de_insumo_id: ids.embA, para_insumo_id: ids.embB });
        expect(res.status).toBe(200);
        // embA ainda é usada por nenhuma ficha vigente aqui; colar tinha embA(1)+embB(3) -> embB(4).
        const fichaColar = (await get(A, 'admin', `/produtos/${ids.colar}/ficha-venda`)).body.data;
        expect(fichaColar.itens.map((i) => [i.insumo_produto_id, i.quantidade])).toEqual([[ids.embB, 4]]);

        expect((await post(A, 'admin', '/consumos/substituicoes', { de_insumo_id: ids.embA, para_insumo_id: ids.embA })).status).toBe(400);
        expect((await post(A, 'admin', '/consumos/substituicoes', { de_insumo_id: ids.embA, para_insumo_id: ids.insumoB })).status).toBe(404);
        expect((await post(A, 'admin', '/consumos/substituicoes', { de_insumo_id: ids.embA, para_insumo_id: ids.colar })).status).toBe(400);
        const semUso = await post(A, 'admin', '/consumos/substituicoes', { de_insumo_id: ids.embA, para_insumo_id: ids.embB });
        expect(semUso.body.data.afetados).toEqual([]);
    });

    test('vendedor é 403 e outra empresa não é afetada', async () => {
        expect((await post(A, 'vendedor', '/consumos/substituicoes', { de_insumo_id: ids.embA, para_insumo_id: ids.embB })).status).toBe(403);
        const { rows } = await db.query('SELECT COUNT(*) FROM fichas_venda WHERE empresa_id = $1', [B.empresaId]);
        expect(rows[0].count).toBe('0');
    });
});

describe('relatório de consumo e custo (competência)', () => {
    test('soma consumo das vendas (não devolvido) e avulso, por insumo e motivo, com totais', async () => {
        const res = await get(A, 'admin', '/consumos/relatorio');
        expect(res.status).toBe(200);
        const { itens, totais } = res.body.data;
        const caneta = itens.filter((i) => i.produto_id === ids.caneta);
        // avulso uso_interno (2 × 2,50 = 5,00); a venda cancelada não conta.
        expect(caneta.find((i) => i.motivo === 'uso_interno')).toMatchObject({ quantidade: 2, custo_total: 5 });
        expect(caneta.some((i) => i.motivo === 'brinde')).toBe(false);
        expect(totais.por_motivo.find((m) => m.motivo === 'uso_interno').custo_total).toBe(5);
        expect(typeof totais.custo_total).toBe('number');
    });

    test('filtros por motivo, insumo e período; período inválido é 400', async () => {
        const porMotivo = await get(A, 'admin', '/consumos/relatorio?motivo=uso_interno');
        expect(porMotivo.body.data.itens.every((i) => i.motivo === 'uso_interno')).toBe(true);
        const porInsumo = await get(A, 'admin', `/consumos/relatorio?produto_id=${ids.embB}`);
        expect(porInsumo.body.data.itens.every((i) => i.produto_id === ids.embB)).toBe(true);
        const futuro = await get(A, 'admin', '/consumos/relatorio?de=2999-01-01&ate=2999-12-31');
        expect(futuro.body.data.itens).toEqual([]);
        expect((await get(A, 'admin', '/consumos/relatorio?de=2026-02-01&ate=2026-01-01')).status).toBe(400);
        expect((await get(A, 'admin', '/consumos/relatorio?de=01/02/2026')).status).toBe(400);
    });

    test('isolamento: outra empresa tem relatório vazio', async () => {
        const res = await get(B, 'admin', '/consumos/relatorio');
        expect(res.body.data.itens).toEqual([]);
    });

    test('quem não tem ver_custos não recebe valores em nenhuma resposta de consumo', async () => {
        const res = await get(A, 'estoquista', '/consumos/relatorio');
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data)).not.toMatch(/custo/i);
        const insumos = await get(A, 'estoquista', '/consumos/insumos');
        expect(JSON.stringify(insumos.body.data)).not.toMatch(/"custo"/);
        const avulsos = await get(A, 'estoquista', '/consumos/avulsos');
        expect(JSON.stringify(avulsos.body.data)).not.toMatch(/custo/i);
    });
});

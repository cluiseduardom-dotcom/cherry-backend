// Integração (Postgres de testes): aviso do sino para insumo com baixa pendente em ordem de produção concluída.
// Só com a funcionalidade `pcp`, só admin/estoquista, isolado por empresa, e some quando a pendência é regularizada.
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
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Sino PCP ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.central = (await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [alvo.empresaId])).rows[0].id;
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

async function criarProduto(alvo, chave, { tipo = 'acabado', unidade = 'UN', estoque = 0 } = {}) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, tipo, unidade) VALUES ($1, $2, $3, 0.01, 1, $4, $5, $6) RETURNING id`,
        [alvo.empresaId, `SPCP-${chave}-${alvo.empresaId}-${sufixo}`, `Item ${chave}`, estoque, tipo, unidade]
    );
    alvo.p[chave] = rows[0].id;
    if (estoque > 0) {
        await db.query(`INSERT INTO estoque_locais (empresa_id, local_id, produto_id, saldo) VALUES ($1, $2, $3, $4)`, [alvo.empresaId, alvo.central, rows[0].id, estoque]);
    }
}

async function criarFicha(alvo, produto, itens) {
    const { rows } = await db.query(`INSERT INTO fichas_tecnicas (empresa_id, produto_id, vigente, criado_por) VALUES ($1, $2, true, $3) RETURNING id`, [alvo.empresaId, alvo.p[produto], alvo.u.admin]);
    for (const [insumo, quantidade] of itens) {
        await db.query(`INSERT INTO itens_ficha_tecnica (ficha_tecnica_id, insumo_produto_id, quantidade_necessaria, empresa_id) VALUES ($1, $2, $3, $4)`, [rows[0].id, alvo.p[insumo], quantidade, alvo.empresaId]);
    }
}

const como = (alvo, papel) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}` });
const get = (alvo, papel, url) => request(app).get(url).set(como(alvo, papel));
const enviar = (metodo) => (alvo, papel, url, corpo) => request(app)[metodo](url).set(como(alvo, papel)).send(corpo);
const post = enviar('post');
const patch = enviar('patch');
const ORD = '/producoes/ordens';
const sino = async (alvo, papel) => (await get(alvo, papel, '/notificacoes')).body.data.itens.filter((i) => i.tipo === 'insumo_pendente_producao');

async function concluirOrdem(alvo, quantidade) {
    const id = (await post(alvo, 'admin', ORD, { produto_id: alvo.p.bolo, quantidade_planejada: quantidade })).body.data.id;

    await patch(alvo, 'admin', `${ORD}/${id}/iniciar`, {});
    expect((await patch(alvo, 'admin', `${ORD}/${id}/concluir`, { quantidade_produzida: quantidade })).status).toBe(200);

    return id;
}

beforeAll(async () => {
    await criarEmpresa(A, 'A', { pcp: true });
    await criarEmpresa(B, 'B', { pcp: true });
    await criarEmpresa(C, 'C', { pcp: false });

    // Bolo: 200 g de farinha por unidade; só há 300 g no Central.
    for (const alvo of [A, B, C]) {
        await criarProduto(alvo, 'bolo');
        await criarProduto(alvo, 'farinha', { tipo: 'insumo', unidade: 'G', estoque: 300 });
        await criarFicha(alvo, 'bolo', [['farinha', 200]]);
    }
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('sino: insumo pendente na produção', () => {
    test('sem ordem concluída com falta, não há aviso', async () => {
        expect(await sino(A, 'admin')).toEqual([]);
    });

    test('3 bolos pedem 600 g e há 300 g: a produção sai, a pendência vira aviso com 300 g, em 1 ordem', async () => {
        A.ordem = await concluirOrdem(A, 3);

        const [aviso] = await sino(A, 'admin');

        expect(aviso).toMatchObject({ id: `insumo_pendente_producao:${A.p.farinha}`, prioridade: 'alta', produto_id: A.p.farinha, dados: { quantidade_pendente: 300, ordens: 1 } });
        expect(aviso.mensagem).toContain('300 g');
        expect((await sino(A, 'estoquista'))).toHaveLength(1);
    });

    test('vendedor não recebe; empresa sem a funcionalidade pcp não recebe; outra empresa não vê', async () => {
        await concluirOrdem(C, 3).catch(() => {}); // sem pcp a rota nem abre (403): nada a avisar
        await db.query(
            `INSERT INTO ordens_producao (empresa_id, produto_id, ficha_tecnica_id, quantidade_planejada, status, quantidade_produzida, concluida_em, criado_por)
             SELECT $1, $2, f.id, 3, 'concluida', 3, NOW(), $3 FROM fichas_tecnicas f WHERE f.empresa_id = $1 AND f.produto_id = $2`,
            [C.empresaId, C.p.bolo, C.u.admin]
        );
        const ordemC = (await db.query('SELECT id FROM ordens_producao WHERE empresa_id = $1', [C.empresaId])).rows[0].id;

        await db.query(
            `INSERT INTO ordem_producao_consumos (empresa_id, ordem_id, insumo_produto_id, local_id, quantidade_prevista, quantidade_baixada) VALUES ($1, $2, $3, $4, 600, 300)`,
            [C.empresaId, ordemC, C.p.farinha, C.central]
        );

        expect(await sino(A, 'vendedor')).toEqual([]);
        expect(await sino(C, 'admin')).toEqual([]); // há pendência no banco, mas a empresa não tem pcp
        expect(await sino(B, 'admin')).toEqual([]);
    });

    test('regularizar a pendência (depois de dar entrada do insumo) faz o aviso sumir', async () => {
        await db.query(`UPDATE estoque_locais SET saldo = saldo + 500 WHERE empresa_id = $1 AND produto_id = $2`, [A.empresaId, A.p.farinha]);
        await db.query(`UPDATE produtos SET estoque_atual = estoque_atual + 500 WHERE id = $1`, [A.p.farinha]);
        expect((await patch(A, 'admin', `${ORD}/${A.ordem}/regularizar-insumos`, {})).status).toBe(200);

        expect(await sino(A, 'admin')).toEqual([]);
    });
});

describe('sino: ordem de produção atrasada', () => {
    const atrasadas = async (alvo, papel) => (await get(alvo, papel, '/notificacoes')).body.data.itens.filter((i) => i.tipo === 'ordem_producao_atrasada');
    const ordemComPrazo = async (alvo, { prazoSql, status = 'planejada' }) => (await db.query(
        `INSERT INTO ordens_producao (empresa_id, produto_id, ficha_tecnica_id, quantidade_planejada, status, prazo, criado_por)
         SELECT $1, $2, f.id, 5, $3, ${prazoSql}, $4 FROM fichas_tecnicas f WHERE f.empresa_id = $1 AND f.produto_id = $2 LIMIT 1 RETURNING id`,
        [alvo.empresaId, alvo.p.bolo, status, alvo.u.admin]
    )).rows[0].id;

    test('planejada com prazo de 3 dias atrás avisa; prazo de hoje, futuro ou sem prazo não; concluída e cancelada nunca', async () => {
        const vencida = await ordemComPrazo(A, { prazoSql: `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 3` });

        await ordemComPrazo(A, { prazoSql: `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date` });
        await ordemComPrazo(A, { prazoSql: `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date + 2` });
        await ordemComPrazo(A, { prazoSql: 'NULL' });
        await db.query(
            `INSERT INTO ordens_producao (empresa_id, produto_id, ficha_tecnica_id, quantidade_planejada, status, prazo, quantidade_produzida, concluida_em, criado_por)
             SELECT $1, $2, f.id, 5, 'concluida', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 9, 5, NOW(), $3 FROM fichas_tecnicas f WHERE f.empresa_id = $1 AND f.produto_id = $2 LIMIT 1`,
            [A.empresaId, A.p.bolo, A.u.admin]
        );
        await db.query(
            `INSERT INTO ordens_producao (empresa_id, produto_id, ficha_tecnica_id, quantidade_planejada, status, prazo, cancelada_em, criado_por)
             SELECT $1, $2, f.id, 5, 'cancelada', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 9, NOW(), $3 FROM fichas_tecnicas f WHERE f.empresa_id = $1 AND f.produto_id = $2 LIMIT 1`,
            [A.empresaId, A.p.bolo, A.u.admin]
        );

        const lista = await atrasadas(A, 'admin');

        expect(lista.map((i) => i.id)).toEqual([`ordem_producao_atrasada:${vencida}`]);
        expect(lista[0]).toMatchObject({ prioridade: 'media', dados: { ordem_id: vencida, dias_atraso: 3, status: 'planejada' } });
        A.vencida = vencida;
    });

    test('mais de 7 dias sobe para alta; em produção também conta; estoquista recebe', async () => {
        const antiga = await ordemComPrazo(A, { prazoSql: `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 10`, status: 'em_producao' });
        const lista = await atrasadas(A, 'estoquista');

        expect(lista.find((i) => i.dados.ordem_id === antiga)).toMatchObject({ prioridade: 'alta', dados: { dias_atraso: 10, status: 'em_producao' } });
        expect(lista).toHaveLength(2);
    });

    test('vendedor, empresa sem pcp e outra empresa não recebem', async () => {
        await ordemComPrazo(C, { prazoSql: `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 5` });

        expect(await atrasadas(A, 'vendedor')).toEqual([]);
        expect(await atrasadas(C, 'admin')).toEqual([]);
        expect(await atrasadas(B, 'admin')).toEqual([]);
    });

    test('concluir a ordem faz o aviso sumir', async () => {
        expect((await patch(A, 'admin', `${ORD}/${A.vencida}/iniciar`, {})).status).toBe(200);
        expect((await patch(A, 'admin', `${ORD}/${A.vencida}/concluir`, { quantidade_produzida: 5 })).status).toBe(200);

        expect((await atrasadas(A, 'admin')).some((i) => i.dados.ordem_id === A.vencida)).toBe(false);
    });
});

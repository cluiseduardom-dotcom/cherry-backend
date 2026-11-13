// Integração de verdade (Postgres de testes): seção comercial da Home da loja (faixas de preço automáticas, últimas unidades
// e textos editáveis). Prova: (1) desligada por padrão, a Home não muda; (2) gestão só para admin com a loja ligada e isolada por
// empresa; (3) faixas e últimas unidades saem só de dado real (preço online, saldo do Central, foto); (4) só os textos
// preenchidos saem; (5) nenhum campo sensível sai. Empresas "Teste ..." temporárias, removidas no fim.
// O armazenamento de imagens (R2) não existe nos testes: só a função de URL pública é simulada.
jest.mock('../../src/services/storage/imagensStorage', () => ({
    configurado: () => false,
    urlPublica: (chave) => (chave ? `https://fotos.exemplo.test/${chave}` : null)
}));

const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const SEGREDO = `NOTA-INTERNA-${sufixo}`;
const A = { slug: `teste-a-${sufixo}`, p: {} };
const B = { slug: `teste-b-${sufixo}`, p: {} };
const SEM_FLAG = { slug: `teste-c-${sufixo}`, p: {} };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const publico = (E) => request(app).get(`/loja/${E.slug}/vitrines`);
const gestao = (E, papel = 'admin') => ({
    get: () => request(app).get('/loja-home-vendas').set('Authorization', `Bearer ${papel === 'admin' ? E.tokenAdmin : E.tokenVendedor}`),
    put: (corpo) => request(app).put('/loja-home-vendas').set('Authorization', `Bearer ${papel === 'admin' ? E.tokenAdmin : E.tokenVendedor}`).send(corpo)
});

async function criarEmpresa(E, nome, { comLoja = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${nome} ${sufixo}`, E.slug]));
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'online') RETURNING id`, [E.id]);
    E.central = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);
    E.transito = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'transito', 'Em trânsito') RETURNING id`, [E.id]);
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.slug}@teste.local`]);
    E.vendedor = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Vend', $2, 'x', 'vendedor') RETURNING id`, [E.id, `ven-${E.slug}@teste.local`]);
    E.tokenAdmin = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    E.tokenVendedor = makeToken({ id: E.vendedor, role: 'vendedor', empresa_id: E.id, tv: 0 });

    if (comLoja) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

// Peça completa à venda: preço no canal online, saldo no Central, marcação visível e (opcional) foto.
async function criarProduto(E, chave, { preco, saldo = 3, foto = true, saldoTransito = 0 }) {
    const id = await um(`INSERT INTO produtos (empresa_id, nome, descricao, custo, preco_venda, tipo, ativo) VALUES ($1, $2, $3, 11.11, 77.77, 'acabado', true) RETURNING id`, [E.id, `Peça ${chave}`, SEGREDO]);

    E.p[chave] = id;
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 123.45, 55.55)`, [E.id, id, E.canal, preco]);

    if (saldo > 0) await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, E.central, E.id, saldo]);
    if (saldoTransito > 0) await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) VALUES ($1, $2, $3, $4)`, [id, E.transito, E.id, saldoTransito]);

    await db.query(`INSERT INTO produtos_loja (produto_id, empresa_id, visivel, slug) VALUES ($1, $2, true, $3)`, [id, E.id, `${chave}-${id}`]);

    if (foto) {
        await db.query(`INSERT INTO produto_imagens (empresa_id, produto_id, chave, content_type, tamanho_bytes, ordem) VALUES ($1, $2, $3, 'image/png', 10, 0)`, [E.id, id, `${E.id}/produtos/${id}.png`]);
    }

    return id;
}

beforeAll(async () => {
    await criarEmpresa(A, 'Home A');
    await criarEmpresa(B, 'Home B');
    await criarEmpresa(SEM_FLAG, 'Home Sem Flag', { comLoja: false });

    // A: 14 peças com preços variados; entre elas, saldos 1 e 2 com foto, e casos que NÃO podem aparecer em "últimas unidades".
    const precos = [15, 18, 22, 25, 28, 30, 35, 39, 45, 52, 60, 75, 90, 120];
    for (const [i, preco] of precos.entries()) {
        await criarProduto(A, `p${i}`, { preco, saldo: i < 3 ? 1 : i === 3 ? 2 : 5 });
    }
    await criarProduto(A, 'semfoto', { preco: 40, saldo: 1, foto: false });
    await criarProduto(A, 'esgotada', { preco: 33, saldo: 0 });
    await criarProduto(A, 'sotransito', { preco: 44, saldo: 0, saldoTransito: 1 });

    // B: poucas peças (não deve gerar faixas) e uma única de saldo 1.
    for (const [i, preco] of [20, 30, 40].entries()) await criarProduto(B, `b${i}`, { preco, saldo: i === 0 ? 1 : 4 });
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('desligada por padrão', () => {
    test('a Home pública NÃO traz a seção enquanto o admin não liga', async () => {
        const res = await publico(A);

        expect(res.status).toBe(200);
        expect(res.body.data).not.toHaveProperty('secao_vendas');
        expect(res.body.data).toHaveProperty('novidades');
    });

    test('a gestão mostra desligado e sem textos', async () => {
        const res = await gestao(A).get();

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ home_vendas_ativo: false, home_presentes_titulo: null, home_presentes_texto: null, home_ultimas_titulo: null, home_ultimas_texto: null, home_ajuda_titulo: null, home_ajuda_texto: null });
    });
});

describe('gestão no ERP: permissão e isolamento', () => {
    test('sem token: 401; vendedor: 403; empresa sem a funcionalidade loja_online: 403 até para o admin', async () => {
        expect((await request(app).get('/loja-home-vendas')).status).toBe(401);
        expect((await gestao(A, 'vendedor').get()).status).toBe(403);
        expect((await gestao(A, 'vendedor').put({ home_vendas_ativo: true })).status).toBe(403);
        expect((await gestao(SEM_FLAG).get()).status).toBe(403);
    });

    test('valida: título longo, texto longo e tipo errado voltam 400 com mensagem', async () => {
        expect((await gestao(A).put({ home_presentes_titulo: 'x'.repeat(81) })).status).toBe(400);
        expect((await gestao(A).put({ home_ajuda_texto: 'x'.repeat(201) })).status).toBe(400);
        const res = await gestao(A).put({ home_vendas_ativo: 'sim' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/verdadeiro ou falso/);
    });

    test('salva só o que veio (os demais ficam), apara espaços e texto vazio vira null', async () => {
        const salvo = await gestao(A).put({ home_presentes_titulo: '  Presente para todo bolso  ', home_ultimas_titulo: 'Últimas unidades' });

        expect(salvo.status).toBe(200);
        expect(salvo.body.data.home_presentes_titulo).toBe('Presente para todo bolso');
        expect(salvo.body.data.home_vendas_ativo).toBe(false);

        const depois = await gestao(A).put({ home_ultimas_titulo: '   ', home_ajuda_texto: 'Conte para quem é.' });

        expect(depois.body.data.home_ultimas_titulo).toBeNull();
        expect(depois.body.data.home_presentes_titulo).toBe('Presente para todo bolso');
        expect(depois.body.data.home_ajuda_texto).toBe('Conte para quem é.');
    });

    test('uma empresa nunca vê nem altera a configuração de outra', async () => {
        expect((await gestao(B).get()).body.data.home_presentes_titulo).toBeNull();
        await gestao(B).put({ home_presentes_titulo: 'Só da B' });

        expect((await gestao(A).get()).body.data.home_presentes_titulo).toBe('Presente para todo bolso');
        expect((await gestao(B).get()).body.data.home_presentes_titulo).toBe('Só da B');
    });
});

describe('seção ligada: dados reais', () => {
    beforeAll(async () => {
        await gestao(A).put({ home_vendas_ativo: true });
        await gestao(B).put({ home_vendas_ativo: true });
    });

    test('só os textos preenchidos saem (os vazios ficam de fora: a loja usa o padrão)', async () => {
        const { secao_vendas: s } = (await publico(A)).body.data;

        expect(s.textos).toEqual({ presentes_titulo: 'Presente para todo bolso', ajuda_texto: 'Conte para quem é.' });
    });

    test('faixas automáticas: crescentes, com contagem real das peças DISPONÍVEIS e "todas" no fim', async () => {
        const { faixas_preco: faixas } = (await publico(A)).body.data.secao_vendas;
        // Disponíveis: as 14 de preço conhecido + a sem foto (R$ 40, saldo 1). Esgotada e só-trânsito não contam.
        const disponiveis = [15, 18, 22, 25, 28, 30, 35, 39, 45, 52, 60, 75, 90, 120, 40];

        expect(faixas.at(-1)).toEqual({ ate: null, quantidade: disponiveis.length });
        for (const f of faixas.slice(0, -1)) expect(f.quantidade).toBe(disponiveis.filter((p) => p <= f.ate).length);
        expect(faixas.slice(0, -1).map((f) => f.ate)).toEqual([...faixas.slice(0, -1).map((f) => f.ate)].sort((a, b) => a - b));
    });

    test('poucas peças (loja B): sem faixas, a Home esconde essa parte', async () => {
        expect((await publico(B)).body.data.secao_vendas.faixas_preco).toEqual([]);
    });

    test('últimas unidades: só saldo 1 ou 2 no Central, com foto, disponível; as de menor saldo primeiro; no máximo 4', async () => {
        const { ultimas_unidades: ultimas } = (await publico(A)).body.data.secao_vendas;
        const nomes = ultimas.map((u) => u.nome);

        expect(ultimas.length).toBeLessThanOrEqual(4);
        expect(ultimas.length).toBeGreaterThanOrEqual(2);
        expect(ultimas.every((u) => u.quantidade_disponivel >= 1 && u.quantidade_disponivel <= 2 && u.disponivel === true && u.imagens.length > 0)).toBe(true);
        expect(nomes).not.toContain('Peça semfoto');
        expect(nomes).not.toContain('Peça esgotada');
        expect(nomes).not.toContain('Peça sotransito');
        const saldos = ultimas.map((u) => u.quantidade_disponivel);
        expect(saldos).toEqual([...saldos].sort((a, b) => a - b));
    });

    test('isolamento: a seção de uma empresa só traz peças dela', async () => {
        const deB = (await publico(B)).body.data.secao_vendas.ultimas_unidades.map((u) => u.nome);

        expect(deB.every((n) => n.startsWith('Peça b'))).toBe(true);
    });

    test('nenhum dado sensível sai (custo, margem, markup, texto interno, ids)', async () => {
        const texto = JSON.stringify((await publico(A)).body.data.secao_vendas);

        expect(texto).not.toMatch(/custo|margem|markup|11\.11|77\.77|123\.45|55\.55|_produto_id|empresa_id/i);
        expect(texto).not.toContain(SEGREDO);
    });

    test('desligar de novo tira a seção da Home', async () => {
        await gestao(A).put({ home_vendas_ativo: false });

        expect((await publico(A)).body.data).not.toHaveProperty('secao_vendas');
        await gestao(A).put({ home_vendas_ativo: true });
    });
});

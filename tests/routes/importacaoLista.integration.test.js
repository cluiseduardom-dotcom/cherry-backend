// Integração de verdade (Postgres de testes): importação de lista (prévia -> confirmação -> relatório).
// Prova, com banco real (os testes unitários usam mocks): (1) acesso: vendedor/estoquista 403, sem token 401, empresa sem o
// módulo 403; (2) produtos: criados sem preço, com vínculo importacao_id, estoque inicial como movimentação rastreável,
// soma dos locais = estoque_atual, código de barras e trava por empresa; (3) segunda importação de saldo recusada, produto
// novo sem saldo continua importável; (4) atomicidade: falha no meio não grava nada e o token continua válido; (5) token de
// uso único, inclusive com duas confirmações simultâneas; (6) token expirado = 410; (7) isolamento entre empresas (token,
// relatório e conflitos de SKU/nome/telefone); (8) clientes e relatório sem dado pessoal. Empresas "Teste ..." removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'Import A' };
const B = { nome: 'Import B' };
const SEM = { nome: 'Import Sem Modulo' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const com = (E, papel) => ({ admin: E.tokenAdmin, vendedor: E.tokenVendedor, estoquista: E.tokenEstoquista })[papel];

async function criarEmpresa(E, { modulo = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, `imp-${E.nome.toLowerCase().replace(/\W+/g, '-')}-${sufixo}`]));
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.id}-${sufixo}@teste.local`]);
    E.vendedor = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Vend', $2, 'x', 'vendedor') RETURNING id`, [E.id, `ven-${E.id}-${sufixo}@teste.local`]);
    E.estoquista = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Estq', $2, 'x', 'estoquista') RETURNING id`, [E.id, `est-${E.id}-${sufixo}@teste.local`]);
    E.tokenAdmin = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    E.tokenVendedor = makeToken({ id: E.vendedor, role: 'vendedor', empresa_id: E.id, tv: 0 });
    E.tokenEstoquista = makeToken({ id: E.estoquista, role: 'estoquista', empresa_id: E.id, tv: 0 });
    const central = await db.query(`SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`, [E.id]);
    E.central = central.rows[0]?.id ?? await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') RETURNING id`, [E.id]);

    if (modulo) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'importacao_lista', true, 'teste', 'teste')`, [E.id]);
    }
}

const previa = (E, tipo, csv, papel = 'admin', extra = {}) => {
    let r = request(app).post('/importacao/previa').set('Authorization', `Bearer ${com(E, papel)}`).field('tipo', tipo);
    for (const [k, v] of Object.entries(extra)) r = r.field(k, String(v));
    return r.attach('arquivo', Buffer.from(csv, 'utf8'), { filename: 'lista.csv', contentType: 'text/csv' });
};
const confirmar = (E, corpo, papel = 'admin') => request(app).post('/importacao/confirmar').set('Authorization', `Bearer ${com(E, papel)}`).send(corpo);
const relatorio = (E, id, papel = 'admin') => request(app).get(`/importacao/${id}/relatorio`).set('Authorization', `Bearer ${com(E, papel)}`);
const contar = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await criarEmpresa(SEM, { modulo: false });
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('acesso', () => {
    test('vendedor e estoquista 403; sem token 401; empresa sem o módulo 403', async () => {
        const csv = 'nome;custo\nX;1,00\n';
        expect((await previa(A, 'produtos', csv, 'vendedor')).status).toBe(403);
        expect((await previa(A, 'produtos', csv, 'estoquista')).status).toBe(403);
        expect((await confirmar(A, { token: 'x'.repeat(43) }, 'vendedor')).status).toBe(403);
        expect((await relatorio(A, 1, 'estoquista')).status).toBe(403);
        expect((await request(app).post('/importacao/previa')).status).toBe(401);
        expect((await previa(SEM, 'produtos', csv)).status).toBe(403);
    });
});

describe('produtos: confirmação, estoque inicial e trava', () => {
    test('prévia não grava nada; confirmar grava produtos sem preço, entrada rastreável, código e trava', async () => {
        const csv = [
            'nome;custo;saldo;sku',
            'Anel Prata;R$ 12,50;10;AN-001',
            'Brinco Ouro;30,00;5;BR-001',
            'Colar Sem Saldo;8,00;;CO-001'
        ].join('\n');

        const p = await previa(A, 'produtos', csv);
        expect(p.status).toBe(200);
        expect(p.body.data.totais).toMatchObject({ linhas: 3, a_criar: 3, com_erro: 0 });
        expect(await contar('SELECT COUNT(*) n FROM produtos WHERE empresa_id = $1', [A.id])).toBe(0);
        expect(JSON.stringify(p.body)).not.toMatch(/"custo"/);

        const c = await confirmar(A, { token: p.body.data.token });
        expect(c.status).toBe(201);
        expect(c.body.data).toMatchObject({ criados: 3, com_estoque_inicial: 2, unidades_estoque_inicial: 15, codigos_gerados: 2, sem_preco: 3 });
        A.importacaoId = c.body.data.importacao_id;

        const prods = (await db.query('SELECT sku, custo, preco_venda, estoque_atual, importacao_id FROM produtos WHERE empresa_id = $1 ORDER BY sku', [A.id])).rows;
        expect(prods.map((r) => [r.sku, Number(r.custo), r.preco_venda, r.estoque_atual, r.importacao_id])).toEqual([
            ['AN-001', 12.5, null, 10, A.importacaoId],
            ['BR-001', 30, null, 5, A.importacaoId],
            ['CO-001', 8, null, 0, A.importacaoId]
        ]);

        const movs = (await db.query(`SELECT tipo, origem, quantidade, local_id, usuario_id FROM movimentacoes_estoque WHERE empresa_id = $1 ORDER BY quantidade`, [A.id])).rows;
        expect(movs).toHaveLength(2);
        for (const m of movs) expect(m).toMatchObject({ tipo: 'entrada', origem: 'estoque_inicial', local_id: A.central, usuario_id: A.admin });

        const soma = await contar(`SELECT COALESCE(SUM(saldo),0) n FROM estoque_locais WHERE empresa_id = $1`, [A.id]);
        expect(soma).toBe(15);
        expect(await contar(`SELECT COUNT(*) n FROM produtos_codigos WHERE empresa_id = $1`, [A.id])).toBe(2);

        const imp = (await db.query('SELECT status, confirmada_por, relatorio IS NOT NULL AS tem FROM importacoes WHERE id = $1', [A.importacaoId])).rows[0];
        expect(imp).toMatchObject({ status: 'confirmada', confirmada_por: A.admin, tem: true });
        expect((await db.query('SELECT estoque_inicial_lancado_em t FROM empresas WHERE id = $1', [A.id])).rows[0].t).not.toBeNull();
        expect(await contar('SELECT COUNT(*) n FROM importacoes_previas WHERE empresa_id = $1', [A.id])).toBe(0);
    });

    test('token de uso único: segunda confirmação responde 404', async () => {
        const p = await previa(A, 'produtos', 'nome;custo;sku\nPulseira Uso Unico;5,00;PU-1\n');
        expect((await confirmar(A, { token: p.body.data.token })).status).toBe(201);
        expect((await confirmar(A, { token: p.body.data.token })).status).toBe(404);
    });

    test('segundo saldo inicial é recusado na prévia; produto novo sem saldo continua importável', async () => {
        const comSaldo = await previa(A, 'produtos', 'nome;custo;saldo;sku\nCorrente;20,00;3;CR-001\n');
        expect(comSaldo.status).toBe(200);
        expect(comSaldo.body.data.totais.com_erro).toBe(1);
        expect(JSON.stringify(comSaldo.body.data.problemas)).toMatch(/saldo inicial já lançado/);
        expect(comSaldo.body.data.token).toBeNull();

        const semSaldo = await previa(A, 'produtos', 'nome;custo;sku\nCorrente;20,00;CR-001\n');
        expect((await confirmar(A, { token: semSaldo.body.data.token })).status).toBe(201);
        expect(await contar(`SELECT COUNT(*) n FROM produtos WHERE empresa_id = $1 AND sku = 'CR-001' AND estoque_atual = 0`, [A.id])).toBe(1);
    });

    test('duplicados do banco e do arquivo viram aviso e são ignorados, sem atualizar', async () => {
        const p = await previa(A, 'produtos', 'nome;custo;sku\nanel  PRATA;99,00;ZZ-9\nNovo Item;1,00;AN-001\nItem Dobrado;2,00;DB-1\nitem dobrado;3,00;DB-2\n');
        expect(p.body.data.totais).toMatchObject({ a_criar: 1, ignoradas: 3, com_erro: 0 });
        expect((await confirmar(A, { token: p.body.data.token })).body.data).toMatchObject({ criados: 1, ignorados: 3 });
        expect(Number((await db.query(`SELECT custo FROM produtos WHERE empresa_id = $1 AND sku = 'AN-001'`, [A.id])).rows[0].custo)).toBe(12.5);
    });
});

describe('atomicidade, expiração e erros', () => {
    test('falha no meio da gravação desfaz tudo e o token continua válido', async () => {
        const local = await um(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'consignado', 'Consig Atomico') RETURNING id`, [B.id]);
        const csv = 'nome;custo;saldo;sku;local\nAtom 1;1,00;4;AT-1;Consig Atomico\nAtom 2;2,00;;AT-2;\n';
        const p = await previa(B, 'produtos', csv);
        expect(p.body.data.totais).toMatchObject({ a_criar: 2, com_erro: 0 });

        await db.query('UPDATE locais_estoque SET ativo = false WHERE id = $1', [local]); // some depois da prévia

        const c = await confirmar(B, { token: p.body.data.token });
        expect(c.status).toBe(409);
        expect(await contar('SELECT COUNT(*) n FROM produtos WHERE empresa_id = $1', [B.id])).toBe(0);
        expect(await contar('SELECT COUNT(*) n FROM movimentacoes_estoque WHERE empresa_id = $1', [B.id])).toBe(0);
        expect(await contar('SELECT COUNT(*) n FROM estoque_locais WHERE empresa_id = $1', [B.id])).toBe(0);
        expect((await db.query('SELECT estoque_inicial_lancado_em t FROM empresas WHERE id = $1', [B.id])).rows[0].t).toBeNull();
        expect((await db.query('SELECT status FROM importacoes WHERE id = $1', [p.body.data.importacao_id])).rows[0].status).toBe('previa');
        expect(await contar('SELECT COUNT(*) n FROM importacoes_previas WHERE empresa_id = $1', [B.id])).toBe(1);

        await db.query('UPDATE locais_estoque SET ativo = true WHERE id = $1', [local]);
        expect((await confirmar(B, { token: p.body.data.token })).status).toBe(201);
        expect(await contar('SELECT COUNT(*) n FROM produtos WHERE empresa_id = $1', [B.id])).toBe(2);
    });

    test('token expirado: 410 e nada gravado', async () => {
        const p = await previa(B, 'produtos', 'nome;custo;sku\nExpira;1,00;EX-1\n');
        await db.query(`UPDATE importacoes_previas SET expira_em = NOW() - INTERVAL '1 minute' WHERE importacao_id = $1`, [p.body.data.importacao_id]);
        expect((await confirmar(B, { token: p.body.data.token })).status).toBe(410);
        expect(await contar(`SELECT COUNT(*) n FROM produtos WHERE empresa_id = $1 AND sku = 'EX-1'`, [B.id])).toBe(0);
    });

    test('prévia com erro bloqueia a confirmação; somente_validas grava só as válidas', async () => {
        const p = await previa(B, 'produtos', 'nome;custo;sku\nValido;1,00;VA-1\nCusto Ruim;abc;VA-2\n');
        expect(p.body.data).toMatchObject({ pode_confirmar: false, pode_confirmar_somente_validas: true });
        expect((await confirmar(B, { token: p.body.data.token })).status).toBe(409);
        const c = await confirmar(B, { token: p.body.data.token, somente_validas: true });
        expect(c.body.data).toMatchObject({ criados: 1, nao_importados: 1 });
        expect(await contar(`SELECT COUNT(*) n FROM produtos WHERE empresa_id = $1 AND sku = 'VA-2'`, [B.id])).toBe(0);
    });

    test('duas confirmações simultâneas do mesmo token: uma grava, a outra não', async () => {
        const p = await previa(B, 'produtos', 'nome;custo;sku\nConcorrente;1,00;CC-1\n');
        const [r1, r2] = await Promise.all([confirmar(B, { token: p.body.data.token }), confirmar(B, { token: p.body.data.token })]);
        expect([r1.status, r2.status].filter((s) => s === 201)).toHaveLength(1);
        expect(await contar(`SELECT COUNT(*) n FROM produtos WHERE empresa_id = $1 AND sku = 'CC-1'`, [B.id])).toBe(1);
    });
});

describe('isolamento entre empresas', () => {
    test('empresa B não usa o token nem lê o relatório da A', async () => {
        const p = await previa(A, 'produtos', 'nome;custo;sku\nSo da A;1,00;SA-1\n');
        expect((await confirmar(B, { token: p.body.data.token })).status).toBe(404);
        expect(await contar(`SELECT COUNT(*) n FROM produtos WHERE sku = 'SA-1'`, [])).toBe(0);
        expect((await relatorio(B, A.importacaoId)).status).toBe(404);
        expect((await relatorio(A, A.importacaoId)).status).toBe(200);
        expect((await confirmar(A, { token: p.body.data.token })).status).toBe(201);
    });

    test('mesmo SKU, nome e telefone em empresas diferentes não conflitam', async () => {
        const p = await previa(B, 'produtos', 'nome;custo;sku\nAnel Prata;12,50;AN-001\n');
        expect(p.body.data.totais).toMatchObject({ a_criar: 1, ignoradas: 0 });
        expect((await confirmar(B, { token: p.body.data.token })).status).toBe(201);

        const cli = 'nome;telefone\nMaria;(11) 91234-5678\n';
        for (const E of [A, B]) {
            const pc = await previa(E, 'clientes', cli);
            expect(pc.body.data.totais).toMatchObject({ a_criar: 1, ignoradas: 0 });
            expect((await confirmar(E, { token: pc.body.data.token })).status).toBe(201);
        }
    });
});

describe('clientes e relatório', () => {
    test('telefone repetido é ignorado; cliente vinculado à importação; relatório sem dado pessoal e sem fórmula', async () => {
        const csv = 'nome;telefone;observacoes\n=Fulano;(21) 98888-7777;ok\nOutro;21988887777;dup\nCiclana;(21) 97777-6666;-x\n';
        const p = await previa(A, 'clientes', csv);
        expect(p.body.data.totais).toMatchObject({ a_criar: 2, ignoradas: 1 });
        const c = await confirmar(A, { token: p.body.data.token });
        expect(c.body.data).toMatchObject({ criados: 2, ignorados: 1, com_estoque_inicial: 0 });
        expect(await contar('SELECT COUNT(*) n FROM clientes WHERE importacao_id = $1 AND empresa_id = $2', [c.body.data.importacao_id, A.id])).toBe(2);

        const rel = await relatorio(A, c.body.data.importacao_id);
        expect(rel.status).toBe(200);
        expect(rel.headers['content-type']).toMatch(/text\/csv/);
        expect(rel.text).not.toMatch(/Fulano|Ciclana|98888|97777/);
        expect(rel.text).toMatch(/criado/);
    });

    test('relatório de produtos: antes da confirmação 409; fórmula no texto sai com apóstrofo', async () => {
        const p = await previa(A, 'produtos', "nome;custo;sku\n=SOMA(1);1,00;FM-1\n");
        expect((await relatorio(A, p.body.data.importacao_id)).status).toBe(409);
        const c = await confirmar(A, { token: p.body.data.token });
        const rel = await relatorio(A, c.body.data.importacao_id);
        expect(rel.text).toContain("'=SOMA(1)");
    });
});

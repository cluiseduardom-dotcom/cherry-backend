// Integração de verdade (Postgres de testes): fiado (dívidas de clientes sem produto, pagamentos parciais/totais, estorno, saldo,
// cobrança por WhatsApp). Prova: (1) desligado por padrão (403); (2) papéis: vendedor lança, só admin estorna, estoquista nunca;
// (3) saldo certo, nunca negativo, pagamento maior que o saldo recusado; (4) idempotência; (5) estorno preserva o histórico e
// respeita o saldo; (6) concorrência: dois pagamentos simultâneos não estouram o saldo; (7) o saldo guardado bate com a soma do
// livro-razão; (8) o banco recusa editar/apagar lançamento; (9) isolamento entre empresas e escopo de clientes do vendedor;
// (10) o crediário do PDV aparece só para leitura. Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'Fiado A' };
const B = { nome: 'Fiado B' };
const SEM = { nome: 'Fiado Sem Modulo' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const chave = () => crypto.randomUUID();
const com = (E, papel) => ({ admin: E.tokenAdmin, vendedor: E.tokenVendedor, estoquista: E.tokenEstoquista })[papel];
const api = (E, papel = 'admin') => ({
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${com(E, papel)}`),
    post: (url, corpo, k = chave()) => {
        const r = request(app).post(url).set('Authorization', `Bearer ${com(E, papel)}`);

        return (k === null ? r : r.set('Idempotency-Key', k)).send(corpo);
    }
});

async function criarEmpresa(E, { modulo = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, `fiado-${E.nome.toLowerCase().replace(/\W+/g, '-')}-${sufixo}`]));
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.id}-${sufixo}@teste.local`]);
    E.vendedor = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Vend', $2, 'x', 'vendedor') RETURNING id`, [E.id, `ven-${E.id}-${sufixo}@teste.local`]);
    E.estoquista = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Estq', $2, 'x', 'estoquista') RETURNING id`, [E.id, `est-${E.id}-${sufixo}@teste.local`]);
    E.tokenAdmin = makeToken({ id: E.admin, role: 'admin', empresa_id: E.id, tv: 0 });
    E.tokenVendedor = makeToken({ id: E.vendedor, role: 'vendedor', empresa_id: E.id, tv: 0 });
    E.tokenEstoquista = makeToken({ id: E.estoquista, role: 'estoquista', empresa_id: E.id, tv: 0 });
    E.canal = await um(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'balcao') RETURNING id`, [E.id]);

    if (modulo) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'fiado', true, 'teste', 'teste')`, [E.id]);
    }
}

// Cliente da empresa; `dono` = usuário que o cadastrou (escopo do vendedor).
const criarCliente = (E, nome, { dono = E.admin, telefone = '(11) 91234-5678', ativo = true } = {}) =>
    um(`INSERT INTO clientes (empresa_id, nome, telefone, criado_por, ativo) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [E.id, nome, telefone, dono, ativo]);

const saldoGuardado = async (E, cliente) => Number((await db.query('SELECT saldo FROM fiado_saldos WHERE empresa_id = $1 AND cliente_id = $2', [E.id, cliente])).rows[0]?.saldo ?? 0);
const saldoDoLivro = async (E, cliente) => Number((await db.query(
    `SELECT COALESCE(SUM(CASE WHEN l.tipo = 'compra' THEN l.valor WHEN l.tipo = 'pagamento' THEN -l.valor
                              WHEN l.tipo = 'estorno' AND o.tipo = 'compra' THEN -l.valor WHEN l.tipo = 'estorno' AND o.tipo = 'pagamento' THEN l.valor END), 0) AS saldo
       FROM fiado_lancamentos l LEFT JOIN fiado_lancamentos o ON o.id = l.estorna_id WHERE l.empresa_id = $1 AND l.cliente_id = $2`, [E.id, cliente])).rows[0].saldo);

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await criarEmpresa(SEM, { modulo: false });
    A.joao = await criarCliente(A, 'João da Silva', { dono: A.vendedor });
    A.maria = await criarCliente(A, 'Maria Souza', { dono: A.admin });
    B.pedro = await criarCliente(B, 'Pedro B', { dono: B.admin });
    SEM.ana = await criarCliente(SEM, 'Ana', { dono: SEM.admin });
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('desligado por padrão e papéis', () => {
    test('empresa sem o módulo: 403 em tudo', async () => {
        expect((await api(SEM).get('/fiado/resumo')).status).toBe(403);
        expect((await api(SEM).post(`/fiado/clientes/${SEM.ana}/compras`, { valor: 10, descricao: 'x' })).status).toBe(403);
    });

    test('estoquista nunca acessa; sem token 401', async () => {
        expect((await api(A, 'estoquista').get('/fiado/resumo')).status).toBe(403);
        expect((await api(A, 'estoquista').post(`/fiado/clientes/${A.joao}/compras`, { valor: 10, descricao: 'x' })).status).toBe(403);
        expect((await request(app).get('/fiado/resumo')).status).toBe(401);
    });
});

describe('compra e pagamento: saldo', () => {
    test('compra soma, pagamento parcial e total subtraem; histórico fica no extrato', async () => {
        const c = await api(A, 'vendedor').post(`/fiado/clientes/${A.joao}/compras`, { valor: 100, descricao: 'Compras do mês' });

        expect(c.status).toBe(201);
        expect(c.body.data).toMatchObject({ saldo: 100, lancamento: { tipo: 'compra', valor: 100, descricao: 'Compras do mês', estornado: false } });

        const p1 = await api(A, 'vendedor').post(`/fiado/clientes/${A.joao}/pagamentos`, { valor: 30.5, forma: 'pix' });

        expect(p1.body.data.saldo).toBe(69.5);

        const p2 = await api(A, 'vendedor').post(`/fiado/clientes/${A.joao}/pagamentos`, { valor: 69.5 });

        expect(p2.body.data.saldo).toBe(0);
        expect(await saldoGuardado(A, A.joao)).toBe(0);

        const ex = await api(A, 'vendedor').get(`/fiado/clientes/${A.joao}/extrato`);

        expect(ex.status).toBe(200);
        expect(ex.body.data.saldo).toBe(0);
        expect(ex.body.data.lancamentos.map((l) => l.tipo)).toEqual(['pagamento', 'pagamento', 'compra']);
        expect(ex.body.data.lancamentos[2].data_lancamento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('pagamento maior que o saldo é recusado e nada é gravado', async () => {
        await api(A).post(`/fiado/clientes/${A.maria}/compras`, { valor: 50, descricao: 'Fiado' });

        const r = await api(A).post(`/fiado/clientes/${A.maria}/pagamentos`, { valor: 50.01 });

        expect(r.status).toBe(422);
        expect(r.body.message).toMatch(/maior que o saldo/);
        expect(await saldoGuardado(A, A.maria)).toBe(50);
    });

    test('validação: valor zero/negativo/3 casas/texto, campo extra, data futura e inválida, descrição vazia', async () => {
        const c = A.maria;

        for (const valor of [0, -5, 10.001, '10', null]) expect((await api(A).post(`/fiado/clientes/${c}/compras`, { valor, descricao: 'x' })).status).toBe(400);

        expect((await api(A).post(`/fiado/clientes/${c}/compras`, { valor: 10, descricao: '   ' })).status).toBe(400);
        expect((await api(A).post(`/fiado/clientes/${c}/compras`, { valor: 10, descricao: 'x', empresa_id: 9 })).status).toBe(400);
        expect((await api(A).post(`/fiado/clientes/${c}/compras`, { valor: 10, descricao: 'x', data: '2999-01-01' })).status).toBe(400);
        expect((await api(A).post(`/fiado/clientes/${c}/compras`, { valor: 10, descricao: 'x', data: '2026-02-30' })).status).toBe(400);
        expect((await api(A).post(`/fiado/clientes/${c}/compras`, { valor: 1000000, descricao: 'x' })).status).toBe(400);
        expect((await api(A).post(`/fiado/clientes/${c}/pagamentos`, { valor: 10, forma: 'cheque' })).status).toBe(400);
    });

    test('a data informada (passada) é gravada exatamente como YYYY-MM-DD', async () => {
        const r = await api(A).post(`/fiado/clientes/${A.maria}/compras`, { valor: 5, descricao: 'Antiga', data: '2026-01-31' });

        expect(r.status).toBe(201);
        expect(r.body.data.lancamento.data_lancamento).toBe('2026-01-31');
    });

    test('cliente inativo não recebe lançamento; cliente inexistente 404', async () => {
        const inativo = await criarCliente(A, 'Inativo', { ativo: false });

        expect((await api(A).post(`/fiado/clientes/${inativo}/compras`, { valor: 10, descricao: 'x' })).status).toBe(409);
        expect((await api(A).post('/fiado/clientes/999999999/compras', { valor: 10, descricao: 'x' })).status).toBe(404);
        expect((await api(A).post('/fiado/clientes/abc/compras', { valor: 10, descricao: 'x' })).status).toBe(400);
    });
});

describe('idempotência', () => {
    test('Idempotency-Key é obrigatório e válido', async () => {
        expect((await api(A).post(`/fiado/clientes/${A.maria}/compras`, { valor: 10, descricao: 'x' }, null)).status).toBe(400);
        expect((await api(A).post(`/fiado/clientes/${A.maria}/compras`, { valor: 10, descricao: 'x' }, 'curta')).status).toBe(400);
    });

    test('mesma chave e mesmo conteúdo: devolve o original sem lançar de novo; outro conteúdo: 409', async () => {
        const antes = await saldoGuardado(A, A.maria);
        const k = chave();
        const a = await api(A).post(`/fiado/clientes/${A.maria}/compras`, { valor: 7, descricao: 'Retry' }, k);
        const b = await api(A).post(`/fiado/clientes/${A.maria}/compras`, { valor: 7, descricao: 'Retry' }, k);

        expect(a.status).toBe(201);
        expect(b.status).toBe(200);
        expect(b.headers['idempotent-replayed']).toBe('true');
        expect(b.body.data.lancamento.id).toBe(a.body.data.lancamento.id);
        expect(await saldoGuardado(A, A.maria)).toBe(antes + 7);
        expect((await api(A).post(`/fiado/clientes/${A.maria}/compras`, { valor: 8, descricao: 'Retry' }, k)).status).toBe(409);
        expect((await api(A).post(`/fiado/clientes/${A.joao}/compras`, { valor: 7, descricao: 'Retry' }, k)).status).toBe(409);
    });
});

describe('estorno', () => {
    test('só admin estorna; o original permanece, marcado como estornado, e o saldo volta', async () => {
        const cliente = await criarCliente(A, 'Estorno 1', { dono: A.admin });
        const compra = (await api(A).post(`/fiado/clientes/${cliente}/compras`, { valor: 40, descricao: 'Errada' })).body.data.lancamento;

        expect((await api(A, 'vendedor').post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'engano' })).status).toBe(403);

        const e = await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'Lançado no cliente errado' });

        expect(e.status).toBe(201);
        expect(e.body.data).toMatchObject({ saldo: 0, lancamento: { tipo: 'estorno', valor: 40, estorna_id: compra.id, motivo: 'Lançado no cliente errado' } });

        const ex = await api(A).get(`/fiado/clientes/${cliente}/extrato`);

        expect(ex.body.data.lancamentos).toHaveLength(2);
        expect(ex.body.data.lancamentos.find((l) => l.id === compra.id).estornado).toBe(true);
        expect(await saldoDoLivro(A, cliente)).toBe(0);
    });

    test('estorno duplo 409; estorno de estorno 422; motivo obrigatório', async () => {
        const cliente = await criarCliente(A, 'Estorno 2', { dono: A.admin });
        const compra = (await api(A).post(`/fiado/clientes/${cliente}/compras`, { valor: 20, descricao: 'x' })).body.data.lancamento;
        const e = (await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'erro' })).body.data.lancamento;

        expect((await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'de novo' })).status).toBe(409);
        expect((await api(A).post(`/fiado/lancamentos/${e.id}/estorno`, { motivo: 'estornar estorno' })).status).toBe(422);
        expect((await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: ' ' })).status).toBe(400);
    });

    test('estornar a compra que já foi paga deixaria saldo negativo: recusado; estornando o pagamento antes, funciona', async () => {
        const cliente = await criarCliente(A, 'Estorno 3', { dono: A.admin });
        const compra = (await api(A).post(`/fiado/clientes/${cliente}/compras`, { valor: 100, descricao: 'x' })).body.data.lancamento;
        const pag = (await api(A).post(`/fiado/clientes/${cliente}/pagamentos`, { valor: 100 })).body.data.lancamento;

        const recusado = await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'cancelar compra' });

        expect(recusado.status).toBe(422);
        expect(recusado.body.message).toMatch(/negativo/);
        expect(await saldoGuardado(A, cliente)).toBe(0);

        expect((await api(A).post(`/fiado/lancamentos/${pag.id}/estorno`, { motivo: 'pagamento não caiu' })).body.data.saldo).toBe(100);
        expect((await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'cancelar compra' })).body.data.saldo).toBe(0);
        expect(await saldoDoLivro(A, cliente)).toBe(0);
    });

    test('estorno repetido com a mesma chave devolve o mesmo estorno', async () => {
        const cliente = await criarCliente(A, 'Estorno 4', { dono: A.admin });
        const compra = (await api(A).post(`/fiado/clientes/${cliente}/compras`, { valor: 9, descricao: 'x' })).body.data.lancamento;
        const k = chave();
        const a = await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'erro' }, k);
        const b = await api(A).post(`/fiado/lancamentos/${compra.id}/estorno`, { motivo: 'erro' }, k);

        expect(a.status).toBe(201);
        expect(b.status).toBe(200);
        expect(b.body.data.lancamento.id).toBe(a.body.data.lancamento.id);
    });
});

describe('concorrência e integridade', () => {
    test('dois pagamentos simultâneos de 60 contra saldo 100: um passa, o outro é recusado, saldo 40', async () => {
        const cliente = await criarCliente(A, 'Concorrente', { dono: A.admin });
        await api(A).post(`/fiado/clientes/${cliente}/compras`, { valor: 100, descricao: 'x' });

        const respostas = await Promise.all([
            api(A).post(`/fiado/clientes/${cliente}/pagamentos`, { valor: 60 }),
            api(A).post(`/fiado/clientes/${cliente}/pagamentos`, { valor: 60 })
        ]);

        expect(respostas.map((r) => r.status).sort()).toEqual([201, 422]);
        expect(await saldoGuardado(A, cliente)).toBe(40);
        expect(await saldoDoLivro(A, cliente)).toBe(40);
    });

    test('várias compras simultâneas: o saldo guardado é a soma exata', async () => {
        const cliente = await criarCliente(A, 'Soma', { dono: A.admin });
        const respostas = await Promise.all(Array.from({ length: 8 }, (_, i) => api(A).post(`/fiado/clientes/${cliente}/compras`, { valor: 12.34 + i, descricao: `c${i}` })));

        expect(respostas.every((r) => r.status === 201)).toBe(true);
        expect(await saldoGuardado(A, cliente)).toBe(await saldoDoLivro(A, cliente));
        expect(await saldoGuardado(A, cliente)).toBe(Number((8 * 12.34 + 28).toFixed(2)));
    });

    test('o banco recusa editar e apagar lançamento, e saldo negativo', async () => {
        const id = (await db.query('SELECT id FROM fiado_lancamentos WHERE empresa_id = $1 LIMIT 1', [A.id])).rows[0].id;

        await expect(db.query('UPDATE fiado_lancamentos SET valor = 1 WHERE id = $1', [id])).rejects.toThrow(/imutável/);
        await expect(db.query('DELETE FROM fiado_lancamentos WHERE id = $1', [id])).rejects.toThrow(/imutável/);
        await expect(db.query('UPDATE fiado_saldos SET saldo = -1 WHERE empresa_id = $1', [A.id])).rejects.toThrow(/fiado_saldos_nao_negativo_chk/);
    });

    test('o saldo guardado bate com o livro-razão em todos os clientes da empresa', async () => {
        const { rows } = await db.query('SELECT cliente_id FROM fiado_saldos WHERE empresa_id = $1', [A.id]);

        for (const r of rows) expect(await saldoGuardado(A, r.cliente_id)).toBe(await saldoDoLivro(A, r.cliente_id));
    });
});

describe('isolamento e escopo', () => {
    test('empresa B não vê nem lança nem estorna nos clientes e lançamentos da A', async () => {
        const lanc = (await db.query('SELECT id FROM fiado_lancamentos WHERE empresa_id = $1 LIMIT 1', [A.id])).rows[0].id;

        expect((await api(B).get(`/fiado/clientes/${A.maria}/extrato`)).status).toBe(404);
        expect((await api(B).post(`/fiado/clientes/${A.maria}/compras`, { valor: 1, descricao: 'x' })).status).toBe(404);
        expect((await api(B).post(`/fiado/lancamentos/${lanc}/estorno`, { motivo: 'invasão' })).status).toBe(404);
        expect((await api(B).get(`/fiado/clientes/${A.maria}/cobranca`)).status).toBe(404);

        const lista = await api(B).get('/fiado/clientes');

        expect(lista.body.data.itens.map((c) => c.nome)).toEqual(['Pedro B']);
    });

    test('vendedor só vê os clientes que cadastrou; admin vê todos', async () => {
        const doVendedor = (await api(A, 'vendedor').get('/fiado/clientes')).body.data.itens.map((c) => c.nome);
        const doAdmin = (await api(A, 'admin').get('/fiado/clientes')).body.data.itens.map((c) => c.nome);

        expect(doVendedor).toEqual(['João da Silva']);
        expect(doAdmin).toEqual(expect.arrayContaining(['João da Silva', 'Maria Souza']));
        expect((await api(A, 'vendedor').get(`/fiado/clientes/${A.maria}/extrato`)).status).toBe(404);
        expect((await api(A, 'vendedor').post(`/fiado/clientes/${A.maria}/compras`, { valor: 1, descricao: 'x' })).status).toBe(404);
    });

    test('lista: busca por nome e telefone, só devedores, ordenada por saldo, com paginação', async () => {
        const porNome = await api(A).get('/fiado/clientes?busca=souza');

        expect(porNome.body.data.itens.map((c) => c.nome)).toEqual(['Maria Souza']);
        expect((await api(A).get('/fiado/clientes?busca=91234')).body.data.total).toBeGreaterThan(1);
        expect((await api(A).get('/fiado/clientes?busca=%25')).body.data.total).toBe(0);

        const devedores = (await api(A).get('/fiado/clientes?com_saldo=true')).body.data.itens;

        expect(devedores.length).toBeGreaterThan(0);
        expect(devedores.every((c) => c.saldo > 0)).toBe(true);
        expect(devedores.map((c) => c.saldo)).toEqual([...devedores.map((c) => c.saldo)].sort((a, b) => b - a));

        const pag = await api(A).get('/fiado/clientes?page=1&pageSize=2');

        expect(pag.body.data.itens).toHaveLength(2);
        expect(pag.body.data.pageSize).toBe(2);
    });
});

describe('crediário do PDV (somente leitura)', () => {
    test('parcelas pendentes do cliente aparecem no extrato e no resumo, separadas do fiado', async () => {
        const cliente = await criarCliente(A, 'Crediario', { dono: A.admin });
        const venda = await um(
            `INSERT INTO vendas (cliente_id, canal_id, usuario_id, subtotal, desconto, juros, total, status, data, empresa_id, forma_pagamento)
             VALUES ($1, $2, $3, 90, 0, 0, 90, 'finalizada', NOW(), $4, 'prazo') RETURNING id`, [cliente, A.canal, A.admin, A.id]);

        await db.query(`INSERT INTO contas_receber (venda_id, descricao, valor, data_vencimento, empresa_id) VALUES ($1, 'Venda - Parcela 1/2', 45, '2027-01-10', $2), ($1, 'Venda - Parcela 2/2', 45, '2027-02-10', $2)`, [venda, A.id]);

        const ex = (await api(A).get(`/fiado/clientes/${cliente}/extrato`)).body.data;

        expect(ex.saldo).toBe(0);
        expect(ex.crediario.total).toBe(90);
        expect(ex.crediario.parcelas.map((p) => p.data_vencimento)).toEqual(['2027-01-10', '2027-02-10']);
        expect((await api(A).get('/fiado/resumo')).body.data.crediario_a_receber).toBeGreaterThanOrEqual(90);
    });
});

describe('resumo', () => {
    test('total a receber = soma dos saldos; período já desconta estornos; últimas movimentações com nome', async () => {
        const R = { nome: 'Fiado Resumo' };
        await criarEmpresa(R);
        const c = await criarCliente(R, 'Resumo Cliente', { dono: R.admin });

        await api(R).post(`/fiado/clientes/${c}/compras`, { valor: 100, descricao: 'a' });
        const errada = (await api(R).post(`/fiado/clientes/${c}/compras`, { valor: 30, descricao: 'b' })).body.data.lancamento;
        await api(R).post(`/fiado/clientes/${c}/pagamentos`, { valor: 20 });
        await api(R).post(`/fiado/lancamentos/${errada.id}/estorno`, { motivo: 'engano' });

        const r = (await api(R).get('/fiado/resumo')).body.data;

        expect(r.total_a_receber).toBe(80);
        expect(r.clientes_devedores).toBe(1);
        expect(r.periodo.compras).toBe(100);
        expect(r.periodo.pagamentos).toBe(20);
        expect(r.ultimas_movimentacoes[0]).toMatchObject({ tipo: 'estorno', cliente_nome: 'Resumo Cliente' });
        expect((await api(R).get('/fiado/resumo?de=2030-01-01&ate=2030-01-31')).body.data.periodo).toMatchObject({ compras: 0, pagamentos: 0 });
        expect((await api(R).get('/fiado/resumo?de=2030-02-01&ate=2030-01-31')).status).toBe(400);
    });
});

describe('cobrança por WhatsApp', () => {
    test('mensagem com o saldo e link wa.me; recusa sem saldo e sem telefone válido', async () => {
        const cliente = await criarCliente(A, 'Cobrar Silva', { dono: A.admin, telefone: '(11) 98765-4321' });
        await api(A).post(`/fiado/clientes/${cliente}/compras`, { valor: 1234.5, descricao: 'x' });

        const r = await api(A).get(`/fiado/clientes/${cliente}/cobranca`);

        expect(r.status).toBe(200);
        expect(r.body.data.saldo).toBe(1234.5);
        expect(r.body.data.mensagem).toBe('Olá, Cobrar! Consta em nosso controle um saldo pendente de R$ 1.234,50. Caso já tenha realizado o pagamento, por favor, desconsidere esta mensagem. Obrigado!');
        expect(r.body.data.link_whatsapp).toBe(`https://wa.me/5511987654321?text=${encodeURIComponent(r.body.data.mensagem)}`);

        const semSaldo = await criarCliente(A, 'Sem Saldo', { dono: A.admin });
        const semFone = await criarCliente(A, 'Sem Fone', { dono: A.admin, telefone: null });

        await api(A).post(`/fiado/clientes/${semFone}/compras`, { valor: 5, descricao: 'x' });

        expect((await api(A).get(`/fiado/clientes/${semSaldo}/cobranca`)).status).toBe(422);
        expect((await api(A).get(`/fiado/clientes/${semFone}/cobranca`)).status).toBe(422);
    });
});

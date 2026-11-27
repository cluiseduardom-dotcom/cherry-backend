// Integração de verdade (Postgres de testes): rotas do caixa por PDV (Tarefa 03, PR B). Prova: (1) desligado por padrão e por cargo;
// (2) abrir (um caixa por operador, um operador por caixa, retry devolve a mesma sessão, corrida de aberturas); (3) suprimento/sangria
// com Idempotency-Key, sangria nunca maior que o dinheiro em caixa, corrida da mesma chave; (4) o operador só enxerga e mexe na própria
// sessão, quem gere vê todas; (5) fechamento: esperado calculado no servidor, diferença exige justificativa, fechada é imutável,
// corrida sangria x fechamento não deixa movimento fora da conferência; (6) isolamento entre empresas. Empresas "Teste ..." temporárias.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'Caixa A' };
const B = { nome: 'Caixa B' };
const SEM = { nome: 'Caixa Sem Modulo' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const chave = () => crypto.randomUUID();
const api = (E, quem = 'admin') => ({
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${E.token[quem]}`),
    post: (url, corpo, k) => {
        const r = request(app).post(url).set('Authorization', `Bearer ${E.token[quem]}`);

        return (k ? r.set('Idempotency-Key', k) : r).send(corpo);
    },
    patch: (url, corpo) => request(app).patch(url).set('Authorization', `Bearer ${E.token[quem]}`).send(corpo)
});

async function criarEmpresa(E, { modulo = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, `caixa-${E.nome.toLowerCase().replace(/\W+/g, '-')}-${sufixo}`]));
    E.token = {};
    E.uid = {};

    for (const papel of ['admin', 'gerente', 'vendedor', 'operador', 'auxiliar', 'estoquista']) {
        E.uid[papel] = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, papel, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.token[papel] = makeToken({ id: E.uid[papel], role: papel, empresa_id: E.id, tv: 0 });
    }

    if (modulo) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'caixa', true, 'teste', 'teste')`, [E.id]);
    }
}

const novoCaixa = async (E, nome) => (await api(E, 'gerente').post('/caixa/caixas', { nome })).body.data.caixa.id;
const abrir = (E, quem, caixa_id, saldo_inicial = 100) => api(E, quem).post('/caixa/sessoes', { caixa_id, saldo_inicial });
const linhas = async (sql, params) => (await db.query(sql, params)).rows;

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await criarEmpresa(SEM, { modulo: false });
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('desligado por padrão e por cargo', () => {
    test('empresa sem a funcionalidade: 403 em tudo, até para admin', async () => {
        expect((await api(SEM).get('/caixa/caixas')).status).toBe(403);
        expect((await api(SEM).post('/caixa/caixas', { nome: 'X' })).status).toBe(403);
        expect((await api(SEM).get('/caixa/sessao-atual')).status).toBe(403);
    });

    test('estoquista e auxiliar (sem a capacidade) 403; sem token 401', async () => {
        expect((await api(A, 'estoquista').get('/caixa/caixas')).status).toBe(403);
        expect((await api(A, 'auxiliar').get('/caixa/caixas')).status).toBe(403);
        expect((await request(app).get('/caixa/caixas')).status).toBe(401);
    });

    test('só quem gere cadastra e desativa caixas; o operador lista só os ativos', async () => {
        expect((await api(A, 'vendedor').post('/caixa/caixas', { nome: 'Nao' })).status).toBe(403);

        const criado = await api(A, 'gerente').post('/caixa/caixas', { nome: 'Balcão Cadastro' });

        expect(criado.status).toBe(201);
        expect((await api(A, 'gerente').post('/caixa/caixas', { nome: '  balcão cadastro ' })).status).toBe(409);
        expect((await api(A, 'gerente').post('/caixa/caixas', { nome: '' })).status).toBe(400);
        expect((await api(A, 'gerente').post('/caixa/caixas', { nome: 'X', empresa_id: B.id })).status).toBe(400);
        expect((await api(A, 'vendedor').patch(`/caixa/caixas/${criado.body.data.caixa.id}`, { ativo: false })).status).toBe(403);
        expect((await api(A, 'gerente').patch(`/caixa/caixas/${criado.body.data.caixa.id}`, { ativo: false })).status).toBe(200);

        const doOperador = (await api(A, 'vendedor').get('/caixa/caixas')).body.data.caixas.map((c) => c.nome);
        const doGerente = (await api(A, 'gerente').get('/caixa/caixas')).body.data.caixas.map((c) => c.nome);

        expect(doOperador).not.toContain('Balcão Cadastro');
        expect(doGerente).toContain('Balcão Cadastro');
    });
});

describe('abertura', () => {
    test('abre com saldo inicial; retry idêntico devolve a mesma sessão; outro operador no mesmo caixa e o mesmo operador em outro caixa são recusados', async () => {
        const c1 = await novoCaixa(A, 'Balcão 1');
        const c2 = await novoCaixa(A, 'Balcão 2');
        const r = await abrir(A, 'vendedor', c1, 150);

        expect(r.status).toBe(201);
        expect(r.body.data.sessao).toMatchObject({ caixa_id: c1, operador_id: A.uid.vendedor, status: 'aberta', saldo_inicial: 150, caixa_nome: 'Balcão 1' });

        const retry = await abrir(A, 'vendedor', c1, 150);

        expect(retry.status).toBe(200);
        expect(retry.headers['idempotent-replayed']).toBe('true');
        expect(retry.body.data.sessao.id).toBe(r.body.data.sessao.id);
        expect((await abrir(A, 'vendedor', c1, 999)).status).toBe(409);
        expect((await abrir(A, 'operador', c1, 10)).status).toBe(409);
        expect((await abrir(A, 'vendedor', c2, 10)).status).toBe(409);

        const atual = await api(A, 'vendedor').get('/caixa/sessao-atual');

        expect(atual.body.data.atual.sessao.id).toBe(r.body.data.sessao.id);
        expect(atual.body.data.atual.esperado).toEqual({ dinheiro: 150 });
        expect((await api(A, 'operador').get('/caixa/sessao-atual')).body.data.atual).toBeNull();
        expect(await linhas(`SELECT 1 FROM caixa_sessoes WHERE empresa_id = $1 AND caixa_id = $2`, [A.id, c1])).toHaveLength(1);

        A.caixaVendedor = c1;
        A.sessaoVendedor = r.body.data.sessao.id;
        A.caixa2 = c2;
    });

    test('validações: saldo negativo, caixa inexistente, caixa de outra empresa, caixa desativado', async () => {
        expect((await abrir(A, 'operador', A.caixa2, -1)).status).toBe(400);
        expect((await abrir(A, 'operador', 999999999, 0)).status).toBe(404);

        const caixaDeB = await novoCaixa(B, 'Balcão B');

        expect((await abrir(A, 'operador', caixaDeB, 0)).status).toBe(404);
        expect(await linhas(`SELECT 1 FROM caixa_sessoes WHERE caixa_id = $1`, [caixaDeB])).toHaveLength(0);

        const inativo = await novoCaixa(A, 'Balcão Inativo');

        await api(A, 'gerente').patch(`/caixa/caixas/${inativo}`, { ativo: false });
        expect((await abrir(A, 'operador', inativo, 0)).status).toBe(409);
    });

    test('corrida: dois operadores abrindo o mesmo caixa ao mesmo tempo, só um vence', async () => {
        const c = await novoCaixa(A, 'Balcão Corrida');
        const r = await Promise.all([abrir(A, 'operador', c, 0), abrir(A, 'gerente', c, 0)]);

        expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
        expect(await linhas(`SELECT 1 FROM caixa_sessoes WHERE caixa_id = $1 AND status = 'aberta'`, [c])).toHaveLength(1);

        const vencedor = r.find((x) => x.status === 201).body.data.sessao;

        await api(A, vencedor.operador_id === A.uid.operador ? 'operador' : 'gerente').post(`/caixa/sessoes/${vencedor.id}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 0 }] });
    });

    test('não desativa caixa com sessão aberta', async () => {
        expect((await api(A, 'gerente').patch(`/caixa/caixas/${A.caixaVendedor}`, { ativo: false })).status).toBe(409);
    });
});

describe('suprimento e sangria', () => {
    const mov = (E, quem, sessao, corpo, k = chave()) => api(E, quem).post(`/caixa/sessoes/${sessao}/movimentos`, corpo, k);

    test('exige Idempotency-Key e corpo válido', async () => {
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 1, motivo: 'abc' }, null)).status).toBe(400);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'troca', valor: 1, motivo: 'abc' })).status).toBe(400);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 0, motivo: 'abc' })).status).toBe(400);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: -5, motivo: 'abc' })).status).toBe(400);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 1.234, motivo: 'abc' })).status).toBe(400);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 5, motivo: 'a' })).status).toBe(400);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 5, motivo: 'abc', usuario_id: 1 })).status).toBe(400);
    });

    test('suprimento soma, sangria subtrai; retry da mesma chave não duplica; mesma chave com outro conteúdo é 409', async () => {
        const k = chave();
        const sup = await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'suprimento', valor: 50, motivo: 'Troco extra' }, k);

        expect(sup.status).toBe(201);
        expect(sup.body.data.movimento).toMatchObject({ tipo: 'suprimento', valor: 50, usuario_id: A.uid.vendedor });

        const retry = await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'suprimento', valor: 50, motivo: 'Troco extra' }, k);

        expect(retry.status).toBe(200);
        expect(retry.headers['idempotent-replayed']).toBe('true');
        expect(retry.body.data.movimento.id).toBe(sup.body.data.movimento.id);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'suprimento', valor: 51, motivo: 'Troco extra' }, k)).status).toBe(409);

        const sang = await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 30.25, motivo: 'Levar ao cofre' });

        expect(sang.status).toBe(201);
        expect(await linhas(`SELECT 1 FROM caixa_movimentos WHERE sessao_id = $1`, [A.sessaoVendedor])).toHaveLength(2);

        const det = (await api(A, 'vendedor').get(`/caixa/sessoes/${A.sessaoVendedor}`)).body.data;

        expect(det.resumo).toEqual({ saldo_inicial: 150, suprimentos: 50, sangrias: 30.25 });
        expect(det.esperado).toEqual({ dinheiro: 169.75 });
        expect(det.movimentos).toHaveLength(2);
    });

    test('sangria maior que o dinheiro em caixa é recusada e nada é gravado', async () => {
        const antes = (await linhas(`SELECT 1 FROM caixa_movimentos WHERE sessao_id = $1`, [A.sessaoVendedor])).length;
        const r = await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 169.76, motivo: 'Demais' });

        expect(r.status).toBe(422);
        expect((await linhas(`SELECT 1 FROM caixa_movimentos WHERE sessao_id = $1`, [A.sessaoVendedor])).length).toBe(antes);
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: 169.75, motivo: 'Exato' })).status).toBe(201);
        // devolve o dinheiro para o restante dos testes
        expect((await mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'suprimento', valor: 169.75, motivo: 'Reposição' })).status).toBe(201);
    });

    test('corrida: a mesma chave em 5 requisições simultâneas grava UM movimento; sangrias simultâneas nunca estouram o caixa', async () => {
        const k = chave();
        const r = await Promise.all(Array.from({ length: 5 }, () => mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'suprimento', valor: 1, motivo: 'Mesma chave' }, k)));

        expect(r.every((x) => [200, 201].includes(x.status))).toBe(true);
        expect(new Set(r.map((x) => x.body.data.movimento.id)).size).toBe(1);
        expect(await linhas(`SELECT 1 FROM caixa_movimentos WHERE chave_idempotencia = $1`, [k])).toHaveLength(1);

        const det = (await api(A, 'vendedor').get(`/caixa/sessoes/${A.sessaoVendedor}`)).body.data;
        const disponivel = det.esperado.dinheiro;
        const sangrias = await Promise.all([1, 2, 3].map(() => mov(A, 'vendedor', A.sessaoVendedor, { tipo: 'sangria', valor: Math.floor(disponivel / 2) + 1, motivo: 'Corrida' })));

        expect(sangrias.filter((x) => x.status === 201)).toHaveLength(1);
        expect(sangrias.filter((x) => x.status === 422)).toHaveLength(2);
        expect((await api(A, 'vendedor').get(`/caixa/sessoes/${A.sessaoVendedor}`)).body.data.esperado.dinheiro).toBeGreaterThanOrEqual(0);
    });
});

describe('escopo: operador só na própria sessão', () => {
    test('outro operador não vê nem mexe (404); quem gere vê, movimenta e lista todas', async () => {
        expect((await api(A, 'operador').get(`/caixa/sessoes/${A.sessaoVendedor}`)).status).toBe(404);
        expect((await api(A, 'operador').post(`/caixa/sessoes/${A.sessaoVendedor}/movimentos`, { tipo: 'suprimento', valor: 1, motivo: 'abc' }, chave())).status).toBe(404);
        expect((await api(A, 'operador').post(`/caixa/sessoes/${A.sessaoVendedor}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 0 }] })).status).toBe(404);
        expect((await api(A, 'gerente').get(`/caixa/sessoes/${A.sessaoVendedor}`)).status).toBe(200);
        expect((await api(A, 'gerente').post(`/caixa/sessoes/${A.sessaoVendedor}/movimentos`, { tipo: 'suprimento', valor: 1, motivo: 'Gerente repôs' }, chave())).status).toBe(201);

        const doOperador = (await api(A, 'operador').get('/caixa/sessoes')).body.data;
        const doGerente = (await api(A, 'gerente').get('/caixa/sessoes?status=aberta')).body.data;

        expect(doOperador.itens.every((s) => s.operador_id === A.uid.operador)).toBe(true);
        expect(doGerente.itens.some((s) => s.id === A.sessaoVendedor)).toBe(true);
        expect((await api(A, 'gerente').get('/caixa/sessoes?pageSize=1000')).status).toBe(400);
    });
});

describe('fechamento', () => {
    let caixa;
    let sessao;

    beforeAll(async () => {
        caixa = await novoCaixa(A, 'Balcão Fechamento');
        sessao = (await abrir(A, 'operador', caixa, 200)).body.data.sessao.id;
        await api(A, 'operador').post(`/caixa/sessoes/${sessao}/movimentos`, { tipo: 'suprimento', valor: 50, motivo: 'Troco' }, chave());
        await api(A, 'operador').post(`/caixa/sessoes/${sessao}/movimentos`, { tipo: 'sangria', valor: 100, motivo: 'Cofre' }, chave());
    });

    test('esperado vem do servidor: o cliente só informa o contado; sem conferir o dinheiro, forma não conferível e duplicidade são 400', async () => {
        expect((await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [] })).status).toBe(400);
        expect((await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [{ forma: 'pix', informado: 10 }] })).status).toBe(400);
        expect((await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 1 }, { forma: 'dinheiro', informado: 1 }] })).status).toBe(400);
        expect((await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 150, esperado: 1 }] })).status).toBe(400);
        expect((await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: -1 }] })).status).toBe(400);
        expect((await linhas(`SELECT status FROM caixa_sessoes WHERE id = $1`, [sessao]))[0].status).toBe('aberta');
    });

    test('diferença sem justificativa é recusada (nada fechado, nada gravado); com justificativa fecha e avisa', async () => {
        const sem = await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 148.5 }] });

        expect(sem.status).toBe(400);
        expect((await linhas(`SELECT status FROM caixa_sessoes WHERE id = $1`, [sessao]))[0].status).toBe('aberta');
        expect(await linhas(`SELECT 1 FROM caixa_conferencias WHERE sessao_id = $1`, [sessao])).toHaveLength(0);

        const ok = await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 148.5 }], justificativa: 'Troco dado a menos' });

        expect(ok.status).toBe(200);
        expect(ok.body.data).toMatchObject({
            divergente: true, aviso: expect.stringContaining('diferença'),
            conferencias: [{ forma: 'dinheiro', esperado: 150, informado: 148.5, diferenca: -1.5 }],
            sessao: { status: 'fechada', fechada_por: A.uid.operador, justificativa_divergencia: 'Troco dado a menos' }
        });
        expect(Number((await linhas(`SELECT diferenca FROM caixa_conferencias WHERE sessao_id = $1`, [sessao]))[0].diferenca)).toBe(-1.5);
    });

    test('fechada é imutável: novo fechamento 409, movimento 409, conferência não muda; o operador abre outro caixa depois', async () => {
        expect((await api(A, 'operador').post(`/caixa/sessoes/${sessao}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 150 }] })).status).toBe(409);
        expect((await api(A, 'operador').post(`/caixa/sessoes/${sessao}/movimentos`, { tipo: 'suprimento', valor: 1, motivo: 'tarde' }, chave())).status).toBe(409);
        expect(await linhas(`SELECT 1 FROM caixa_movimentos WHERE sessao_id = $1`, [sessao])).toHaveLength(2);

        const det = (await api(A, 'operador').get(`/caixa/sessoes/${sessao}`)).body.data;

        expect(det.sessao.status).toBe('fechada');
        expect(det.conferencias).toEqual([{ forma: 'dinheiro', esperado: 150, informado: 148.5, diferenca: -1.5 }]);
        expect((await api(A, 'operador').get('/caixa/sessao-atual')).body.data.atual).toBeNull();
        expect((await abrir(A, 'operador', caixa, 0)).status).toBe(201);
    });

    test('sem diferença: fecha sem justificativa e sem aviso; quem gere também fecha a sessão de outro operador', async () => {
        const c = await novoCaixa(A, 'Balcão Exato');
        const s = (await abrir(A, 'auxiliar', c, 0).catch(() => null));

        expect(s.status).toBe(403);

        const sessaoExata = (await abrir(A, 'gerente', c, 80)).body.data.sessao.id;
        const fechou = await api(A, 'admin').post(`/caixa/sessoes/${sessaoExata}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 80 }], justificativa: 'não deveria ficar' });

        expect(fechou.status).toBe(200);
        expect(fechou.body.data).toMatchObject({ divergente: false, aviso: null, sessao: { fechada_por: A.uid.admin, justificativa_divergencia: null } });
    });

    test('corrida sangria x fechamento: nenhum movimento fica fora da conferência', async () => {
        const c = await novoCaixa(A, 'Balcão Corrida Fechamento');
        const s = (await abrir(A, 'gerente', c, 500)).body.data.sessao.id;
        const informado = 500;
        const [sang, fech] = await Promise.all([
            api(A, 'gerente').post(`/caixa/sessoes/${s}/movimentos`, { tipo: 'sangria', valor: 100, motivo: 'Corrida' }, chave()),
            api(A, 'gerente').post(`/caixa/sessoes/${s}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado }], justificativa: 'Corrida de teste' })
        ]);
        const conf = (await linhas(`SELECT esperado FROM caixa_conferencias WHERE sessao_id = $1`, [s]))[0];
        const movimentos = await linhas(`SELECT tipo, valor FROM caixa_movimentos WHERE sessao_id = $1`, [s]);
        const saldoDosMovimentos = 500 + movimentos.reduce((t, m) => t + (m.tipo === 'suprimento' ? Number(m.valor) : -Number(m.valor)), 0);

        expect([200, 400]).toContain(fech.status);
        expect([201, 409]).toContain(sang.status);
        expect(Number(conf?.esperado ?? saldoDosMovimentos)).toBe(saldoDosMovimentos);
        // Se a sangria entrou, entrou ANTES do fechamento; se foi recusada, não existe movimento algum.
        expect(movimentos).toHaveLength(sang.status === 201 ? 1 : 0);
    });
});

describe('isolamento entre empresas', () => {
    test('empresa B não vê, não movimenta e não fecha a sessão da empresa A; listas não vazam', async () => {
        expect((await api(B, 'gerente').get(`/caixa/sessoes/${A.sessaoVendedor}`)).status).toBe(404);
        expect((await api(B, 'admin').post(`/caixa/sessoes/${A.sessaoVendedor}/movimentos`, { tipo: 'suprimento', valor: 1, motivo: 'abc' }, chave())).status).toBe(404);
        expect((await api(B, 'admin').post(`/caixa/sessoes/${A.sessaoVendedor}/fechamento`, { conferencia: [{ forma: 'dinheiro', informado: 0 }] })).status).toBe(404);
        expect((await api(B, 'admin').patch(`/caixa/caixas/${A.caixaVendedor}`, { ativo: false })).status).toBe(404);

        const caixasB = (await api(B, 'admin').get('/caixa/caixas')).body.data.caixas;
        const sessoesB = (await api(B, 'admin').get('/caixa/sessoes')).body.data;

        expect(caixasB.every((c) => c.nome !== 'Balcão 1')).toBe(true);
        expect(sessoesB.itens.some((s) => s.id === A.sessaoVendedor)).toBe(false);
        expect((await linhas(`SELECT status FROM caixa_sessoes WHERE id = $1`, [A.sessaoVendedor]))[0].status).toBe('aberta');
    });

    test('a mesma chave de idempotência em empresas diferentes não colide', async () => {
        const caixaB = await novoCaixa(B, 'Balcão Idemp');
        const sB = (await abrir(B, 'vendedor', caixaB, 10)).body.data.sessao.id;
        const k = chave();

        expect((await api(A, 'gerente').post(`/caixa/sessoes/${A.sessaoVendedor}/movimentos`, { tipo: 'suprimento', valor: 1, motivo: 'Chave comum' }, k)).status).toBe(201);
        expect((await api(B, 'vendedor').post(`/caixa/sessoes/${sB}/movimentos`, { tipo: 'suprimento', valor: 1, motivo: 'Chave comum' }, k)).status).toBe(201);
    });
});

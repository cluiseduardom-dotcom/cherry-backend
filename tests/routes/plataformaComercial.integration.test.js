// Integração de verdade: administração comercial pelo operador da plataforma
// (planos e condição individual por empresa). Prova acesso (só plataforma_admin + admin,
// lido do BANCO), regra efetiva igual à usada na venda, vigências sem sobreposição,
// correção no mesmo dia, trilha de responsável/encerramento e concorrência.
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
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);

const operador = {}; // empresa do operador (com a marca ligada)
const comum = {}; // empresa de um admin SEM a marca
const alvo = {}; // empresas-alvo das mudanças: { a, b, c }
let hoje;
let amanha;

async function dia(offset) {
    const { rows } = await db.query(`SELECT ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date + $1::int)::text AS d`, [offset]);
    return rows[0].d;
}

async function criarEmpresa(rotulo, comAdmin = true) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Comercial ${rotulo} ${sufixo}`]);
    const empresa = { id: registro.registrar(rows[0].id), nome: `Teste Comercial ${rotulo} ${sufixo}` };

    if (comAdmin) {
        empresa.adminId = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
            [empresa.id, `admin ${rotulo}`, `admin-${rotulo}-${sufixo}@teste.invalid`, HASH]
        )).rows[0].id;
        empresa.email = `admin-${rotulo}-${sufixo}@teste.invalid`;
    }

    return empresa;
}

const token = (empresa) => makeToken({ id: empresa.adminId, role: 'admin', empresa_id: empresa.id, tv: 0 });
const como = (empresa) => ({ Authorization: `Bearer ${token(empresa)}` });
const get = (caminho, empresa = operador) => request(app).get(caminho).set(como(empresa));
const post = (caminho, corpo, empresa = operador) => request(app).post(caminho).set(como(empresa)).send(corpo);

const regraDe = async (empresaId) => {
    const res = await get('/plataforma/empresas/comercial');
    return res.body.data.find((e) => e.empresa_id === empresaId);
};

beforeAll(async () => {
    hoje = await dia(0);
    amanha = await dia(1);

    Object.assign(operador, await criarEmpresa('Operador'));
    Object.assign(comum, await criarEmpresa('Comum'));
    for (const rotulo of ['a', 'b', 'c']) alvo[rotulo] = await criarEmpresa(rotulo.toUpperCase(), false);

    await db.query('UPDATE usuarios SET plataforma_admin = true WHERE id = $1', [operador.adminId]);
});

afterAll(async () => {
    try {
        for (const empresa of [operador, comum, ...Object.values(alvo)]) {
            if (!empresa.id) continue;
            await db.query('DELETE FROM empresa_planos WHERE empresa_id = $1', [empresa.id]);
            await db.query('DELETE FROM condicoes_comerciais_empresa WHERE empresa_id = $1', [empresa.id]);
        }
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('acesso', () => {
    const rotas = [
        ['get', '/plataforma/planos'],
        ['get', '/plataforma/empresas/comercial'],
        ['get', '/plataforma/empresas/1/comercial/historico'],
        ['post', '/plataforma/empresas/1/plano'],
        ['post', '/plataforma/empresas/1/condicao'],
        ['post', '/plataforma/empresas/1/condicao/encerrar']
    ];

    test.each(rotas)('%s %s: sem token 401; admin de empresa SEM a marca 403', async (metodo, caminho) => {
        expect((await request(app)[metodo](caminho)).status).toBe(401);
        expect((await request(app)[metodo](caminho).set(como(comum)).send({})).status).toBe(403);
    });

    test('reivindicar plataforma_admin no token não abre o acesso (a marca vem do banco)', async () => {
        const forjado = makeToken({ id: comum.adminId, role: 'admin', empresa_id: comum.id, tv: 0, plataforma_admin: true });
        expect((await request(app).get('/plataforma/planos').set('Authorization', `Bearer ${forjado}`)).status).toBe(403);
    });
});

describe('leitura', () => {
    test('GET /planos traz o catálogo com o percentual vigente de cada plano', async () => {
        const res = await get('/plataforma/planos');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('no-store');

        const porCodigo = Object.fromEntries(res.body.data.map((p) => [p.codigo, p]));
        expect(porCodigo.cortesia).toMatchObject({ tem_mensalidade: false, percentual: 0.5 });
        expect(porCodigo.basico).toMatchObject({ tem_mensalidade: true, percentual: 0.5 });
        expect(porCodigo.padrao).toMatchObject({ tem_mensalidade: true, percentual: 0.4 });
        expect(porCodigo.pro).toMatchObject({ tem_mensalidade: true, percentual: 0.3 });
    });

    test('empresa sem plano nem condição aparece como padrao_sem_plano', async () => {
        const linha = await regraDe(alvo.a.id);
        expect(linha).toMatchObject({ plano: null, condicao: null });
        expect(linha.regra_efetiva).toMatchObject({ origem: 'padrao_sem_plano', erro: null });
    });

    test('histórico de empresa inexistente: 404; id inválido: 400', async () => {
        expect((await get('/plataforma/empresas/999999999/comercial/historico')).status).toBe(404);
        expect((await get('/plataforma/empresas/abc/comercial/historico')).status).toBe(400);
    });
});

describe('POST /empresas/:id/plano', () => {
    test('atribui o plano a partir de hoje: 201, regra efetiva do plano e responsável = usuário logado', async () => {
        const res = await post(`/plataforma/empresas/${alvo.a.id}/plano`, { plano: 'padrao', justificativa: 'Cliente fechou o plano padrão' });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ plano_codigo: 'padrao', vigencia_inicio: hoje, vigencia_fim: null, ativo: true });

        const linha = await regraDe(alvo.a.id);
        expect(linha.plano).toMatchObject({ codigo: 'padrao', tem_mensalidade: true });
        expect(linha.regra_efetiva).toMatchObject({ percentual: 0.4, origem: 'plano_padrao' });

        const { rows } = await db.query('SELECT responsavel FROM empresa_planos WHERE empresa_id = $1', [alvo.a.id]);
        expect(rows[0].responsavel).toBe(`${operador.email} (#${operador.adminId})`);
    });

    test('responsavel no corpo é recusado (o responsável nunca vem do cliente)', async () => {
        const res = await post(`/plataforma/empresas/${alvo.a.id}/plano`, { plano: 'pro', justificativa: 'teste', responsavel: 'outra pessoa' });
        expect(res.status).toBe(400);
    });

    test('plano agendado para amanhã encerra o vigente hoje (fim = dia anterior) e a regra de hoje não muda', async () => {
        const res = await post(`/plataforma/empresas/${alvo.a.id}/plano`, { plano: 'pro', vigencia_inicio: amanha, justificativa: 'Upgrade combinado' });
        expect(res.status).toBe(201);

        const historico = (await get(`/plataforma/empresas/${alvo.a.id}/comercial/historico`)).body.data;
        const padrao = historico.planos.find((p) => p.plano_codigo === 'padrao');
        expect(padrao).toMatchObject({ vigencia_fim: hoje, encerrado_por: `${operador.email} (#${operador.adminId})`, motivo_encerramento: 'Upgrade combinado' });
        expect(padrao.encerrado_em).not.toBeNull();

        expect((await regraDe(alvo.a.id)).regra_efetiva).toMatchObject({ percentual: 0.4, origem: 'plano_padrao' });
    });

    test('não aceita mudança que colida com plano já agendado (409) nem início no passado (400)', async () => {
        const colide = await post(`/plataforma/empresas/${alvo.a.id}/plano`, { plano: 'basico', justificativa: 'tentativa' });
        expect(colide.status).toBe(409);
        expect(colide.body.message).toContain(amanha);

        const passado = await post(`/plataforma/empresas/${alvo.a.id}/plano`, { plano: 'basico', vigencia_inicio: await dia(-1), justificativa: 'tentativa' });
        expect(passado.status).toBe(400);
    });

    test('mesmo plano já vigente: 409; plano inexistente: 404; empresa inexistente: 404', async () => {
        expect((await post(`/plataforma/empresas/${alvo.b.id}/plano`, { plano: 'basico', justificativa: 'primeira atribuição' })).status).toBe(201);
        expect((await post(`/plataforma/empresas/${alvo.b.id}/plano`, { plano: 'basico', justificativa: 'repetida' })).status).toBe(409);
        expect((await post(`/plataforma/empresas/${alvo.b.id}/plano`, { plano: 'nao_existe', justificativa: 'teste' })).status).toBe(404);
        expect((await post('/plataforma/empresas/999999999/plano', { plano: 'basico', justificativa: 'teste' })).status).toBe(404);

    });

    test('validação: justificativa obrigatória, data inválida e campo desconhecido são 400', async () => {
        const base = `/plataforma/empresas/${alvo.c.id}/plano`;
        expect((await post(base, { plano: 'basico' })).status).toBe(400);
        expect((await post(base, { plano: 'basico', justificativa: '  ' })).status).toBe(400);
        expect((await post(base, { plano: 'basico', vigencia_inicio: '2026-02-30', justificativa: 'teste' })).status).toBe(400);
        expect((await post(base, { plano: 'basico', vigencia_inicio: '30/10/2026', justificativa: 'teste' })).status).toBe(400);
        expect((await post(base, { plano: 'basico', justificativa: 'teste', empresa_id: 1 })).status).toBe(400);
    });

    test('correção no mesmo dia: o registro de hoje é DESATIVADO (nunca apagado) e o novo passa a valer', async () => {
        // alvo.b já está no básico desde hoje
        const res = await post(`/plataforma/empresas/${alvo.b.id}/plano`, { plano: 'pro', justificativa: 'Atribuído errado, era Pro' });
        expect(res.status).toBe(201);

        const { rows } = await db.query(
            `SELECT pl.codigo, ep.ativo, ep.motivo_encerramento FROM empresa_planos ep JOIN planos_comerciais pl ON pl.id = ep.plano_id
             WHERE ep.empresa_id = $1 ORDER BY ep.id`,
            [alvo.b.id]
        );
        expect(rows).toEqual([
            { codigo: 'basico', ativo: false, motivo_encerramento: 'Atribuído errado, era Pro' },
            { codigo: 'pro', ativo: true, motivo_encerramento: null }
        ]);
        expect((await regraDe(alvo.b.id)).regra_efetiva).toMatchObject({ percentual: 0.3, origem: 'plano_padrao' });
    });

    test('duas requisições simultâneas com o mesmo plano: uma cria (201) e a outra recebe 409', async () => {
        const base = `/plataforma/empresas/${alvo.c.id}/plano`;
        const [r1, r2] = await Promise.all([
            post(base, { plano: 'padrao', justificativa: 'concorrência 1' }),
            post(base, { plano: 'padrao', justificativa: 'concorrência 2' })
        ]);

        expect([r1.status, r2.status].sort()).toEqual([201, 409]);
        const { rows } = await db.query('SELECT count(*)::int AS n FROM empresa_planos WHERE empresa_id = $1 AND ativo', [alvo.c.id]);
        expect(rows[0].n).toBe(1);
    });
});

describe('condição individual', () => {
    test('define a exceção de 0,5% (fixa mesmo com plano): 201 e a regra efetiva passa a ser excecao_empresa', async () => {
        const res = await post(`/plataforma/empresas/${alvo.a.id}/condicao`, {
            percentual: 0.5, justificativa: 'Empresa fundadora: todas as funcionalidades e usuários ilimitados'
        });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ percentual: '0.5000', vigencia_inicio: hoje, vigencia_fim: null, ativo: true });

        const linha = await regraDe(alvo.a.id);
        expect(linha.condicao).toMatchObject({ percentual: 0.5, responsavel: `${operador.email} (#${operador.adminId})` });
        expect(linha.regra_efetiva).toMatchObject({ percentual: 0.5, origem: 'excecao_empresa' });
    });

    test('nova condição para amanhã encerra a vigente hoje e registra substitui_id', async () => {
        const antes = (await get(`/plataforma/empresas/${alvo.a.id}/comercial/historico`)).body.data.condicoes[0];

        const res = await post(`/plataforma/empresas/${alvo.a.id}/condicao`, { percentual: 0, vigencia_inicio: amanha, justificativa: 'Isenção negociada' });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ percentual: '0.0000', substitui_id: antes.id });

        const depois = (await get(`/plataforma/empresas/${alvo.a.id}/comercial/historico`)).body.data.condicoes;
        expect(depois.find((c) => c.id === antes.id)).toMatchObject({ vigencia_fim: hoje, motivo_encerramento: 'Isenção negociada' });
        expect((await regraDe(alvo.a.id)).regra_efetiva).toMatchObject({ percentual: 0.5, origem: 'excecao_empresa' });
    });

    test('validação do percentual: fora de 0..100, mais de 4 casas, texto e fim anterior ao início são 400', async () => {
        const base = `/plataforma/empresas/${alvo.c.id}/condicao`;
        expect((await post(base, { percentual: 101, justificativa: 'teste' })).status).toBe(400);
        expect((await post(base, { percentual: -1, justificativa: 'teste' })).status).toBe(400);
        expect((await post(base, { percentual: 0.12345, justificativa: 'teste' })).status).toBe(400);
        expect((await post(base, { percentual: '0.5', justificativa: 'teste' })).status).toBe(400);
        expect((await post(base, { percentual: 0.5 })).status).toBe(400);
        expect((await post(base, { percentual: 0.5, vigencia_inicio: amanha, vigencia_fim: hoje, justificativa: 'teste' })).status).toBe(400);
    });

    test('encerrar a condição vigente a partir de amanhã: fim = hoje; a regra de hoje não muda', async () => {
        const res = await post(`/plataforma/empresas/${alvo.b.id}/condicao`, { percentual: 0.1, justificativa: 'Piloto' });
        expect(res.status).toBe(201);

        const antes = await regraDe(alvo.b.id);
        expect(antes.regra_efetiva).toMatchObject({ percentual: 0.1, origem: 'excecao_empresa' });

        const enc = await post(`/plataforma/empresas/${alvo.b.id}/condicao/encerrar`, { a_partir_de: amanha, justificativa: 'Fim do piloto' });
        expect(enc.status).toBe(200);
        expect(enc.body.data).toMatchObject({ vigencia_fim: hoje, ativo: true });
        expect((await regraDe(alvo.b.id)).regra_efetiva.origem).toBe('excecao_empresa');
    });

    test('encerrar condição que começa hoje, a partir de hoje, cancela (ativo = false) e a empresa volta ao plano', async () => {
        const res = await post(`/plataforma/empresas/${alvo.c.id}/condicao`, { percentual: 0.05, justificativa: 'Teste de cancelamento' });
        expect(res.status).toBe(201);

        const enc = await post(`/plataforma/empresas/${alvo.c.id}/condicao/encerrar`, { justificativa: 'Cadastrada por engano' });
        expect(enc.status).toBe(200);
        expect(enc.body.data).toMatchObject({ ativo: false });

        const { rows } = await db.query('SELECT ativo, encerrado_por, motivo_encerramento FROM condicoes_comerciais_empresa WHERE empresa_id = $1', [alvo.c.id]);
        expect(rows).toEqual([{ ativo: false, encerrado_por: `${operador.email} (#${operador.adminId})`, motivo_encerramento: 'Cadastrada por engano' }]);
        expect((await regraDe(alvo.c.id)).regra_efetiva).toMatchObject({ percentual: 0.4, origem: 'plano_padrao' });
    });

    test('encerrar sem condição vigente: 404', async () => {
        expect((await post(`/plataforma/empresas/${comum.id}/condicao/encerrar`, { justificativa: 'nada a encerrar' })).status).toBe(404);
    });
});

describe('isolamento: a mudança de uma empresa não afeta as outras', () => {
    test('a condição da empresa A não aparece na B nem na C', async () => {
        const [a, b, c] = await Promise.all([alvo.a.id, alvo.b.id, alvo.c.id].map(regraDe));
        expect(a.condicao.percentual).toBe(0.5);
        expect(b.condicao.percentual).toBe(0.1);
        expect(c.condicao).toBeNull();
    });
});

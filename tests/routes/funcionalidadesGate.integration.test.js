// Integração de verdade (Postgres de testes): o bloqueio por plano de ponta a ponta — token real, sessão real,
// lista de funcionalidades resolvida pelo banco. Empresa própria e temporária; remove tudo no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { MENSAGEM } = require('../../src/middlewares/exigirFuncionalidade');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const E = {};

const inserir = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const get = (caminho) => request(app).get(caminho).set('Authorization', `Bearer ${E.token}`);
const bloqueado = (res) => res.status === 403 && res.body.message === MENSAGEM;

async function ligar(funcionalidade, ligada) {
    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel)
         VALUES ($1, $2, $3, 'teste', 'teste')
         ON CONFLICT (empresa_id, funcionalidade) DO UPDATE SET ligada = EXCLUDED.ligada`,
        [E.id, funcionalidade, ligada]
    );
}

beforeAll(async () => {
    E.id = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Gate Funcionalidades ${sufixo}`]));
    E.usuario = await inserir(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`,
        [E.id, `gate-${sufixo}@teste.local`]
    );
    await db.query(
        `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel)
         SELECT $1, id, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date, 'teste', 'teste' FROM planos_comerciais WHERE codigo = 'basico'`,
        [E.id]
    );
    E.token = makeToken({ id: E.usuario, role: 'admin', empresa_id: E.id, tv: 0 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('plano Básico (sem funcionalidades incluídas)', () => {
    test('Bancos e Análise financeira respondem 403 de plano; fluxo de caixa e o núcleo seguem', async () => {
        for (const caminho of ['/bancos/contas', '/financeiro/ponto-equilibrio', '/despesas-fixas']) {
            expect(bloqueado(await get(caminho))).toBe(true);
        }

        expect(bloqueado(await get('/financeiro/fluxo-caixa'))).toBe(false);
    });

    test('ligar `bancos` abre só Bancos', async () => {
        await ligar('bancos', true);

        const bancos = await get('/bancos/contas');
        expect(bancos.status).toBe(200);
        expect(bloqueado(await get('/despesas-fixas'))).toBe(true);
    });

    test('desligar vence: `bancos` desligado volta a bloquear', async () => {
        await ligar('bancos', false);

        expect(bloqueado(await get('/bancos/contas'))).toBe(true);
    });

    test('ligar `analise_financeira` abre ponto de equilíbrio e despesas fixas', async () => {
        await ligar('analise_financeira', true);

        expect((await get('/despesas-fixas')).status).toBe(200);
        expect(bloqueado(await get('/financeiro/ponto-equilibrio'))).toBe(false);
    });
});

describe('empresa sem plano (padrão sem_mensalidade, como Cherry e Valvazori hoje)', () => {
    test('mantém acesso a tudo', async () => {
        const empresa = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Gate Sem Plano ${sufixo}`]));
        const usuario = await inserir(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`,
            [empresa, `gate-sem-plano-${sufixo}@teste.local`]
        );
        const token = makeToken({ id: usuario, role: 'admin', empresa_id: empresa, tv: 0 });
        const chamar = (caminho) => request(app).get(caminho).set('Authorization', `Bearer ${token}`);

        expect((await chamar('/bancos/contas')).status).toBe(200);
        expect((await chamar('/despesas-fixas')).status).toBe(200);
        expect(bloqueado(await chamar('/financeiro/ponto-equilibrio'))).toBe(false);
    });
});

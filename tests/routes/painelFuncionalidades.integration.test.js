// Integração de verdade (Postgres): funcionalidades por empresa operadas pelo Painel GiroNex. Prova acesso só por
// sessão do painel, justificativa obrigatória, módulo não vendável não liga, desligar vence o plano, vigência,
// remover volta ao plano, trilha com detalhe na mesma transação e efeito real na sessão do ERP.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HOJE = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
let operador;
const E = {};

const inserir = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const url = (empresa, codigo = '') => `/painel/empresas/${empresa}/funcionalidades${codigo ? `/${codigo}` : ''}`;
const get = (empresa) => request(app).get(url(empresa)).set(operador.cabecalho);
const put = (empresa, codigo, corpo) => request(app).put(url(empresa, codigo)).set(operador.cabecalho).send(corpo);
const del = (empresa, codigo, corpo) => request(app).delete(url(empresa, codigo)).set(operador.cabecalho).send(corpo);
const situacao = (res, codigo) => res.body.data.funcionalidades.find((f) => f.codigo === codigo);
const daSessao = (empresa) => request(app).get('/bancos/contas').set('Authorization', `Bearer ${makeToken({ id: empresa.usuario, role: 'admin', empresa_id: empresa.id, tv: 0 })}`);

async function novaEmpresa(rotulo, plano) {
    const id = registro.registrar(await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Painel Func ${rotulo} ${sufixo}`]));
    const usuario = await inserir(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`,
        [id, `painel-func-${rotulo}-${sufixo}@teste.invalid`]
    );
    if (plano) {
        await db.query(
            `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel)
             SELECT $1, id, ${HOJE}, 'teste', 'teste' FROM planos_comerciais WHERE codigo = $2`,
            [id, plano]
        );
    }
    return { id, usuario };
}

beforeAll(async () => {
    operador = await criarOperadorComSessao('func');
    E.basico = await novaEmpresa('basico', 'basico');
    E.padrao = await novaEmpresa('padrao', 'padrao');
});

afterAll(async () => {
    try {
        await removerOperador(operador);
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('acesso', () => {
    test('sem sessão do painel: 401; token do ERP não abre o painel', async () => {
        expect((await request(app).get(url(E.basico.id))).status).toBe(401);
        expect((await request(app).get('/painel/funcionalidades')).status).toBe(401);

        const tokenErp = makeToken({ id: E.basico.usuario, role: 'admin', empresa_id: E.basico.id, tv: 0 });
        const res = await request(app).get(url(E.basico.id)).set('Authorization', `Bearer ${tokenErp}`);

        expect(res.status).toBe(401);
    });

    test('empresa inexistente: 404; id inválido: 400', async () => {
        expect((await get(999999999)).status).toBe(404);
        expect((await get('abc')).status).toBe(400);
        expect((await put(999999999, 'bancos', { ligada: true, justificativa: 'teste' })).status).toBe(404);
    });
});

describe('catálogo', () => {
    test('lista funcionalidades e o que cada plano inclui (somente leitura)', async () => {
        const res = await request(app).get('/painel/funcionalidades').set(operador.cabecalho);

        expect(res.status).toBe(200);
        expect(res.body.data.funcionalidades.map((f) => f.codigo)).toEqual(expect.arrayContaining(['bancos', 'fiscal', 'pcp']));
        const plano = (codigo) => res.body.data.planos.find((p) => p.plano === codigo).funcionalidades;
        expect(plano('basico')).toEqual([]);
        expect(plano('padrao')).toEqual(['analise_financeira', 'bancos', 'comissoes', 'maletas']);
    });
});

describe('ligações por empresa', () => {
    test('situação inicial do Básico: nada no plano, nada efetivo', async () => {
        const res = await get(E.basico.id);

        expect(res.status).toBe(200);
        expect(res.body.data.plano).toBe('basico');
        expect(situacao(res, 'bancos')).toMatchObject({ no_plano: false, efetiva: false, ligacao: null });
    });

    test('justificativa é obrigatória; corpo desconhecido é recusado', async () => {
        expect((await put(E.basico.id, 'bancos', { ligada: true })).status).toBe(400);
        expect((await put(E.basico.id, 'bancos', { ligada: true, justificativa: '  ' })).status).toBe(400);
        expect((await put(E.basico.id, 'bancos', { ligada: true, justificativa: 'teste', empresa_id: 1 })).status).toBe(400);
        expect((await put(E.basico.id, 'bancos', { justificativa: 'teste' })).status).toBe(400);
    });

    test('módulo ainda não vendável não liga (409), mas desligar é permitido', async () => {
        expect((await put(E.basico.id, 'fiscal', { ligada: true, justificativa: 'teste' })).status).toBe(409);
        expect((await put(E.basico.id, 'fiscal', { ligada: false, justificativa: 'teste' })).status).toBe(200);
        expect((await put(E.basico.id, 'inexistente', { ligada: true, justificativa: 'teste' })).status).toBe(404);
    });

    test('ligar avulso abre a funcionalidade no ERP; remover volta ao plano', async () => {
        expect((await daSessao(E.basico)).status).toBe(403);

        const ligou = await put(E.basico.id, 'bancos', { ligada: true, justificativa: 'Cliente contratou Bancos avulso' });
        expect(ligou.status).toBe(200);
        expect(situacao(ligou, 'bancos')).toMatchObject({ efetiva: true, no_plano: false });
        expect(situacao(ligou, 'bancos').ligacao).toMatchObject({ ligada: true, vigente: true, justificativa: 'Cliente contratou Bancos avulso' });
        expect(situacao(ligou, 'bancos').ligacao.responsavel).toContain(operador.email);
        expect((await daSessao(E.basico)).status).toBe(200);

        const removeu = await del(E.basico.id, 'bancos', { justificativa: 'Cancelou o avulso' });
        expect(removeu.status).toBe(200);
        expect(situacao(removeu, 'bancos')).toMatchObject({ efetiva: false, ligacao: null });
        expect((await daSessao(E.basico)).status).toBe(403);
        expect((await del(E.basico.id, 'bancos', { justificativa: 'de novo' })).status).toBe(404);
    });

    test('desligar vence o plano que inclui', async () => {
        expect((await daSessao(E.padrao)).status).toBe(200);

        const res = await put(E.padrao.id, 'bancos', { ligada: false, justificativa: 'Suspenso por inadimplência' });

        expect(situacao(res, 'bancos')).toMatchObject({ no_plano: true, efetiva: false });
        expect((await daSessao(E.padrao)).status).toBe(403);
    });

    test('vigência: futura não vale ainda; fim anterior ao início é recusado', async () => {
        const amanha = (await db.query(`SELECT (${HOJE} + 1)::text AS d`)).rows[0].d;
        const ontem = (await db.query(`SELECT (${HOJE} - 1)::text AS d`)).rows[0].d;

        expect((await put(E.basico.id, 'maletas', { ligada: true, justificativa: 'teste', vigencia_inicio: amanha, vigencia_fim: ontem })).status).toBe(400);

        const res = await put(E.basico.id, 'maletas', { ligada: true, justificativa: 'Teste grátis a partir de amanhã', vigencia_inicio: amanha });
        expect(situacao(res, 'maletas')).toMatchObject({ efetiva: false });
        expect(situacao(res, 'maletas').ligacao).toMatchObject({ ligada: true, vigente: false, vigencia_inicio: amanha });
    });

    test('a trilha grava o detalhe, o operador e a empresa-alvo; falha não deixa evento', async () => {
        const { rows } = await db.query(
            `SELECT acao, detalhe FROM plataforma_eventos WHERE operador_id = $1 AND alvo_empresa_id = $2 ORDER BY id`,
            [operador.id, E.basico.id]
        );
        const acoes = rows.map((r) => r.acao);

        expect(acoes).toEqual(expect.arrayContaining(['funcionalidade_ligada', 'funcionalidade_ligacao_removida', 'funcionalidade_desligada']));
        const ligada = rows.find((r) => r.acao === 'funcionalidade_ligada' && r.detalhe.funcionalidade === 'bancos');
        expect(ligada.detalhe).toMatchObject({ ligada: true, justificativa: 'Cliente contratou Bancos avulso' });

        // A tentativa recusada (módulo não vendável) não deixou rastro de "ligada" para o fiscal.
        expect(rows.some((r) => r.acao === 'funcionalidade_ligada' && r.detalhe.funcionalidade === 'fiscal')).toBe(false);
    });
});

// Bloqueio por funcionalidade (plano + ligações da empresa) nas rotas de Bancos, Análise financeira, Maletas e Comissões.
// A sessão é mockada (setupSessao): o que se prova aqui é a fiação das rotas, não a resolução da lista
// (essa tem teste de integração próprio em tests/repositories/funcionalidadesSessao.integration.test.js).
jest.mock('../../src/services/contasBancariasService');
jest.mock('../../src/services/despesasFixasService');
jest.mock('../../src/services/pontoEquilibrioService');
jest.mock('../../src/services/fluxoCaixaService');
jest.mock('../../src/services/taxasVendaService');
jest.mock('../../src/services/transferenciasEstoqueService');
jest.mock('../../src/services/comissoesService');

const request = require('supertest');
const app = require('../../src/app');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const { MENSAGEM } = require('../../src/middlewares/exigirFuncionalidade');
const { makeToken } = require('../helpers/token');

const admin = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedor = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });

const estado = (funcionalidades) => ({ ativo: true, token_version: 0, empresa_status: 'ativa', funcionalidades });
const comLista = (lista) => sessaoRepository.buscarEstado.mockResolvedValue(estado(lista));

const BANCOS = [
    ['get', '/bancos/contas'], ['post', '/bancos/contas'], ['get', '/bancos/contas/1'], ['patch', '/bancos/contas/1'],
    ['patch', '/bancos/contas/1/status'], ['get', '/bancos/movimentos'], ['post', '/bancos/movimentos'],
    ['post', '/bancos/movimentos/1/cancelar'], ['get', '/bancos/conciliacoes'], ['post', '/bancos/conciliacoes'],
    ['post', '/bancos/conciliacoes/1/desfazer'], ['post', '/bancos/mercadopago/sincronizar'],
    ['post', '/bancos/importacoes/previa'], ['post', '/bancos/importacoes'], ['get', '/bancos/movimentos/1/sugestoes']
];
const ANALISE = [
    ['get', '/financeiro/ponto-equilibrio'], ['get', '/despesas-fixas'], ['post', '/despesas-fixas'],
    ['put', '/despesas-fixas/1'], ['delete', '/despesas-fixas/1'], ['patch', '/despesas-fixas/1/toggle']
];

const MALETAS = [
    ['post', '/estoque/locais'], ['get', '/estoque/locais/1/acerto'], ['post', '/estoque/locais/1/conferencias'],
    ['get', '/estoque/locais/1/conferencias'], ['post', '/estoque/transferencias'], ['get', '/estoque/transferencias'],
    ['get', '/estoque/transferencias/1'], ['post', '/estoque/transferencias/1/aceitar'],
    ['post', '/estoque/transferencias/1/recusar'], ['post', '/estoque/transferencias/1/cancelar']
];
const COMISSOES = [
    ['get', '/comissoes/minhas'], ['get', '/comissoes/equipe'], ['get', '/comissoes/repasses'],
    ['post', '/comissoes/repasses/1/confirmar'], ['get', '/comissoes/a-pagar'], ['post', '/comissoes/pagamentos'],
    ['get', '/comissoes/pagamentos'], ['get', '/comissoes/configuracao'], ['put', '/comissoes/configuracao'],
    ['get', '/comissoes/1/historico'], ['get', '/comissoes/percentuais'], ['put', '/comissoes/percentuais']
];

const bloqueado = (res) => res.status === 403 && res.body.message === MENSAGEM;

describe('Bancos exige a funcionalidade `bancos`', () => {
    test.each(BANCOS)('%s %s → 403 sem a funcionalidade, mesmo para admin', async (metodo, caminho) => {
        comLista(['analise_financeira', 'comissoes', 'maletas']);

        const res = await request(app)[metodo](caminho).set('Authorization', `Bearer ${admin}`).send({});

        expect(bloqueado(res)).toBe(true);
    });

    test('com a funcionalidade a rota segue para o controller', async () => {
        comLista(['bancos']);

        const res = await request(app).get('/bancos/contas').set('Authorization', `Bearer ${admin}`);

        expect(bloqueado(res)).toBe(false);
        expect(res.status).toBe(200);
    });
});

describe('Análise financeira exige a funcionalidade `analise_financeira`', () => {
    test.each(ANALISE)('%s %s → 403 sem a funcionalidade, mesmo para admin', async (metodo, caminho) => {
        comLista(['bancos', 'comissoes', 'maletas']);

        const res = await request(app)[metodo](caminho).set('Authorization', `Bearer ${admin}`).send({});

        expect(bloqueado(res)).toBe(true);
    });

    test.each([['/financeiro/ponto-equilibrio'], ['/despesas-fixas']])('com a funcionalidade %s chega ao controller', async (caminho) => {
        comLista(['analise_financeira']);

        const res = await request(app).get(caminho).set('Authorization', `Bearer ${admin}`);

        expect(bloqueado(res)).toBe(false);
    });

    test('fluxo de caixa e taxas de venda continuam no núcleo (sem a funcionalidade, não bloqueiam)', async () => {
        comLista([]);

        for (const caminho of ['/financeiro/fluxo-caixa', '/financeiro/taxas-venda']) {
            const res = await request(app).get(caminho).set('Authorization', `Bearer ${admin}`);

            expect(bloqueado(res)).toBe(false);
        }
    });
});

describe('Maletas exige a funcionalidade `maletas`', () => {
    test.each(MALETAS)('%s %s → 403 sem a funcionalidade, mesmo para admin', async (metodo, caminho) => {
        comLista(['bancos', 'analise_financeira', 'comissoes']);

        const res = await request(app)[metodo](caminho).set('Authorization', `Bearer ${admin}`).send({});

        expect(bloqueado(res)).toBe(true);
    });

    test.each([['get', '/estoque/locais'], ['get', '/estoque/locais/1/saldos']])(
        'ler locais e saldos continua no núcleo (%s %s)', async (metodo, caminho) => {
            comLista([]);

            const res = await request(app)[metodo](caminho).set('Authorization', `Bearer ${vendedor}`);

            expect(bloqueado(res)).toBe(false);
        }
    );

    test('com a funcionalidade, a transferência chega ao controller', async () => {
        comLista(['maletas']);

        const res = await request(app).get('/estoque/transferencias').set('Authorization', `Bearer ${vendedor}`);

        expect(bloqueado(res)).toBe(false);
    });
});

describe('Comissões exige a funcionalidade `comissoes`', () => {
    test.each(COMISSOES)('%s %s → 403 sem a funcionalidade, mesmo para admin', async (metodo, caminho) => {
        comLista(['bancos', 'analise_financeira', 'maletas']);

        const res = await request(app)[metodo](caminho).set('Authorization', `Bearer ${admin}`).send({});

        expect(bloqueado(res)).toBe(true);
    });

    test('com a funcionalidade, as comissões do vendedor chegam ao controller', async () => {
        comLista(['comissoes']);

        const res = await request(app).get('/comissoes/minhas').set('Authorization', `Bearer ${vendedor}`);

        expect(bloqueado(res)).toBe(false);
    });

    test('devolução de Pix (/pagamentos-gateway) não depende de Comissões', async () => {
        comLista([]);

        const res = await request(app).get('/pagamentos-gateway/a-devolver').set('Authorization', `Bearer ${vendedor}`);

        expect(bloqueado(res)).toBe(false);
    });
});

describe('ordem das barreiras', () => {
    test('quem não tem o papel continua recebendo o 403 de permissão, não o de plano', async () => {
        comLista(['bancos', 'analise_financeira']);

        const res = await request(app).get('/despesas-fixas').set('Authorization', `Bearer ${vendedor}`);

        expect(res.status).toBe(403);
        expect(bloqueado(res)).toBe(false);
    });

    test('sem token continua 401', async () => {
        const res = await request(app).get('/bancos/contas');

        expect(res.status).toBe(401);
    });

    test('lista ausente na sessão bloqueia (fail-closed)', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 0, empresa_status: 'ativa' });

        const res = await request(app).get('/bancos/contas').set('Authorization', `Bearer ${admin}`);

        expect(bloqueado(res)).toBe(true);
    });
});

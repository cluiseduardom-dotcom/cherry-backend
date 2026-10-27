jest.mock('../../src/repositories/notificacoesRepository');

const request = require('supertest');
const notificacoesRepository = require('../../src/repositories/notificacoesRepository');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const estado = (extra) => ({ ativo: true, token_version: 0, empresa_status: 'ativa', ...extra });
const linhas = [
    { id: 1, sku: 'ANE-001', nome: 'Anel', tipo: 'acabado', estoque_atual: 0, estoque_minimo: 3, vendido_30d: 0, vendido_90d: 0, dias_sem_venda: 3, dias_cadastro: 200 },
    { id: 2, sku: 'COL-002', nome: 'Colar', tipo: 'acabado', estoque_atual: 5, estoque_minimo: 0, vendido_30d: 0, vendido_90d: 0, dias_sem_venda: 150, dias_cadastro: 300 }
];

const chamar = (role, sessao, empresa_id = 7) => {
    sessaoRepository.buscarEstado.mockResolvedValue(sessao);
    notificacoesRepository.listarBaseDeProdutos.mockResolvedValue(linhas);
    return request(app).get('/notificacoes').set('Authorization', `Bearer ${makeToken({ id: 3, role, empresa_id, tv: 0 })}`);
};

beforeEach(() => jest.clearAllMocks());

describe('GET /notificacoes', () => {
    test('exige autenticação', async () => {
        const res = await request(app).get('/notificacoes');
        expect(res.status).toBe(401);
    });

    test('admin recebe falta e parado; consulta usa o empresa_id do JWT', async () => {
        const res = await chamar('admin', estado({ papel: 'admin' }));
        expect(res.status).toBe(200);
        expect(res.body.data.itens.map((i) => i.tipo)).toEqual(['falta', 'parado']);
        expect(res.body.data.total).toBe(2);
        expect(notificacoesRepository.listarBaseDeProdutos).toHaveBeenCalledWith(7);
    });

    test('vendedor recebe só falta', async () => {
        const res = await chamar('vendedor', estado({ papel: 'vendedor' }));
        expect(res.status).toBe(200);
        expect(res.body.data.itens.map((i) => i.tipo)).toEqual(['falta']);
    });
});

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

const chamar = (role, sessao, empresa_id = 7, id = 3) => {
    sessaoRepository.buscarEstado.mockResolvedValue(sessao);
    notificacoesRepository.listarBaseDeProdutos.mockResolvedValue(linhas);
    return request(app).get('/notificacoes').set('Authorization', `Bearer ${makeToken({ id, role, empresa_id, tv: 0 })}`);
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

    describe('avisos de maleta', () => {
        const maletas = [{ local_id: 5, nome: 'Maleta Ana', usuario_id: 3, saldo_total: 8, dias_sem_venda: 40, dias_sem_conferencia: 2, conferencia_divergente_id: null, itens_divergentes: null }];
        const pendentes = [{ id: 9, origem_nome: 'Central', destino_nome: 'Maleta Ana', destino_usuario_id: 3, pecas: 2, dias: 5 }];
        const comMaletas = (extra) => estado({ funcionalidades: ['maletas'], ...extra });

        beforeEach(() => {
            notificacoesRepository.listarBaseDeMaletas.mockResolvedValue(maletas);
            notificacoesRepository.listarTransferenciasPendentes.mockResolvedValue(pendentes);
        });

        test('com a funcionalidade maletas, admin recebe transferência pendente e maleta sem vender; consultas usam o empresa_id do JWT', async () => {
            const res = await chamar('admin', comMaletas({ papel: 'admin' }), 7, 1);
            expect(res.status).toBe(200);
            expect(res.body.data.itens.map((i) => i.tipo)).toEqual(['falta', 'transferencia_pendente', 'maleta_sem_venda', 'parado']);
            expect(notificacoesRepository.listarBaseDeMaletas).toHaveBeenCalledWith(7);
            expect(notificacoesRepository.listarTransferenciasPendentes).toHaveBeenCalledWith(7);
        });

        test('sem a funcionalidade maletas, nem consulta nem aviso', async () => {
            const res = await chamar('admin', estado({ papel: 'admin' }), 7, 1);
            expect(res.body.data.itens.map((i) => i.tipo)).toEqual(['falta', 'parado']);
            expect(notificacoesRepository.listarBaseDeMaletas).not.toHaveBeenCalled();
            expect(notificacoesRepository.listarTransferenciasPendentes).not.toHaveBeenCalled();
        });

        test('o dono (vendedor) recebe só os avisos da própria maleta; outro vendedor não recebe nenhum', async () => {
            const dono = await chamar('vendedor', comMaletas({ papel: 'vendedor' }), 7, 3);
            expect(dono.body.data.itens.map((i) => i.tipo)).toEqual(['falta', 'transferencia_pendente', 'maleta_sem_venda']);
            const outro = await chamar('vendedor', comMaletas({ papel: 'vendedor' }), 7, 4);
            expect(outro.body.data.itens.map((i) => i.tipo)).toEqual(['falta']);
        });
    });
});

jest.mock('../../src/services/transferenciasEstoqueService');

const request = require('supertest');
const service = require('../../src/services/transferenciasEstoqueService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const adminToken = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const estoquistaToken = makeToken({ id: 2, role: 'estoquista', empresa_id: 1 });
const vendedorToken = makeToken({ id: 3, role: 'vendedor', empresa_id: 1 });
const corpo = { origem_local_id: 1, destino_local_id: 2, itens: [{ produto_id: 5, quantidade: 3 }] };
const como = (metodo, url, token, dados) => request(app)[metodo](url).set('Authorization', `Bearer ${token}`).send(dados);

beforeEach(() => jest.clearAllMocks());

describe('autenticação', () => {
    test.each([
        ['post', '/estoque/transferencias'],
        ['get', '/estoque/transferencias'],
        ['get', '/estoque/transferencias/1'],
        ['post', '/estoque/transferencias/1/aceitar'],
        ['post', '/estoque/transferencias/1/recusar'],
        ['post', '/estoque/transferencias/1/cancelar'],
        ['post', '/estoque/locais'],
    ])('%s %s exige token', async (metodo, url) => {
        expect((await request(app)[metodo](url)).status).toBe(401);
    });
});

describe('POST /estoque/transferencias', () => {
    test('201 com o corpo válido; empresa e usuário vêm do token', async () => {
        service.criar.mockResolvedValue({ id: 9, status: 'pendente' });

        const res = await como('post', '/estoque/transferencias', estoquistaToken, corpo);

        expect(res.status).toBe(201);
        expect(service.criar).toHaveBeenCalledWith(corpo, expect.objectContaining({ id: 2, empresa_id: 1 }));
    });

    test('400 para corpo inválido e para campo fora do contrato, sem chamar o service', async () => {
        expect((await como('post', '/estoque/transferencias', estoquistaToken, { ...corpo, itens: [] })).status).toBe(400);
        expect((await como('post', '/estoque/transferencias', estoquistaToken, { ...corpo, empresa_id: 7 })).status).toBe(400);
        expect(service.criar).not.toHaveBeenCalled();
    });

    test('propaga 403 e 409 do service', async () => {
        service.criar.mockRejectedValueOnce(new AppError('Você só pode devolver mercadoria da sua própria maleta para o Central', 403));
        expect((await como('post', '/estoque/transferencias', vendedorToken, corpo)).status).toBe(403);

        service.criar.mockRejectedValueOnce(new AppError('Estoque insuficiente no local para o produto #5', 409));
        expect((await como('post', '/estoque/transferencias', estoquistaToken, corpo)).status).toBe(409);
    });
});

describe('aceitar / recusar / cancelar', () => {
    test('aceitar chama o service com a ação e o usuário do token', async () => {
        service.resolver.mockResolvedValue({ id: 4, status: 'concluida' });

        const res = await como('post', '/estoque/transferencias/4/aceitar', vendedorToken, {});

        expect(res.status).toBe(200);
        expect(service.resolver).toHaveBeenCalledWith('aceitar', 4, undefined, expect.objectContaining({ id: 3 }));
    });

    test('recusar e cancelar exigem motivo (400 sem ele)', async () => {
        expect((await como('post', '/estoque/transferencias/4/recusar', vendedorToken, {})).status).toBe(400);
        expect((await como('post', '/estoque/transferencias/4/cancelar', estoquistaToken, { motivo: 'x' })).status).toBe(400);
        expect(service.resolver).not.toHaveBeenCalled();

        service.resolver.mockResolvedValue({ id: 4, status: 'recusada' });
        expect((await como('post', '/estoque/transferencias/4/recusar', vendedorToken, { motivo: 'Peças erradas' })).status).toBe(200);
        expect(service.resolver).toHaveBeenCalledWith('recusar', 4, 'Peças erradas', expect.anything());
    });

    test('id inválido = 400', async () => {
        expect((await como('post', '/estoque/transferencias/abc/aceitar', vendedorToken, {})).status).toBe(400);
        expect((await como('get', '/estoque/transferencias/0', vendedorToken)).status).toBe(400);
    });
});

describe('GET /estoque/transferencias', () => {
    test('repassa status e paginação; status inválido = 400', async () => {
        service.listar.mockResolvedValue({ items: [], total: 0 });

        expect((await como('get', '/estoque/transferencias?status=pendente&page=2&pageSize=500', vendedorToken)).status).toBe(200);
        expect(service.listar).toHaveBeenCalledWith({ status: 'pendente', page: 2, pageSize: 100 }, expect.objectContaining({ id: 3 }));
        expect((await como('get', '/estoque/transferencias?status=zzz', vendedorToken)).status).toBe(400);
    });
});

describe('POST /estoque/locais (só admin)', () => {
    test('estoquista e vendedor recebem 403; admin cria', async () => {
        expect((await como('post', '/estoque/locais', estoquistaToken, { tipo: 'maleta', usuario_id: 3 })).status).toBe(403);
        expect((await como('post', '/estoque/locais', vendedorToken, { tipo: 'maleta', usuario_id: 3 })).status).toBe(403);
        expect(service.criarLocal).not.toHaveBeenCalled();

        service.criarLocal.mockResolvedValue({ id: 5, tipo: 'maleta' });
        const res = await como('post', '/estoque/locais', adminToken, { tipo: 'maleta', usuario_id: 3 });
        expect(res.status).toBe(201);
        expect(service.criarLocal).toHaveBeenCalledWith({ tipo: 'maleta', usuario_id: 3 }, expect.objectContaining({ id: 1 }));
    });

    test('tipo central/trânsito não é criável (400)', async () => {
        expect((await como('post', '/estoque/locais', adminToken, { tipo: 'central' })).status).toBe(400);
    });
});

jest.mock('../../src/services/internoService');

const request = require('supertest');
const internoService = require('../../src/services/internoService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');

const SEGREDO = 'segredo-interno-de-teste-nao-real-123';
const corpoModulo = { ativo: true, responsavel: 'Eduardo', justificativa: 'Contrato Valvazori' };
const corpoTema = { tema: 'cherry', responsavel: 'Eduardo', justificativa: 'Identidade do cliente' };

let segredoOriginal;

beforeAll(() => {
    segredoOriginal = process.env.INTERNO_SECRET;
    process.env.INTERNO_SECRET = SEGREDO;
});
afterAll(() => {
    if (segredoOriginal === undefined) delete process.env.INTERNO_SECRET;
    else process.env.INTERNO_SECRET = segredoOriginal;
});
beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const comSegredo = (req) => req.set('X-Interno-Secret', SEGREDO);

describe('/interno — acesso', () => {
    test('sem segredo: 401 e o serviço nunca é chamado, em todas as rotas', async () => {
        const respostas = await Promise.all([
            request(app).get('/interno/empresas'),
            request(app).put('/interno/empresas/1/tema').send(corpoTema),
            request(app).put('/interno/empresas/1/modulos/grade').send(corpoModulo)
        ]);

        respostas.forEach((res) => expect(res.status).toBe(401));
        expect(internoService.listarEmpresas).not.toHaveBeenCalled();
        expect(internoService.definirTema).not.toHaveBeenCalled();
        expect(internoService.definirModulo).not.toHaveBeenCalled();
    });

    test('um JWT de tenant (mesmo admin) não abre o painel interno', async () => {
        const res = await request(app)
            .get('/interno/empresas')
            .set('Authorization', 'Bearer qualquer-token-de-tenant');

        expect(res.status).toBe(401);
        expect(internoService.listarEmpresas).not.toHaveBeenCalled();
    });

    test('segredo errado: 401', async () => {
        const res = await request(app).get('/interno/empresas').set('X-Interno-Secret', 'errado');

        expect(res.status).toBe(401);
    });
});

describe('GET /interno/empresas', () => {
    test('lista as empresas com tema e módulos ativos', async () => {
        internoService.listarEmpresas.mockResolvedValue([
            { id: 1, nome: 'Cherry Semijoias', status: 'ativa', tema_visual: 'cherry', modulos: ['grade'] }
        ]);

        const res = await comSegredo(request(app).get('/interno/empresas'));

        expect(res.status).toBe(200);
        expect(res.body.data[0].modulos).toEqual(['grade']);
    });
});

describe('PUT /interno/empresas/:id/tema', () => {
    test('define o tema', async () => {
        internoService.definirTema.mockResolvedValue({ id: 7, nome: 'X', tema_visual: 'cherry' });

        const res = await comSegredo(request(app).put('/interno/empresas/7/tema')).send(corpoTema);

        expect(res.status).toBe(200);
        expect(internoService.definirTema).toHaveBeenCalledWith({ empresa_id: 7, ...corpoTema });
    });

    test.each([
        [{ ...corpoTema, tema: 'rosa' }],
        [{ ...corpoTema, responsavel: '' }],
        [{ ...corpoTema, justificativa: ' ' }],
        [{ tema: 'cherry' }],
        [{ ...corpoTema, empresa_id: 99 }]
    ])('corpo inválido %j: 400', async (corpo) => {
        const res = await comSegredo(request(app).put('/interno/empresas/7/tema')).send(corpo);

        expect(res.status).toBe(400);
        expect(internoService.definirTema).not.toHaveBeenCalled();
    });

    test.each(['abc', '0', '-1', '1.5'])('empresa inválida %p: 400', async (id) => {
        const res = await comSegredo(request(app).put(`/interno/empresas/${id}/tema`)).send(corpoTema);

        expect(res.status).toBe(400);
    });

    test('empresa inexistente: 404', async () => {
        internoService.definirTema.mockRejectedValue(new AppError('Empresa não encontrada', 404));

        const res = await comSegredo(request(app).put('/interno/empresas/999/tema')).send(corpoTema);

        expect(res.status).toBe(404);
    });
});

describe('PUT /interno/empresas/:id/modulos/:modulo', () => {
    test('liga e desliga um módulo', async () => {
        internoService.definirModulo.mockResolvedValue({ empresa_id: 7, modulo: 'grade', ativo: true });

        const res = await comSegredo(request(app).put('/interno/empresas/7/modulos/grade')).send(corpoModulo);

        expect(res.status).toBe(200);
        expect(internoService.definirModulo).toHaveBeenCalledWith({ empresa_id: 7, modulo: 'grade', ...corpoModulo });
    });

    test.each([
        ['core', corpoModulo],
        ['inexistente', corpoModulo],
        ['grade', { ...corpoModulo, ativo: 'sim' }],
        ['grade', { ...corpoModulo, ativo: undefined }],
        ['grade', { ...corpoModulo, justificativa: '' }],
        ['grade', { ...corpoModulo, responsavel: '' }]
    ])('módulo %p com corpo inválido: 400', async (modulo, corpo) => {
        const res = await comSegredo(request(app).put(`/interno/empresas/7/modulos/${modulo}`)).send(corpo);

        expect(res.status).toBe(400);
        expect(internoService.definirModulo).not.toHaveBeenCalled();
    });

    test('empresa inexistente: 404', async () => {
        internoService.definirModulo.mockRejectedValue(new AppError('Empresa não encontrada', 404));

        const res = await comSegredo(request(app).put('/interno/empresas/999/modulos/grade')).send(corpoModulo);

        expect(res.status).toBe(404);
    });
});

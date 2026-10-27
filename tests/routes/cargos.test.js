jest.mock('../../src/services/cargosService');

const request = require('supertest');
const cargosService = require('../../src/services/cargosService');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const token = (id = 1, empresa_id = 7) => makeToken({ id, role: 'admin', empresa_id, tv: 0 });
const estado = (extra = {}) => ({ ativo: true, token_version: 0, empresa_status: 'ativa', ...extra });
const comoGerente = (capacidades) => estado({
    papel: 'gerente', cargo_configurado: true, cargo_nivel: 70, cargo_ativo: true, cargo_capacidades: capacidades
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/cargos — autorização', () => {
    test('401 sem token', async () => {
        const res = await request(app).get('/cargos');

        expect(res.status).toBe(401);
        expect(cargosService.listar).not.toHaveBeenCalled();
    });

    test('Vendedor recebe 403 em GET e PUT', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'vendedor' }));

        const get = await request(app).get('/cargos').set('Authorization', `Bearer ${token()}`);
        const put = await request(app).put('/cargos/gerente').set('Authorization', `Bearer ${token()}`).send({ ativo: true });

        expect(get.status).toBe(403);
        expect(put.status).toBe(403);
        expect(cargosService.listar).not.toHaveBeenCalled();
        expect(cargosService.atualizar).not.toHaveBeenCalled();
    });

    test('Estoquista recebe 403', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'estoquista' }));

        const res = await request(app).get('/cargos').set('Authorization', `Bearer ${token()}`);

        expect(res.status).toBe(403);
    });

    test('Gerente sem `gerir_cargos` recebe 403, mesmo com ver_custos', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(comoGerente(['ver_custos']));

        const res = await request(app).get('/cargos').set('Authorization', `Bearer ${token()}`);

        expect(res.status).toBe(403);
    });

    test('Gerente com `gerir_cargos` (delegado pelo Admin) acessa', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(comoGerente(['gerir_cargos']));
        cargosService.listar.mockResolvedValue([]);

        const res = await request(app).get('/cargos').set('Authorization', `Bearer ${token()}`);

        expect(res.status).toBe(200);
    });

    test('o JWT dizendo admin não vale se o banco já rebaixou o usuário', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'vendedor' }));

        const res = await request(app).get('/cargos').set('Authorization', `Bearer ${makeToken({ id: 1, role: 'admin', empresa_id: 7, tv: 0 })}`);

        expect(res.status).toBe(403);
    });
});

describe('GET /cargos', () => {
    test('Admin lista usando a empresa do TOKEN, ignorando empresa_id da query', async () => {
        cargosService.listar.mockResolvedValue([{ cargo: 'admin' }]);
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'admin' }));

        const res = await request(app).get('/cargos?empresa_id=999').set('Authorization', `Bearer ${token(1, 7)}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: [{ cargo: 'admin' }] });
        expect(cargosService.listar).toHaveBeenCalledWith(7);
    });
});

describe('PUT /cargos/:cargo', () => {
    const admin = () => sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'admin' }));
    const put = (cargo, corpo, t = token(1, 7)) => request(app).put(`/cargos/${cargo}`).set('Authorization', `Bearer ${t}`).send(corpo);

    test('atualiza com empresa e usuário do token; empresa_id do corpo é recusado', async () => {
        admin();
        cargosService.atualizar.mockResolvedValue({ cargo: 'gerente', ativo: true });

        const ok = await put('gerente', { ativo: true, nivel: 70, capacidades: ['ver_custos'] });

        expect(ok.status).toBe(200);
        expect(cargosService.atualizar).toHaveBeenCalledWith(
            7, 'gerente', { ativo: true, nivel: 70, capacidades: ['ver_custos'] },
            expect.objectContaining({ id: 1, empresa_id: 7, role: 'admin' })
        );

        const injetado = await put('gerente', { ativo: true, empresa_id: 999 });

        expect(injetado.status).toBe(400);
        expect(cargosService.atualizar).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['cargo inexistente', 'presidente', { ativo: true }],
        ['corpo vazio', 'gerente', {}],
        ['nível 0', 'gerente', { nivel: 0 }],
        ['nível 90 (reservado ao Admin)', 'gerente', { nivel: 90 }],
        ['nível decimal', 'gerente', { nivel: 50.5 }],
        ['nível texto', 'gerente', { nivel: '50' }],
        ['ativo texto', 'gerente', { ativo: 'sim' }],
        ['capacidade inexistente', 'gerente', { capacidades: ['hackear'] }],
        ['`administrador` não é configurável por aqui', 'gerente', { capacidades: ['administrador'] }],
        ['capacidades repetidas', 'gerente', { capacidades: ['ver_custos', 'ver_custos'] }]
    ])('400: %s', async (_nome, cargo, corpo) => {
        admin();

        const res = await put(cargo, corpo);

        expect(res.status).toBe(400);
        expect(cargosService.atualizar).not.toHaveBeenCalled();
    });

    test('regras do serviço chegam como 403/409 do jeito que o serviço devolveu', async () => {
        admin();
        cargosService.atualizar.mockRejectedValueOnce(new AppError('O cargo Admin não pode ser alterado', 403));
        cargosService.atualizar.mockRejectedValueOnce(new AppError('Há 2 usuário(s) ativo(s) neste cargo; mude o cargo deles antes de desativar', 409));

        expect((await put('admin', { ativo: false })).status).toBe(403);
        expect((await put('gerente', { ativo: false })).status).toBe(409);
    });
});

describe('GET /auth/me', () => {
    test('401 sem token', async () => {
        expect((await request(app).get('/auth/me')).status).toBe(401);
    });

    test('devolve cargo, nível e capacidades vigentes no banco (não os do JWT)', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(comoGerente(['ver_custos', 'cancelar_venda']));

        const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${makeToken({ id: 5, role: 'vendedor', empresa_id: 7, tv: 0 })}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: { id: 5, empresa_id: 7, perfil: 'vendedor', cargo: 'gerente', nivel: 70, capacidades: ['ver_custos', 'cancelar_venda'], senha_temporaria: false }
        });
    });

    test('não vaza dados sensíveis da sessão', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'admin' }));

        const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token()}`);

        expect(Object.keys(res.body.data).sort()).toEqual(['capacidades', 'cargo', 'empresa_id', 'id', 'nivel', 'perfil', 'senha_temporaria']);
    });
});

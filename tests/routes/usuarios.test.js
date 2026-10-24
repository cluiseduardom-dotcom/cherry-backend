jest.mock('../../src/services/usuariosService');

const request = require('supertest');
const usuariosService = require('../../src/services/usuariosService');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const token = makeToken({ id: 10, role: 'vendedor', empresa_id: 7, tv: 0 });
const estado = (extra = {}) => ({ ativo: true, token_version: 0, empresa_status: 'ativa', ...extra });
const sessao = (papel) => estado({ papel });
// Cargos da escada vêm desligados por padrão: o comércio os liga em cargos_empresa.
const gerenteLigado = (capacidades = ['gerir_usuarios']) => estado({
    papel: 'gerente', cargo_configurado: true, cargo_nivel: 70, cargo_ativo: true, cargo_capacidades: capacidades
});

beforeEach(() => {
    jest.clearAllMocks();
    sessaoRepository.buscarEstado.mockResolvedValue(gerenteLigado());
});

const call = (metodo, url, corpo) => request(app)[metodo](url).set('Authorization', `Bearer ${token}`).send(corpo);

const rotas = [
    ['get', '/usuarios'],
    ['get', '/usuarios/cargos'],
    ['get', '/usuarios/5'],
    ['patch', '/usuarios/5/dados'],
    ['post', '/usuarios'],
    ['get', '/usuarios/eventos'],
    ['patch', '/usuarios/5/bloqueio']
];

describe('/usuarios — autorização', () => {
    test.each(rotas)('%s %s: 401 sem token', async (metodo, url) => {
        expect((await request(app)[metodo](url)).status).toBe(401);
    });

    test.each(rotas)('%s %s: 403 para Vendedor, Estoquista e Gerente sem gerir_usuarios', async (metodo, url) => {
        for (const s of [sessao('vendedor'), sessao('estoquista'), gerenteLigado(['ver_custos'])]) {
            sessaoRepository.buscarEstado.mockResolvedValue(s);
            expect((await call(metodo, url, {})).status).toBe(403);
        }

        Object.values(usuariosService).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });
});

describe('/usuarios — validação', () => {
    test('POST rejeita campos extras (empresa_id, ativo)', async () => {
        const res = await call('post', '/usuarios', { nome: 'A', email: 'a@x.com', senha: '123456', papel: 'vendedor', empresa_id: 99 });
        expect(res.status).toBe(400);
        expect(usuariosService.criar).not.toHaveBeenCalled();
    });

    test('POST rejeita papel inválido e senha curta', async () => {
        expect((await call('post', '/usuarios', { nome: 'A', email: 'a@x.com', senha: '123456', papel: 'root' })).status).toBe(400);
        expect((await call('post', '/usuarios', { nome: 'A', email: 'a@x.com', senha: '123', papel: 'vendedor' })).status).toBe(400);
    });

    test('PATCH bloqueio exige motivo e booleano', async () => {
        expect((await call('patch', '/usuarios/5/bloqueio', { bloqueado: true })).status).toBe(400);
        expect((await call('patch', '/usuarios/5/bloqueio', { bloqueado: 'sim', motivo: 'abc' })).status).toBe(400);
        expect((await call('patch', '/usuarios/abc/bloqueio', { bloqueado: true, motivo: 'abc' })).status).toBe(400);
        expect(usuariosService.definirBloqueio).not.toHaveBeenCalled();
    });
});

describe('/usuarios — fluxo', () => {
    test('POST cria (201) com o ator do JWT', async () => {
        usuariosService.criar.mockResolvedValue({ usuario: { id: 9 } });
        const res = await call('post', '/usuarios', { nome: 'A', email: 'a@x.com', senha: '123456', papel: 'vendedor', telefone: '(11) 91234-5678' });

        expect(res.status).toBe(201);
        expect(usuariosService.criar.mock.calls[0][1]).toMatchObject({ id: 10, empresa_id: 7, nivel: 70 });
    });

    test('POST exige telefone e recusa CPF inválido', async () => {
        const base = { nome: 'A', email: 'a@x.com', senha: '123456', papel: 'vendedor' };

        expect((await call('post', '/usuarios', base)).status).toBe(400);
        expect((await call('post', '/usuarios', { ...base, telefone: '11912345678', cpf: '11111111111' })).status).toBe(400);
        expect(usuariosService.criar).not.toHaveBeenCalled();
    });

    test('GET /:id e PATCH /:id/dados chamam o service com ator do JWT', async () => {
        usuariosService.detalhar.mockResolvedValue({ id: 5 });
        usuariosService.editarDados.mockResolvedValue({ alterado: true, campos: ['cpf'] });

        expect((await call('get', '/usuarios/5')).status).toBe(200);
        expect(usuariosService.detalhar).toHaveBeenCalledWith(5, expect.objectContaining({ id: 10, empresa_id: 7 }));

        const res = await call('patch', '/usuarios/5/dados', { cpf: '529.982.247-25' });
        expect(res.status).toBe(200);
        expect(usuariosService.editarDados).toHaveBeenCalledWith(5, { cpf: '52998224725' }, expect.objectContaining({ id: 10 }));
    });

    test('PATCH /:id/dados recusa corpo vazio, campo desconhecido e telefone apagado', async () => {
        for (const corpo of [{}, { empresa_id: 1 }, { ativo: false }, { telefone: null }, { telefone: '123' }]) {
            expect((await call('patch', '/usuarios/5/dados', corpo)).status).toBe(400);
        }
        expect(usuariosService.editarDados).not.toHaveBeenCalled();
    });

    test('PATCH bloqueio chama o service', async () => {
        usuariosService.definirBloqueio.mockResolvedValue({ id: 5, ativo: false, alterado: true });
        const res = await call('patch', '/usuarios/5/bloqueio', { bloqueado: true, motivo: 'Desligada' });

        expect(res.status).toBe(200);
        expect(usuariosService.definirBloqueio).toHaveBeenCalledWith(5, { bloqueado: true, motivo: 'Desligada' }, expect.objectContaining({ id: 10 }));
    });

    test('GET lista e eventos paginam com limite máximo', async () => {
        usuariosService.listar.mockResolvedValue([]);
        usuariosService.listarEventos.mockResolvedValue({ items: [] });

        expect((await call('get', '/usuarios')).status).toBe(200);
        await call('get', '/usuarios/eventos?pageSize=9999&page=0');
        expect(usuariosService.listarEventos).toHaveBeenCalledWith({ page: 1, pageSize: 100 }, 7);
    });
});

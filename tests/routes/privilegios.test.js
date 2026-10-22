jest.mock('../../src/services/privilegiosService');

const request = require('supertest');
const express = require('express');
const privilegiosService = require('../../src/services/privilegiosService');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const token = (id = 1, empresa_id = 7) => makeToken({ id, role: 'admin', empresa_id, tv: 0 });
const estado = (extra = {}) => ({ ativo: true, token_version: 0, empresa_status: 'ativa', ...extra });
const comoGerente = (capacidades) => estado({
    papel: 'gerente', cargo_configurado: true, cargo_nivel: 70, cargo_ativo: true, cargo_capacidades: capacidades
});
const valido = { senha: 'minha-senha', motivo: 'Cobertura de férias' };

beforeEach(() => {
    jest.clearAllMocks();
    sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'admin' }));
});

const post = (url, corpo = valido, t = token()) => request(app).post(url).set('Authorization', `Bearer ${t}`).send(corpo);
const get = (url, t = token()) => request(app).get(url).set('Authorization', `Bearer ${t}`);

const rotas = [
    ['get', '/privilegios/administradores'],
    ['get', '/privilegios/usuarios'],
    ['get', '/privilegios/historico'],
    ['post', '/privilegios/usuarios/5/administrador'],
    ['post', '/privilegios/usuarios/5/administrador/revogar'],
    ['post', '/privilegios/cargos/gerente/administrador'],
    ['post', '/privilegios/cargos/gerente/administrador/revogar']
];

describe('/privilegios — autorização', () => {
    test.each(rotas)('%s %s: 401 sem token', async (metodo, url) => {
        expect((await request(app)[metodo](url)).status).toBe(401);
    });

    test.each(rotas)('%s %s: 403 para Vendedor, Estoquista e Gerente sem `conceder_admin`', async (metodo, url) => {
        for (const sessao of [estado({ papel: 'vendedor' }), estado({ papel: 'estoquista' }), comoGerente(['gerir_cargos', 'ver_custos'])]) {
            sessaoRepository.buscarEstado.mockResolvedValue(sessao);

            const res = await request(app)[metodo](url).set('Authorization', `Bearer ${token()}`).send(valido);

            expect(res.status).toBe(403);
        }

        Object.values(privilegiosService).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    test('Gerente COM `conceder_admin` acessa (delegação)', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(comoGerente(['conceder_admin']));
        privilegiosService.listarAdministradores.mockResolvedValue([]);

        expect((await get('/privilegios/administradores')).status).toBe(200);
    });

    test('o JWT dizendo admin não vale se o banco já rebaixou o usuário', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'vendedor' }));

        expect((await post('/privilegios/usuarios/5/administrador')).status).toBe(403);
    });
});

describe('conceder / revogar — ator vem do token, corpo só leva senha e motivo', () => {
    test('conceder a usuário: serviço recebe o ator do token e o alvo da URL', async () => {
        privilegiosService.concederAUsuario.mockResolvedValue({ usuario_id: 5, administrador_concedido: true });

        const res = await post('/privilegios/usuarios/5/administrador', valido, token(1, 7));

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { usuario_id: 5, administrador_concedido: true } });
        expect(privilegiosService.concederAUsuario).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1, empresa_id: 7, role: 'admin' }), 5, valido
        );
    });

    test('revogar de usuário, conceder a cargo e revogar de cargo chegam aos serviços certos', async () => {
        privilegiosService.revogarDeUsuario.mockResolvedValue({ ok: 1 });
        privilegiosService.concederACargo.mockResolvedValue({ ok: 2 });
        privilegiosService.revogarDeCargo.mockResolvedValue({ ok: 3 });

        await post('/privilegios/usuarios/5/administrador/revogar');
        await post('/privilegios/cargos/gerente/administrador');
        await post('/privilegios/cargos/coordenador/administrador/revogar');

        expect(privilegiosService.revogarDeUsuario).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 5, valido);
        expect(privilegiosService.concederACargo).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'gerente', valido);
        expect(privilegiosService.revogarDeCargo).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'coordenador', valido);
    });

    test.each([
        ['sem senha', { motivo: 'Cobertura de férias' }],
        ['senha vazia', { senha: '', motivo: 'Cobertura de férias' }],
        ['senha não texto', { senha: 123456, motivo: 'Cobertura de férias' }],
        ['sem motivo', { senha: 'x' }],
        ['motivo curto', { senha: 'x', motivo: 'ok' }],
        ['motivo só espaços', { senha: 'x', motivo: '      ' }],
        ['motivo enorme', { senha: 'x', motivo: 'a'.repeat(501) }],
        ['empresa_id no corpo', { ...valido, empresa_id: 999 }],
        ['executado_por no corpo', { ...valido, executado_por: 3 }],
        ['corpo vazio', {}]
    ])('400: %s', async (_nome, corpo) => {
        const res = await post('/privilegios/usuarios/5/administrador', corpo);

        expect(res.status).toBe(400);
        expect(privilegiosService.concederAUsuario).not.toHaveBeenCalled();
    });

    test.each([
        ['/privilegios/usuarios/abc/administrador'],
        ['/privilegios/usuarios/0/administrador'],
        ['/privilegios/usuarios/-3/administrador'],
        ['/privilegios/usuarios/1.5/administrador'],
        ['/privilegios/cargos/presidente/administrador']
    ])('400: alvo inválido %s', async (url) => {
        expect((await post(url)).status).toBe(400);
        Object.values(privilegiosService).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    test('erros do serviço chegam como o serviço devolveu (403 senha, 404 alvo, 409 último Admin)', async () => {
        privilegiosService.concederAUsuario.mockRejectedValueOnce(new AppError('Senha de confirmação inválida', 403));
        privilegiosService.revogarDeUsuario.mockRejectedValueOnce(new AppError('Usuário não encontrado', 404));
        privilegiosService.revogarDeCargo.mockRejectedValueOnce(new AppError('O comércio precisa manter ao menos um Admin ativo', 409));

        expect((await post('/privilegios/usuarios/5/administrador')).status).toBe(403);
        expect((await post('/privilegios/usuarios/5/administrador/revogar')).status).toBe(404);

        const ultimo = await post('/privilegios/cargos/coordenador/administrador/revogar');
        expect(ultimo.status).toBe(409);
        expect(ultimo.body.message).toBe('O comércio precisa manter ao menos um Admin ativo');
    });

    test('a resposta nunca devolve a senha enviada', async () => {
        privilegiosService.concederAUsuario.mockRejectedValueOnce(new AppError('Senha de confirmação inválida', 403));

        const res = await post('/privilegios/usuarios/5/administrador', { senha: 'senha-super-secreta', motivo: 'Cobertura de férias' });

        expect(JSON.stringify(res.body)).not.toContain('senha-super-secreta');
    });
});

describe('listagens', () => {
    test('administradores e usuários usam a empresa do TOKEN, ignorando query', async () => {
        privilegiosService.listarAdministradores.mockResolvedValue([{ id: 1 }]);
        privilegiosService.listarUsuarios.mockResolvedValue([{ id: 2 }]);

        const a = await get('/privilegios/administradores?empresa_id=999', token(1, 7));
        const u = await get('/privilegios/usuarios?empresa_id=999', token(1, 7));

        expect(a.body.data).toEqual([{ id: 1 }]);
        expect(u.body.data).toEqual([{ id: 2 }]);
        expect(privilegiosService.listarAdministradores).toHaveBeenCalledWith(7);
        expect(privilegiosService.listarUsuarios).toHaveBeenCalledWith(7);
    });

    test('histórico: padrões de paginação e filtros validados', async () => {
        privilegiosService.historico.mockResolvedValue({ items: [] });

        await get('/privilegios/historico', token(1, 7));
        expect(privilegiosService.historico).toHaveBeenCalledWith(7, { page: 1, pageSize: 20 });

        await get('/privilegios/historico?page=2&pageSize=50&escopo=cargo&alvo_cargo=gerente&alvo_usuario_id=4', token(1, 7));
        expect(privilegiosService.historico).toHaveBeenLastCalledWith(7, { page: 2, pageSize: 50, escopo: 'cargo', alvo_cargo: 'gerente', alvo_usuario_id: 4 });
    });

    test.each(['page=0', 'pageSize=101', 'pageSize=0', 'escopo=tudo', 'alvo_cargo=presidente', 'alvo_usuario_id=abc'])(
        'histórico recusa %s com 400', async (query) => {
            expect((await get(`/privilegios/historico?${query}`)).status).toBe(400);
            expect(privilegiosService.historico).not.toHaveBeenCalled();
        }
    );
});

describe('limitador de tentativas de senha', () => {
    test('conta por usuário e bloqueia após 5 falhas; não conta sucessos; não afeta outro usuário', async () => {
        const rateLimit = require('express-rate-limit');
        const mini = express();
        mini.use(express.json());

        const limiter = rateLimit({
            windowMs: 60000, limit: 5, skipSuccessfulRequests: true, standardHeaders: false, legacyHeaders: false,
            keyGenerator: (req) => `confirmacao-senha|${req.usuario ? `${req.usuario.empresa_id}:${req.usuario.id}` : 'anonimo'}`,
            handler: (req, res) => res.status(429).json({ success: false })
        });
        mini.post('/x', (req, res, next) => { req.usuario = { id: Number(req.headers['x-user']), empresa_id: 7 }; next(); }, limiter,
            (req, res) => res.status(req.body.ok ? 200 : 403).json({}));

        for (let i = 0; i < 5; i += 1) {
            await request(mini).post('/x').set('x-user', '1').send({ ok: true });
        }
        expect((await request(mini).post('/x').set('x-user', '1').send({ ok: false })).status).toBe(403);

        for (let i = 0; i < 4; i += 1) {
            await request(mini).post('/x').set('x-user', '1').send({ ok: false });
        }

        expect((await request(mini).post('/x').set('x-user', '1').send({ ok: true })).status).toBe(429);
        expect((await request(mini).post('/x').set('x-user', '2').send({ ok: true })).status).toBe(200);
    });

    test('o limitador real está montado em TODAS as quatro rotas de senha', () => {
        const router = require('../../src/routes/privilegios');
        const limiter = require('../../src/middlewares/confirmacaoSenhaRateLimiter');
        const rotasPost = router.stack.filter((camada) => camada.route && camada.route.methods.post);

        expect(rotasPost).toHaveLength(4);
        rotasPost.forEach((camada) => expect(camada.route.stack.some((s) => s.handle === limiter)).toBe(true));
    });
});

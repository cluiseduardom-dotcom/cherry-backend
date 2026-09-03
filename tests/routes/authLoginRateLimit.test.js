const request = require('supertest');

describe('POST /auth/login - rate limiting (config de produção)', () => {

    const originalNodeEnv = process.env.NODE_ENV;
    let app;
    let authService;
    let AppError;

    beforeEach(() => {

        jest.resetModules();
        process.env.NODE_ENV = 'production';
        jest.doMock('../../src/services/authService');

        authService = require('../../src/services/authService');
        AppError = require('../../src/errors/AppError');
        app = require('../../src/app');

    });

    afterEach(() => {

        process.env.NODE_ENV = originalNodeEnv;
        jest.resetModules();

    });

    test('login legítimo dentro do limite continua funcionando normalmente', async () => {

        authService.login.mockResolvedValue({ token: 'tok', usuario: { id: 1, papel: 'admin' } });

        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'a@x.com', senha: 'senha123' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: { token: 'tok', usuario: { id: 1, papel: 'admin' } }
        });

    });

    test('bloqueia a 6ª tentativa de login em 15 minutos com 429 no formato padrão de erro', async () => {

        authService.login.mockRejectedValue(new AppError('Email ou senha inválidos', 401));

        for (let i = 0; i < 5; i++) {
            const res = await request(app)
                .post('/auth/login')
                .send({ email: 'a@x.com', senha: 'errada' });
            expect(res.status).toBe(401);
        }

        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'a@x.com', senha: 'errada' });

        expect(res.status).toBe(429);
        expect(res.body).toEqual({
            success: false,
            message: expect.any(String)
        });

    });

});

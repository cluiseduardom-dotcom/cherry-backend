const express = require('express');
const request = require('supertest');
const { criarLoginRateLimiter, criarLimiterPorIp } = require('../../src/middlewares/loginRateLimiter');

// O handler responde 401 para senha 'errada' e 200 para qualquer outra: só
// falhas contam no limiter (skipSuccessfulRequests).
function buildApp(limiter, { trustProxy = false } = {}) {

    const app = express();
    if (trustProxy) app.set('trust proxy', 1);
    app.use(express.json());
    app.post('/auth/login', limiter, (req, res) => {
        const falhou = req.body.senha === 'errada';
        res.status(falhou ? 401 : 200).json({ success: !falhou, data: {} });
    });

    return app;

}

const tentar = (app, email, senha = 'errada', ip) => {
    const req = request(app).post('/auth/login');
    if (ip) req.set('X-Forwarded-For', ip);
    return req.send({ email, senha });
};

describe('loginRateLimiter', () => {

    test('permite tentativas dentro do limite', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 }));

        for (let i = 0; i < 5; i++) {
            const res = await tentar(app, 'a@x.com');
            expect(res.status).toBe(401);
        }

    });

    test('bloqueia a 6ª tentativa em 15 minutos com 429 no formato padrão de erro', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 }));

        for (let i = 0; i < 5; i++) {
            await tentar(app, 'a@x.com');
        }

        const res = await tentar(app, 'a@x.com');

        expect(res.status).toBe(429);
        expect(res.body).toEqual({
            success: false,
            message: expect.any(String)
        });

    });

    test('errar a senha de um e-mail NÃO bloqueia outro e-mail (sem bloqueio global)', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 2 }));

        await tentar(app, 'vitima@x.com');
        await tentar(app, 'vitima@x.com');
        expect((await tentar(app, 'vitima@x.com')).status).toBe(429);

        expect((await tentar(app, 'outro@x.com')).status).toBe(401);

    });

    test('e-mails com caixa/espaços diferentes caem no mesmo balde (não dá para burlar variando o texto)', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 2 }));

        await tentar(app, 'Vitima@X.com');
        await tentar(app, ' vitima@x.com ');

        expect((await tentar(app, 'VITIMA@x.com')).status).toBe(429);

    });

    test('logins bem-sucedidos não consomem a cota', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 2 }));

        for (let i = 0; i < 6; i++) {
            expect((await tentar(app, 'a@x.com', 'certa')).status).toBe(200);
        }

    });

    test('com trust proxy, IPs diferentes (X-Forwarded-For) têm baldes separados para o mesmo e-mail', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 1 }), { trustProxy: true });

        await tentar(app, 'a@x.com', 'errada', '203.0.113.10');
        expect((await tentar(app, 'a@x.com', 'errada', '203.0.113.10')).status).toBe(429);

        expect((await tentar(app, 'a@x.com', 'errada', '203.0.113.11')).status).toBe(401);

    });

    test('teto por IP bloqueia rotação de e-mails de um mesmo IP, mas não outro IP', async () => {

        const app = buildApp(criarLimiterPorIp({ windowMs: 15 * 60 * 1000, limit: 2 }), { trustProxy: true });

        await tentar(app, 'a@x.com', 'errada', '203.0.113.10');
        await tentar(app, 'b@x.com', 'errada', '203.0.113.10');
        expect((await tentar(app, 'c@x.com', 'errada', '203.0.113.10')).status).toBe(429);

        expect((await tentar(app, 'c@x.com', 'errada', '198.51.100.7')).status).toBe(401);

    });


});

const express = require('express');
const request = require('supertest');
const { criarLoginRateLimiter } = require('../../src/middlewares/loginRateLimiter');

function buildApp(limiter) {

    const app = express();
    app.use(express.json());
    app.post('/auth/login', limiter, (req, res) => {
        res.status(200).json({ success: true, data: {} });
    });

    return app;

}

describe('loginRateLimiter', () => {

    test('permite tentativas dentro do limite', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 }));

        for (let i = 0; i < 5; i++) {
            const res = await request(app).post('/auth/login').send({});
            expect(res.status).toBe(200);
        }

    });

    test('bloqueia a 6ª tentativa em 15 minutos com 429 no formato padrão de erro', async () => {

        const app = buildApp(criarLoginRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5 }));

        for (let i = 0; i < 5; i++) {
            await request(app).post('/auth/login').send({});
        }

        const res = await request(app).post('/auth/login').send({});

        expect(res.status).toBe(429);
        expect(res.body).toEqual({
            success: false,
            message: expect.any(String)
        });

    });

});

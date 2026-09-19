jest.mock('../../src/services/onboardingService');

const request = require('supertest');
const onboardingService = require('../../src/services/onboardingService');
const AppError = require('../../src/errors/AppError');
const app = require('../../src/app');

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /onboarding', () => {
    const validBody = {
        empresa_nome: 'Cherry Nova',
        cnpj: '12345678000199',
        nome_admin: 'Eduardo',
        email_admin: 'eduardo@nova.com',
        senha_admin: 'senha123'
    };

    test('returns 400 for an invalid body', async () => {
        const res = await request(app)
            .post('/onboarding')
            .send({ ...validBody, email_admin: 'email-invalido' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(onboardingService.criarTenant).not.toHaveBeenCalled();
    });

    test('returns 201 with tenant, admin user and token', async () => {
        onboardingService.criarTenant.mockResolvedValue({
            token: 'tok',
            empresa: { id: 9, nome: 'Cherry Nova', cnpj: '12345678000199', status: 'ativa' },
            usuario: { id: 12, nome: 'Eduardo', email: 'eduardo@nova.com', papel: 'admin', empresa_id: 9 }
        });

        const res = await request(app)
            .post('/onboarding')
            .send(validBody);

        expect(res.status).toBe(201);
        expect(res.body.data.empresa.id).toBe(9);
        expect(res.body.data.usuario.papel).toBe('admin');
        expect(res.body.data.token).toBe('tok');
        expect(onboardingService.criarTenant).toHaveBeenCalledWith({
            empresa_nome: 'Cherry Nova',
            cnpj: '12345678000199',
            nome_admin: 'Eduardo',
            email_admin: 'eduardo@nova.com',
            senha_admin: 'senha123'
        });
    });

    test('returns 409 when admin email already exists', async () => {
        onboardingService.criarTenant.mockRejectedValue(
            new AppError('Email do administrador já cadastrado', 409)
        );

        const res = await request(app)
            .post('/onboarding')
            .send(validBody);

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Email do administrador já cadastrado');
    });
});

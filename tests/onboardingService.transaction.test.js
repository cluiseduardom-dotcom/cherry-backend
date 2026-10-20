'use strict';

jest.mock('../src/config/db', () => ({
    connect: jest.fn(),
}));

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('hash-da-senha'),
}));

jest.mock('../src/services/tokenService', () => ({
    emitirToken: jest.fn().mockReturnValue('token-de-teste'),
}));

const db = require('../src/config/db');
const bcrypt = require('bcrypt');
const tokenService = require('../src/services/tokenService');
const { criarTenant } = require('../src/services/onboardingService');

describe('onboardingService.criarTenant transaction', () => {
    let client;

    beforeEach(() => {
        jest.clearAllMocks();
        client = {
            query: jest.fn(),
            release: jest.fn(),
        };
        db.connect.mockResolvedValue(client);
        client.query.mockImplementation(async (sql) => {
            if (sql.includes('INSERT INTO empresas')) {
                return { rows: [{ id: 77, nome: 'Empresa de teste', cnpj: null, status: 'ativa' }] };
            }
            if (sql.includes('INSERT INTO usuarios')) {
                return { rows: [{ id: 88, nome: 'Admin teste', email: 'admin@teste.invalid', papel: 'admin', empresa_id: 77 }] };
            }
            return { rows: [] };
        });
    });

    test('commits only after defaults and admin are created', async () => {
        const result = await criarTenant({
            empresa_nome: 'Empresa de teste',
            nome_admin: 'Admin teste',
            email_admin: 'admin@teste.invalid',
            senha_admin: 'senha-de-teste',
        });

        const statements = client.query.mock.calls.map(([sql]) => sql.trim());
        expect(statements[0]).toBe('BEGIN');
        expect(statements).toContain('COMMIT');
        expect(statements).not.toContain('ROLLBACK');
        expect(statements.indexOf('COMMIT')).toBe(statements.length - 1);
        expect(bcrypt.hash).toHaveBeenCalledWith('senha-de-teste', 10);
        expect(tokenService.emitirToken).toHaveBeenCalled();
        expect(result).toMatchObject({
            token: 'token-de-teste',
            empresa: { id: 77 },
            usuario: { id: 88, empresa_id: 77 },
        });
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('rolls back and releases connection if creating defaults fails', async () => {
        client.query.mockImplementation(async (sql) => {
            if (sql === 'BEGIN') return { rows: [] };
            if (sql.includes('INSERT INTO empresas')) {
                return { rows: [{ id: 77, nome: 'Empresa de teste', cnpj: null, status: 'ativa' }] };
            }
            if (sql.includes('INSERT INTO canais_venda')) {
                throw new Error('falha simulada ao criar canais');
            }
            return { rows: [] };
        });

        await expect(criarTenant({
            empresa_nome: 'Empresa de teste',
            nome_admin: 'Admin teste',
            email_admin: 'admin@teste.invalid',
            senha_admin: 'senha-de-teste',
        })).rejects.toThrow('falha simulada ao criar canais');

        const statements = client.query.mock.calls.map(([sql]) => sql.trim());
        expect(statements).toContain('BEGIN');
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
        expect(bcrypt.hash).not.toHaveBeenCalled();
        expect(tokenService.emitirToken).not.toHaveBeenCalled();
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('rolls back and maps duplicate admin email to HTTP conflict', async () => {
        const duplicate = Object.assign(new Error('duplicate'), {
            code: '23505',
            constraint: 'usuarios_email_key',
        });
        client.query.mockImplementation(async (sql) => {
            if (sql.includes('INSERT INTO empresas')) {
                return { rows: [{ id: 77, nome: 'Empresa de teste', cnpj: null, status: 'ativa' }] };
            }
            if (sql.includes('INSERT INTO usuarios')) throw duplicate;
            return { rows: [] };
        });

        await expect(criarTenant({
            empresa_nome: 'Empresa de teste',
            nome_admin: 'Admin teste',
            email_admin: 'admin@teste.invalid',
            senha_admin: 'senha-de-teste',
        })).rejects.toMatchObject({ statusCode: 409 });

        const statements = client.query.mock.calls.map(([sql]) => sql.trim());
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});

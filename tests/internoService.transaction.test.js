'use strict';

jest.mock('../src/config/db', () => ({ connect: jest.fn(), query: jest.fn() }));

const db = require('../src/config/db');
const { definirModulo, definirTema } = require('../src/services/internoService');

const dados = { empresa_id: 7, modulo: 'grade', ativo: true, justificativa: 'Contrato', responsavel: 'Eduardo' };

describe('internoService.definirModulo', () => {
    let client;

    beforeEach(() => {
        jest.clearAllMocks();
        client = { query: jest.fn(), release: jest.fn() };
        db.connect.mockResolvedValue(client);
        client.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM empresas')) return { rows: [{ '?column?': 1 }] };
            if (sql.includes('INSERT INTO empresa_modulos ')) return { rows: [{ empresa_id: 7, modulo: 'grade', ativo: true }] };
            return { rows: [] };
        });
    });

    test('grava estado e histórico na mesma transação, e só então confirma', async () => {
        const resultado = await definirModulo(dados);

        const sqls = client.query.mock.calls.map(([sql]) => sql.trim());

        expect(sqls[0]).toBe('BEGIN');
        expect(sqls.some((s) => s.startsWith('INSERT INTO empresa_modulos ('))).toBe(true);
        expect(sqls.some((s) => s.startsWith('INSERT INTO empresa_modulos_historico'))).toBe(true);
        expect(sqls[sqls.length - 1]).toBe('COMMIT');
        expect(sqls).not.toContain('ROLLBACK');
        expect(resultado).toEqual({ empresa_id: 7, modulo: 'grade', ativo: true });
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('empresa inexistente: 404 e nada é gravado', async () => {
        client.query.mockImplementation(async (sql) => (sql.includes('FROM empresas') ? { rows: [] } : { rows: [] }));

        await expect(definirModulo(dados)).rejects.toMatchObject({ statusCode: 404 });

        const sqls = client.query.mock.calls.map(([sql]) => sql.trim());

        expect(sqls).toContain('ROLLBACK');
        expect(sqls.some((s) => s.startsWith('INSERT'))).toBe(false);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('falha ao gravar o histórico desfaz também o estado do módulo', async () => {
        client.query.mockImplementation(async (sql) => {
            if (sql.includes('FROM empresas')) return { rows: [{ '?column?': 1 }] };
            if (sql.includes('INSERT INTO empresa_modulos ')) return { rows: [{ empresa_id: 7, modulo: 'grade', ativo: true }] };
            if (sql.includes('empresa_modulos_historico')) throw new Error('falha simulada');
            return { rows: [] };
        });

        await expect(definirModulo(dados)).rejects.toThrow('falha simulada');

        const sqls = client.query.mock.calls.map(([sql]) => sql.trim());

        expect(sqls).toContain('ROLLBACK');
        expect(sqls).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});

describe('internoService.definirTema', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'info').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    test('empresa inexistente: 404', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await expect(definirTema({ empresa_id: 9, tema: 'cherry', responsavel: 'E', justificativa: 'x y z' }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    test('atualiza apenas a empresa alvo, com o tema parametrizado', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 9, nome: 'X', tema_visual: 'cherry' }] });

        const r = await definirTema({ empresa_id: 9, tema: 'cherry', responsavel: 'Eduardo', justificativa: 'cliente' });

        expect(r.tema_visual).toBe('cherry');
        expect(db.query.mock.calls[0][0]).toMatch(/WHERE id = \$1/);
        expect(db.query.mock.calls[0][1]).toEqual([9, 'cherry']);
    });
});

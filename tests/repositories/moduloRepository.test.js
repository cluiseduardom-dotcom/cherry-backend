jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const db = require('../../src/config/db');
const moduloRepository = require('../../src/repositories/moduloRepository');

beforeEach(() => jest.clearAllMocks());

describe('moduloRepository', () => {
    test('listarAtivos filtra por empresa_id na própria query e devolve só os códigos', async () => {
        db.query.mockResolvedValue({ rows: [{ modulo: 'fiscal' }, { modulo: 'grade' }] });

        const resultado = await moduloRepository.listarAtivos(7);

        expect(resultado).toEqual(['fiscal', 'grade']);
        expect(db.query.mock.calls[0][0]).toMatch(/WHERE empresa_id = \$1 AND ativo = true/);
        expect(db.query.mock.calls[0][1]).toEqual([7]);
    });

    test('estaAtivo filtra por empresa e módulo', async () => {
        db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

        expect(await moduloRepository.estaAtivo(7, 'grade')).toBe(true);
        expect(db.query.mock.calls[0][0]).toMatch(/empresa_id = \$1 AND modulo = \$2 AND ativo = true/);
        expect(db.query.mock.calls[0][1]).toEqual([7, 'grade']);
    });

    test('estaAtivo é false sem linha', async () => {
        db.query.mockResolvedValue({ rows: [] });

        expect(await moduloRepository.estaAtivo(7, 'grade')).toBe(false);
    });
});

describe('adaptador de banco em teste unitário', () => {
    test('recusa consulta real antes de abrir conexão', () => {
        jest.isolateModules(() => {
            jest.doMock('pg', () => ({ Pool: jest.fn(() => ({})) }));
            const db = require('../../src/config/db');

            expect(() => db.query('SELECT 1')).toThrow(/testes unitários/i);
            expect(() => db.connect()).toThrow(/testes unitários/i);
        });
    });
});

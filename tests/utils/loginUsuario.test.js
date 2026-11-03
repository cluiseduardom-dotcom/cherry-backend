const { gerarLoginBase, normalizarLogin, loginValido, proximoLoginLivre } = require('../../src/utils/loginUsuario');

describe('gerarLoginBase', () => {
    test.each([
        ['Luís Eduardo Martins Cardoso', 'LEMCAR'],
        ['Emilly Graziela Alves da Silva', 'EGASIL'],
        ['Luís Eduardo Cardoso', 'LECAR'],
        ['Ana dos Santos', 'ASAN'],
        ['  joão   de   Souza ', 'JSOU'],
        ['Maria José da Conceição', 'MJCON'],
        ['Cher', 'CHER'],
        ['Valvazori Admin', 'VADM'],
        ['Zé Sá', 'ZSA'],
        ['', 'USUARIO'],
        ['X', 'XX']
    ])('%s → %s', (nome, esperado) => {
        expect(gerarLoginBase(nome)).toBe(esperado);
    });

    test('nunca passa de 20 caracteres', () => {
        expect(gerarLoginBase('A B C D E F G H I J K L M N O P Q R S T U V Silva').length).toBeLessThanOrEqual(20);
    });
});

describe('normalizarLogin / loginValido', () => {
    test('maiúsculo, sem acento e sem símbolos', () => {
        expect(normalizarLogin(' egasil ')).toBe('EGASIL');
        expect(normalizarLogin('lécar-2')).toBe('LECAR2');
    });

    test.each([['EGASIL', true], ['E', false], ['egasil', false], ['EGA SIL', false], ['A'.repeat(21), false], ['AB12', true]])('%s válido? %s', (login, ok) => {
        expect(loginValido(login)).toBe(ok);
    });
});

describe('proximoLoginLivre', () => {
    test('repetido ganha número no fim', () => {
        expect(proximoLoginLivre('EGASIL', new Set())).toBe('EGASIL');
        expect(proximoLoginLivre('EGASIL', new Set(['EGASIL']))).toBe('EGASIL2');
        expect(proximoLoginLivre('EGASIL', new Set(['EGASIL', 'EGASIL2']))).toBe('EGASIL3');
    });

    test('mantém 20 caracteres com o sufixo', () => {
        const base = 'A'.repeat(20);
        expect(proximoLoginLivre(base, new Set([base]))).toBe(`${'A'.repeat(19)}2`);
    });
});

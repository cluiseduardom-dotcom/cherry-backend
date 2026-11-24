const { classificarIdentificador, normalizarIdentificador, luhnValido } = require('../../src/utils/identificadorUnidade');
const { prepararIdentificadores } = require('../../src/repositories/unidadesRastreadasRepository');

const IMEI_OK = '490154203237518'; // exemplo clássico com Luhn válido
const IMEI_OK_2 = '356938035643809';

describe('identificadorUnidade', () => {
    test('luhn confere o dígito verificador', () => {
        expect(luhnValido(IMEI_OK)).toBe(true);
        expect(luhnValido(IMEI_OK_2)).toBe(true);
        expect(luhnValido('490154203237519')).toBe(false);
    });

    test('IMEI válido, com espaço/hífen vindo do leitor, vira imei normalizado', () => {
        expect(classificarIdentificador(' 49-0154 2032 37518 ')).toEqual({ identificador: IMEI_OK, tipo: 'imei' });
    });

    test('só dígitos com tamanho errado ou Luhn inválido é recusado (não vira série em silêncio)', () => {
        expect(() => classificarIdentificador('12345678901234')).toThrow(/15 dígitos/);
        expect(() => classificarIdentificador('1234567890123456')).toThrow(/15 dígitos/);
        expect(() => classificarIdentificador('490154203237519')).toThrow(/dígito verificador/);
    });

    test('série alfanumérica é aceita em maiúsculo; curta ou com símbolo é recusada', () => {
        expect(classificarIdentificador('f2lxk3abc9')).toEqual({ identificador: 'F2LXK3ABC9', tipo: 'serie' });
        expect(() => classificarIdentificador('AB12')).toThrow(/inválido/);
        expect(() => classificarIdentificador('AB12#34')).toThrow(/inválido/);
        expect(() => classificarIdentificador('   ')).toThrow(/vazio/);
    });

    test('normalizarIdentificador tolera null', () => {
        expect(normalizarIdentificador(null)).toBe('');
    });
});

describe('prepararIdentificadores', () => {
    test('exige uma lista com a mesma quantidade, sem repetição', () => {
        expect(() => prepararIdentificadores(undefined, 1)).toThrow(/informe um identificador/);
        expect(() => prepararIdentificadores([IMEI_OK], 2)).toThrow(/diferente/);
        expect(() => prepararIdentificadores([IMEI_OK, '49 0154 2032 37518'], 2)).toThrow(/repetido/);
        expect(() => prepararIdentificadores(new Array(501).fill('ABCDE12345'), 501)).toThrow(/No máximo/);
    });

    test('devolve identificador e tipo; erro de formato vira 400', () => {
        expect(prepararIdentificadores([IMEI_OK, 'SERIE12345'], 2)).toEqual([
            { identificador: IMEI_OK, tipo: 'imei' },
            { identificador: 'SERIE12345', tipo: 'serie' }
        ]);

        try {
            prepararIdentificadores(['123'], 1);
            throw new Error('deveria falhar');
        } catch (erro) {
            expect(erro.statusCode ?? erro.status).toBe(400);
        }
    });
});

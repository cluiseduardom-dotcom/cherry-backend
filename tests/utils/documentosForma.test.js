const { documentoFormaValida, documentoComLetrasMaiusculas } = require('../../src/utils/documentos');

describe('documentoFormaValida (CPF ou CNPJ, numérico ou alfanumérico; só o formato)', () => {
    test.each(['123.456.789-01', '12345678901', '12.345.678/0001-90', '12345678000190', '12ABC34501DE35', '12.abc.345/01de-35', ' 12 ABC 34501DE35 '])('aceita %s', (v) => {
        expect(documentoFormaValida(v)).toBe(true);
    });

    test.each(['', '123', '1234567890', '123456789012', '12ABC34501DE3A', '12ABC34501DE3', '12ABC34501DE355', 'ABCDEFGHIJKLMN', '12@ABC34501DE35', null, undefined])('recusa %s', (v) => {
        expect(documentoFormaValida(v)).toBe(false);
    });
});

describe('documentoComLetrasMaiusculas', () => {
    test('só sobe as letras; pontuação e números ficam, e não-texto passa direto', () => {
        expect(documentoComLetrasMaiusculas('12.abc.345/01de-35')).toBe('12.ABC.345/01DE-35');
        expect(documentoComLetrasMaiusculas('12.345.678/0001-90')).toBe('12.345.678/0001-90');
        expect(documentoComLetrasMaiusculas(undefined)).toBeUndefined();
    });
});

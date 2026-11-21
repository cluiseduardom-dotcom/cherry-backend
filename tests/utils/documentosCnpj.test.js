const { cnpjValido, normalizarCnpj } = require('../../src/utils/documentos');

describe('normalizarCnpj', () => {
    test('tira pontuação e espaços e põe em maiúsculas; preserva letras (CNPJ alfanumérico)', () => {
        expect(normalizarCnpj('11.222.333/0001-81')).toBe('11222333000181');
        expect(normalizarCnpj(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35');
        expect(normalizarCnpj('')).toBe('');
    });
});

describe('cnpjValido', () => {
    test('CNPJ numérico (formato de sempre) continua valendo', () => {
        expect(cnpjValido('11222333000181')).toBe(true);
        expect(cnpjValido('11222333000182')).toBe(false);
    });

    test('CNPJ alfanumérico (Receita, a partir de julho de 2026): exemplo oficial 12.ABC.345/01DE-35', () => {
        expect(cnpjValido('12ABC34501DE35')).toBe(true);
    });

    test('alfanumérico com dígito verificador errado ou trocado de letra é recusado', () => {
        expect(cnpjValido('12ABC34501DE36')).toBe(false);
        expect(cnpjValido('12ABC34501DF35')).toBe(false);
        expect(cnpjValido('13ABC34501DE35')).toBe(false);
    });

    test('os dois últimos caracteres são sempre dígitos; letras minúsculas só passam normalizadas', () => {
        expect(cnpjValido('12ABC34501DEA5')).toBe(false);
        expect(cnpjValido('12abc34501de35')).toBe(false); // quem chama normaliza (normalizarCnpj)
        expect(cnpjValido(normalizarCnpj('12.abc.345/01de-35'))).toBe(true);
    });

    test('tamanho errado, sequência repetida, símbolo e tipo errado são recusados', () => {
        for (const ruim of ['', '1234567890123', '123456789012345', '00000000000000', 'AAAAAAAAAAAA00', '12ABC34501DE-5', 12345678000195, null, undefined]) {
            expect(cnpjValido(ruim)).toBe(false);
        }
    });
});

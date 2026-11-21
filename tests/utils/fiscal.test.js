const {
    CODIGO_IBGE_DA_UF,
    ncmValido,
    cestValido,
    origemValida,
    unidadeFiscalValida,
    inscricaoEstadualValida,
    cnaeValido,
    municipioCombinaComUf
} = require('../../src/utils/fiscal');
const { UFS } = require('../../src/utils/documentos');

describe('ncmValido (só a estrutura)', () => {
    test('8 dígitos e capítulo de 01 a 97, exceto 77', () => {
        for (const ok of ['71171900', '01012100', '97050000', '62034200']) expect(ncmValido(ok)).toBe(true);
        for (const ruim of ['00000000', '77010000', '98010000', '99999999', '7117190', '711719000', '7117.19.00', 'abcdefgh', '', 71171900, null]) {
            expect(ncmValido(ruim)).toBe(false);
        }
    });
});

describe('demais campos', () => {
    test('CEST: 7 dígitos', () => {
        expect(cestValido('2800300')).toBe(true);
        for (const ruim of ['280030', '28003000', '28.003.00', 2800300, null]) expect(cestValido(ruim)).toBe(false);
    });

    test('origem: inteiro de 0 a 8', () => {
        for (const ok of [0, 1, 5, 8]) expect(origemValida(ok)).toBe(true);
        for (const ruim of [-1, 9, 1.5, '1', null, undefined]) expect(origemValida(ruim)).toBe(false);
    });

    test('unidade fiscal: 1 a 6 letras maiúsculas', () => {
        for (const ok of ['UN', 'KG', 'LT', 'CX', 'PCT']) expect(unidadeFiscalValida(ok)).toBe(true);
        for (const ruim of ['un', '', 'UNIDADE1', 'U1', 'ABCDEFG', null]) expect(unidadeFiscalValida(ruim)).toBe(false);
    });

    test('inscrição estadual: dígitos (2 a 14) ou ISENTO', () => {
        for (const ok of ['ISENTO', '123456789', '12', '12345678901234']) expect(inscricaoEstadualValida(ok)).toBe(true);
        for (const ruim of ['1', '123456789012345', 'isento', '123.456.789', '12A456', '', null]) expect(inscricaoEstadualValida(ruim)).toBe(false);
    });

    test('CNAE: 7 dígitos', () => {
        expect(cnaeValido('4781400')).toBe(true);
        for (const ruim of ['478140', '4781-4/00', null]) expect(cnaeValido(ruim)).toBe(false);
    });
});

describe('município × UF', () => {
    test('toda UF do sistema tem prefixo IBGE, e prefixos não se repetem', () => {
        expect(Object.keys(CODIGO_IBGE_DA_UF).sort()).toEqual([...UFS].sort());
        expect(new Set(Object.values(CODIGO_IBGE_DA_UF)).size).toBe(UFS.length);
    });

    test('o código do município precisa começar com o código da UF', () => {
        expect(municipioCombinaComUf('3550308', 'SP')).toBe(true); // São Paulo
        expect(municipioCombinaComUf('3304557', 'rj')).toBe(true); // Rio de Janeiro (aceita minúscula na UF)
        expect(municipioCombinaComUf('3550308', 'RJ')).toBe(false);
        expect(municipioCombinaComUf('355030', 'SP')).toBe(false);
        expect(municipioCombinaComUf('3550308', 'XX')).toBe(false);
        expect(municipioCombinaComUf(null, 'SP')).toBe(false);
    });
});

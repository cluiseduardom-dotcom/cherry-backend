const { obterCicloCobranca, PADRAO } = require('../../src/config/cicloCobrancaConfig');

describe('ciclo de cobrança — parâmetros', () => {
    test('padrão da SPEC: carência de 15 dias e piso de R$ 10,00', () => {
        expect(obterCicloCobranca({})).toMatchObject({ carenciaDias: 15, pisoReais: 10, pisoCentavos: 1000, periodosAbaixoDoPiso: 3, antecedenciaAvisoDias: 5 });
        expect(PADRAO.carenciaDias).toBe(15);
    });

    test('carência e piso configuráveis pelo ambiente (único lugar)', () => {
        expect(obterCicloCobranca({ COBRANCA_CARENCIA_DIAS: '10', COBRANCA_PISO: '25,50' })).toMatchObject({ carenciaDias: 10, pisoReais: 25.5, pisoCentavos: 2550 });
        expect(obterCicloCobranca({ COBRANCA_CARENCIA_DIAS: '0', COBRANCA_PISO: '0' })).toMatchObject({ carenciaDias: 0, pisoCentavos: 0 });
        expect(obterCicloCobranca({ COBRANCA_PISO: '12.3' }).pisoCentavos).toBe(1230);
    });

    test('valor inválido ou fora do limite volta ao padrão, sem derrubar nada', () => {
        for (const v of ['abc', '', '-1', '91', '1.5', '15 dias', undefined]) {
            expect(obterCicloCobranca({ COBRANCA_CARENCIA_DIAS: v }).carenciaDias).toBe(15);
        }
        for (const v of ['abc', '-5', '1001', '10,555', '1e3']) {
            expect(obterCicloCobranca({ COBRANCA_PISO: v }).pisoReais).toBe(10);
        }
    });
});

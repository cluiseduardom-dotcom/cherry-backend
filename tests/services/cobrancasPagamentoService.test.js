const { mapearStatusProvedor, formatarExpiracao, TRANSICOES } = require('../../src/services/cobrancasPagamentoService');

describe('mapearStatusProvedor', () => {
    test.each([
        ['approved', 'pago'], ['pending', 'pendente'], ['in_process', 'pendente'], ['in_mediation', 'pendente'],
        ['authorized', 'pendente'], ['cancelled', 'cancelado'], ['rejected', 'cancelado'],
        ['refunded', 'estornado'], ['charged_back', 'estornado'], ['desconhecido', 'pendente'], [undefined, 'pendente']
    ])('%s -> %s', (entrada, esperado) => {
        expect(mapearStatusProvedor(entrada)).toBe(esperado);
    });
});

describe('formatarExpiracao', () => {
    test('escreve o horário de Brasília com offset -03:00', () => {
        expect(formatarExpiracao(new Date('2026-10-27T18:30:00.000Z'))).toBe('2026-10-27T15:30:00.000-03:00');
        expect(formatarExpiracao(new Date('2026-11-01T01:00:00.000Z'))).toBe('2026-10-31T22:00:00.000-03:00');
    });
});

describe('TRANSICOES', () => {
    test('nada volta para pendente e estados finais não mudam', () => {
        for (const [, destinos] of Object.entries(TRANSICOES)) expect(destinos).not.toContain('pendente');
        expect(TRANSICOES.pago).toEqual(['estornado']);
        expect(TRANSICOES.cancelado).toEqual([]);
        expect(TRANSICOES.estornado).toEqual([]);
        expect(TRANSICOES.falhou).toEqual([]);
    });
});

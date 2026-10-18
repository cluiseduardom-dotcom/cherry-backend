const { TEMAS_VISUAIS, TEMA_VISUAL_PADRAO, resolverTemaVisual } = require('../../src/constants/temasVisuais');

describe('temas visuais', () => {
    test('conjunto fechado: vertumno e cherry, com vertumno como padrão', () => {
        expect(TEMAS_VISUAIS).toEqual(['vertumno', 'cherry']);
        expect(TEMA_VISUAL_PADRAO).toBe('vertumno');
        expect(Object.isFrozen(TEMAS_VISUAIS)).toBe(true);
    });

    test('valores válidos passam; ausente, desconhecido ou de outro tipo caem no padrão', () => {
        expect(resolverTemaVisual('cherry')).toBe('cherry');
        expect(resolverTemaVisual('vertumno')).toBe('vertumno');
        for (const v of [undefined, null, '', ' cherry', 'Cherry', 'x', '__proto__', 'constructor', 1, {}, ['cherry']]) {
            expect(resolverTemaVisual(v)).toBe('vertumno');
        }
    });
});

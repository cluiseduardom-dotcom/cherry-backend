const { resolverCargo, aplicarConcessoes } = require('../../src/services/permissoesService');
const { TODAS_CAPACIDADES } = require('../../src/constants/cargos');

describe('aplicarConcessoes — Admin concedido individualmente', () => {
    const gerente = () => resolverCargo('gerente', { nivel: 70, ativo: true, capacidades: ['ver_custos'] });

    test('sem concessão, devolve as permissões do cargo intactas', () => {
        const base = gerente();

        expect(aplicarConcessoes(base, { administrador_concedido: false })).toBe(base);
        expect(aplicarConcessoes(base)).toBe(base);
        expect(aplicarConcessoes(base, { administrador_concedido: undefined })).toBe(base);
    });

    test('com concessão: perfil admin e todas as capacidades, mantendo cargo e nível', () => {
        const resultado = aplicarConcessoes(gerente(), { administrador_concedido: true });

        expect(resultado).toMatchObject({ role: 'admin', administrador: true, cargo: 'gerente', nivel: 70 });
        expect(resultado.capacidades).toEqual(TODAS_CAPACIDADES);
    });

    test('não altera o objeto original nem o catálogo', () => {
        const base = gerente();

        aplicarConcessoes(base, { administrador_concedido: true }).capacidades.push('x');

        expect(base.role).toBe('vendedor');
        expect(base.capacidades).toEqual(['ver_custos']);
        expect(TODAS_CAPACIDADES).not.toContain('x');
    });

    test('cargo inexistente continua inexistente (fail-closed)', () => {
        expect(aplicarConcessoes(null, { administrador_concedido: true })).toBeNull();
    });
});

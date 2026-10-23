const { onboardingSchema } = require('../../src/validations/onboardingValidation');

const base = {
    empresa_nome: 'Cherry Nova',
    nome_admin: 'Eduardo',
    email_admin: 'eduardo@nova.com',
    senha_admin: 'senha1234'
};

describe('onboardingSchema — origem de aquisição', () => {
    test('aceita o corpo sem origem nem parceiro (campos opcionais) e não os inventa', () => {
        const resultado = onboardingSchema.safeParse(base);

        expect(resultado.success).toBe(true);
        expect(resultado.data).not.toHaveProperty('origem_aquisicao');
        expect(resultado.data).not.toHaveProperty('parceiro_codigo');
    });

    test.each(['direta', 'outro'])('aceita origem %s sem parceiro', (origem) => {
        const resultado = onboardingSchema.safeParse({ ...base, origem_aquisicao: origem });

        expect(resultado.success).toBe(true);
        expect(resultado.data.origem_aquisicao).toBe(origem);
    });

    test('aceita indicação com parceiro e normaliza o código para maiúsculas', () => {
        const resultado = onboardingSchema.safeParse({
            ...base,
            origem_aquisicao: 'indicacao_parceiro',
            parceiro_codigo: '  forn-01_x '
        });

        expect(resultado.success).toBe(true);
        expect(resultado.data.parceiro_codigo).toBe('FORN-01_X');
    });

    test('rejeita origem fora do conjunto fechado', () => {
        const resultado = onboardingSchema.safeParse({ ...base, origem_aquisicao: 'qualquer' });

        expect(resultado.success).toBe(false);
        expect(resultado.error.issues[0].message).toBe('Origem de aquisição inválida');
    });

    test('rejeita indicação sem código do parceiro', () => {
        const resultado = onboardingSchema.safeParse({ ...base, origem_aquisicao: 'indicacao_parceiro' });

        expect(resultado.success).toBe(false);
        expect(resultado.error.issues[0].path).toEqual(['parceiro_codigo']);
    });

    test.each([undefined, 'direta', 'outro'])('rejeita código de parceiro quando a origem é %s', (origem) => {
        const corpo = { ...base, parceiro_codigo: 'FORN01' };
        if (origem !== undefined) corpo.origem_aquisicao = origem;

        const resultado = onboardingSchema.safeParse(corpo);

        expect(resultado.success).toBe(false);
        expect(resultado.error.issues[0].path).toEqual(['parceiro_codigo']);
    });

    test.each([
        ['curto demais', 'A'],
        ['longo demais', 'A'.repeat(41)],
        ['com espaço', 'FORN 01'],
        ['com caractere especial', 'FORN;DROP'],
        ['com acento', 'FORNÉ01']
    ])('rejeita código de parceiro %s', (_descricao, codigo) => {
        const resultado = onboardingSchema.safeParse({
            ...base,
            origem_aquisicao: 'indicacao_parceiro',
            parceiro_codigo: codigo
        });

        expect(resultado.success).toBe(false);
    });
});

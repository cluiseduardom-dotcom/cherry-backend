const {
    empresaIdParamSchema,
    trocarPlanoSchema,
    definirCondicaoSchema,
    encerrarCondicaoSchema
} = require('../../src/validations/plataformaValidation');

describe('empresaIdParamSchema', () => {
    test('aceita inteiro positivo (string da rota) e recusa o resto', () => {
        expect(empresaIdParamSchema.safeParse({ id: '12' }).data).toEqual({ id: 12 });
        for (const id of ['0', '-1', 'abc', '1.5', '']) {
            expect(empresaIdParamSchema.safeParse({ id }).success).toBe(false);
        }
    });
});

describe('trocarPlanoSchema', () => {
    const base = { plano: 'pro', justificativa: 'Cliente fechou o Pro' };

    test('aceita plano e justificativa; vigencia_inicio é opcional', () => {
        expect(trocarPlanoSchema.safeParse(base).success).toBe(true);
        expect(trocarPlanoSchema.safeParse({ ...base, vigencia_inicio: '2026-11-01' }).success).toBe(true);
    });

    test('recusa justificativa vazia ou só espaços, plano ausente e campos desconhecidos (empresa_id, responsavel)', () => {
        expect(trocarPlanoSchema.safeParse({ plano: 'pro' }).success).toBe(false);
        expect(trocarPlanoSchema.safeParse({ ...base, justificativa: '   ' }).success).toBe(false);
        expect(trocarPlanoSchema.safeParse({ justificativa: 'x'.repeat(10) }).success).toBe(false);
        expect(trocarPlanoSchema.safeParse({ ...base, empresa_id: 1 }).success).toBe(false);
        expect(trocarPlanoSchema.safeParse({ ...base, responsavel: 'fulano' }).success).toBe(false);
    });

    test('recusa datas fora do formato ou inexistentes', () => {
        for (const vigencia_inicio of ['01/11/2026', '2026-13-01', '2026-02-30', '2026-2-3', '']) {
            expect(trocarPlanoSchema.safeParse({ ...base, vigencia_inicio }).success).toBe(false);
        }
        expect(trocarPlanoSchema.safeParse({ ...base, vigencia_inicio: '2028-02-29' }).success).toBe(true); // bissexto
    });
});

describe('definirCondicaoSchema', () => {
    const base = { percentual: 0.5, justificativa: 'Empresa fundadora' };

    test('aceita 0 (isenção), 100 e até 4 casas decimais', () => {
        for (const percentual of [0, 0.5, 0.0001, 12.3456, 100]) {
            expect(definirCondicaoSchema.safeParse({ ...base, percentual }).success).toBe(true);
        }
    });

    test('recusa negativo, acima de 100, mais de 4 casas, texto, null e NaN', () => {
        for (const percentual of [-0.0001, 100.0001, 0.12345, '0.5', null, NaN, Infinity]) {
            expect(definirCondicaoSchema.safeParse({ ...base, percentual }).success).toBe(false);
        }
    });

    test('exige justificativa e recusa campo desconhecido', () => {
        expect(definirCondicaoSchema.safeParse({ percentual: 0.5 }).success).toBe(false);
        expect(definirCondicaoSchema.safeParse({ ...base, tipo: 'percentual' }).success).toBe(false);
    });
});

describe('encerrarCondicaoSchema', () => {
    test('justificativa obrigatória; a_partir_de opcional e validado', () => {
        expect(encerrarCondicaoSchema.safeParse({ justificativa: 'Fim do piloto' }).success).toBe(true);
        expect(encerrarCondicaoSchema.safeParse({ justificativa: 'Fim', a_partir_de: '2026-11-05' }).success).toBe(true);
        expect(encerrarCondicaoSchema.safeParse({ a_partir_de: '2026-11-05' }).success).toBe(false);
        expect(encerrarCondicaoSchema.safeParse({ justificativa: 'Fim', a_partir_de: '2026-02-31' }).success).toBe(false);
    });
});

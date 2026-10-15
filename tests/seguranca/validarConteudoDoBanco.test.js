const {
    MARCA_BANCO_DESCARTAVEL,
    avaliarMarca,
    avaliarEmpresas,
    validarConteudoDoBanco,
} = require('./validarConteudoDoBanco');

const SEED = { id: 1, nome: 'Cherry Semijoias' };

describe('B: marca de banco descartável', () => {
    test('com a marca exata, passa', () => {
        expect(avaliarMarca(MARCA_BANCO_DESCARTAVEL).ok).toBe(true);
    });

    test.each([null, undefined, '', 'cherry', 'Cherry-Test-Disposable', 'cherry-test-disposable ', 'producao'])(
        'sem a marca (%p), bloqueia e explica como marcar',
        (comentario) => {
            const r = avaliarMarca(comentario);

            expect(r.ok).toBe(false);
            expect(r.motivo).toMatch(/não está marcado como descartável/);
            expect(r.motivo).toMatch(/marcarBancoDescartavel/);
        }
    );

    test('a marca é verificada ANTES do conteúdo (banco sem marca nem chega à checagem de empresas)', () => {
        const r = validarConteudoDoBanco({ comentario: null, empresas: [{ id: 5, nome: 'Loja Real' }] });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/não está marcado como descartável/);
    });
});

describe('A: guarda de conteúdo (empresas)', () => {
    test('banco vazio passa', () => {
        expect(avaliarEmpresas([]).ok).toBe(true);
    });

    test('só o seed de CI passa', () => {
        expect(avaliarEmpresas([SEED]).ok).toBe(true);
    });

    test('seed + resíduos de testes anteriores passam', () => {
        const empresas = [SEED, { id: 7, nome: 'Teste Taxa Plataforma A 1a2b' }, { id: 8, nome: 'Empresa Teste Isolamento' }];

        expect(avaliarEmpresas(empresas).ok).toBe(true);
    });

    test('empresa real bloqueia e informa só id e contagem (nunca o nome)', () => {
        const r = avaliarEmpresas([SEED, { id: 42, nome: 'Loja da Maria Ltda' }]);

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/1 empresa\(s\)/);
        expect(r.motivo).toMatch(/ids: 42/);
        expect(r.motivo).not.toMatch(/Maria/);
    });

    test('uma segunda empresa com o nome do seed (cópia de dados reais) bloqueia', () => {
        const r = avaliarEmpresas([SEED, { id: 2, nome: 'Cherry Semijoias' }]);

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/ids: 2/);
    });

    test.each(['Testemunha Ltda', 'Testes Reais', 'Meu Teste', 'teste minúsculo', '', null])(
        'nome que só parece de teste (%p) NÃO conta como empresa de teste',
        (nome) => {
            expect(avaliarEmpresas([{ id: 9, nome }]).ok).toBe(false);
        }
    );

    test('muitas empresas estranhas: lista só as 10 primeiras ids', () => {
        const empresas = Array.from({ length: 13 }, (_, i) => ({ id: i + 100, nome: `Real ${i}` }));
        const r = avaliarEmpresas(empresas);

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/13 empresa\(s\)/);
        expect(r.motivo).toMatch(/…/);
        expect(r.motivo).not.toMatch(/110/);
    });
});

describe('validarConteudoDoBanco', () => {
    test('marcado + só seed e resíduos: passa', () => {
        const r = validarConteudoDoBanco({
            comentario: MARCA_BANCO_DESCARTAVEL,
            empresas: [SEED, { id: 3, nome: 'Teste Revogacao #87' }],
        });

        expect(r.ok).toBe(true);
    });

    test('marcado mas com empresa real: bloqueia (marca sozinha não basta)', () => {
        const r = validarConteudoDoBanco({ comentario: MARCA_BANCO_DESCARTAVEL, empresas: [{ id: 88, nome: 'Cliente Real' }] });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/dados reais/);
    });
});

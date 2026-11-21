const { MODELOS_NICHO, IDS_MODELOS_NICHO, buscarModelo, resumoDoModelo } = require('../../src/constants/modelosNicho');

describe('catálogo de modelos de nicho', () => {
    test('ids únicos, em minúsculas, e os nichos combinados existem', () => {
        expect(new Set(IDS_MODELOS_NICHO).size).toBe(IDS_MODELOS_NICHO.length);
        for (const id of ['confeitaria', 'lanchonete', 'adega', 'semijoias', 'moda']) expect(IDS_MODELOS_NICHO).toContain(id);
        for (const id of IDS_MODELOS_NICHO) expect(id).toMatch(/^[a-z]+$/);
    });

    test.each(MODELOS_NICHO.map((m) => [m.id, m]))('%s: níveis, categorias e padrão de SKU coerentes', (_id, modelo) => {
        expect(modelo.nome).toBeTruthy();
        expect(modelo.descricao).toBeTruthy();

        const niveis = modelo.niveis.map((n) => n.nivel);

        expect(niveis).toEqual([1, 2]);
        for (const n of modelo.niveis) expect(n.nome).toBeTruthy();

        // o banco guarda o código em até 3 caracteres, em maiúsculas, sem repetir no mesmo nível
        const vistos = new Set();

        for (const c of modelo.categorias) {
            expect(niveis).toContain(c.nivel);
            expect(c.codigo).toMatch(/^[A-Z0-9]{1,3}$/);
            expect(c.nome).toBeTruthy();
            const chave = `${c.nivel}:${c.codigo}`;

            expect(vistos.has(chave)).toBe(false);
            vistos.add(chave);
        }
        for (const nivel of niveis) expect(modelo.categorias.filter((c) => c.nivel === nivel).length).toBeGreaterThanOrEqual(3);

        // o padrão usa exatamente os níveis do modelo; o nível 1 é obrigatório e participa do SKU
        expect(modelo.padrao_sku.segmentos.map((s) => s.nivel)).toEqual(niveis);
        expect(modelo.padrao_sku.segmentos[0]).toMatchObject({ obrigatorio: true, participa_sku: true });
        expect(['numerico', 'alfanumerico', 'alfabetico']).toContain(modelo.padrao_sku.tipo_sku);
    });

    test('buscarModelo e resumoDoModelo', () => {
        expect(buscarModelo('confeitaria').id).toBe('confeitaria');
        expect(buscarModelo('nao-existe')).toBeNull();
        expect(buscarModelo(undefined)).toBeNull();

        const resumo = resumoDoModelo(buscarModelo('confeitaria'));

        expect(resumo).toMatchObject({ id: 'confeitaria', niveis: expect.any(Array) });
        expect(resumo.niveis[0]).toMatchObject({ nivel: 1, categorias: expect.any(Array) });
        expect(resumo.exemplo_sku).toMatch(/\d{3}$/);
    });
});

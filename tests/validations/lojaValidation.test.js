const { catalogoQuerySchema, marcacaoSchema } = require('../../src/validations/lojaValidation');
const { slugDoProduto } = require('../../src/repositories/lojaRepository');

describe('catalogoQuerySchema', () => {
    test('padrões: página 1, limite 24', () => {
        expect(catalogoQuerySchema.parse({})).toMatchObject({ pagina: 1, limite: 24 });
    });

    test('códigos de categoria viram maiúsculos; booleanos aceitam true/false/1/0', () => {
        expect(catalogoQuerySchema.parse({ n1: 'ane', novidades: '1', disponivel: 'false' })).toMatchObject({ n1: 'ANE', novidades: true, disponivel: false });
    });

    test.each([
        [{ ordem: 'preco; DROP TABLE' }], [{ preco_min: 'NaN' }], [{ preco_min: 'Infinity' }], [{ preco_min: '-1' }],
        [{ preco_min: '10', preco_max: '5' }], [{ limite: '49' }], [{ limite: '0' }], [{ pagina: '0' }], [{ pagina: '1.5' }],
        [{ q: 'a' }], [{ q: 'x'.repeat(61) }], [{ n1: 'ABCD' }], [{ n1: "A'" }], [{ novidades: 'sim' }]
    ])('rejeita %j', (entrada) => {
        expect(catalogoQuerySchema.safeParse(entrada).success).toBe(false);
    });
});

describe('marcacaoSchema (estrito)', () => {
    test('aceita só os campos editoriais; texto vazio vira null', () => {
        expect(marcacaoSchema.parse({ visivel: true, titulo: '  ', materiais: ' Aço ', ordem: 2 })).toEqual({ visivel: true, titulo: null, materiais: 'Aço', ordem: 2 });
    });

    test.each([[{ preco: 10 }], [{ estoque: 1 }], [{ custo: 1 }], [{ empresa_id: 2 }], [{ visivel: 'true' }], [{ ordem: 1.5 }], [{ descricao: 'x'.repeat(4001) }]])('rejeita %j', (entrada) => {
        expect(marcacaoSchema.safeParse(entrada).success).toBe(false);
    });
});

describe('slugDoProduto', () => {
    test('sem acento, minúsculo, com hífen e o id no fim (único por produto)', () => {
        expect(slugDoProduto('Anel solitário regulável (zircônia) 18K!', 21)).toBe('anel-solitario-regulavel-zirconia-18k-21');
    });

    test('nome sem letras ou números cai em produto-<id>', () => {
        expect(slugDoProduto('!!!', 7)).toBe('produto-7');
    });

    test('limita o tamanho e respeita o CHECK da tabela', () => {
        const slug = slugDoProduto('a '.repeat(200), 99999);

        expect(slug.length).toBeLessThanOrEqual(160);
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });
});

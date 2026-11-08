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

const { pedidoSchema, hashDoPedido, CHAVE_IDEMPOTENCIA } = require('../../src/validations/lojaValidation');

const pedidoValido = () => ({
    cliente: { nome: '  Maria  ', email: ' MARIA@Teste.COM ', telefone: '(11) 91234-5678' },
    itens: [{ slug: 'anel-1', quantidade: 2, preco_exibido: 63 }]
});

describe('pedidoSchema', () => {
    test('normaliza: nome sem espaços, e-mail minúsculo, telefone só dígitos', () => {
        expect(pedidoSchema.parse(pedidoValido()).cliente).toEqual({ nome: 'Maria', email: 'maria@teste.com', telefone: '11912345678' });
    });

    test('telefone vazio vira ausente', () => {
        const p = pedidoValido();
        p.cliente.telefone = '';

        expect(pedidoSchema.parse(p).cliente.telefone).toBeUndefined();
    });

    test.each([
        ['empresa_id na raiz', (p) => { p.empresa_id = 2; }],
        ['total na raiz', (p) => { p.total = 1; }],
        ['campo extra no cliente', (p) => { p.cliente.cpf = '1'; }],
        ['campo extra no item', (p) => { p.itens[0].preco_unitario = 1; }],
        ['quantidade NaN', (p) => { p.itens[0].quantidade = NaN; }],
        ['preço Infinity', (p) => { p.itens[0].preco_exibido = Infinity; }],
        ['itens não é lista', (p) => { p.itens = 'x'; }]
    ])('rejeita %s', (_r, quebrar) => {
        const p = pedidoValido();
        quebrar(p);

        expect(pedidoSchema.safeParse(p).success).toBe(false);
    });
});

describe('hashDoPedido', () => {
    test('é estável para o mesmo conteúdo, qualquer ordem dos itens', () => {
        const a = pedidoSchema.parse({ ...pedidoValido(), itens: [{ slug: 'a-1', quantidade: 1, preco_exibido: 10 }, { slug: 'b-2', quantidade: 2, preco_exibido: 20 }] });
        const b = pedidoSchema.parse({ ...pedidoValido(), itens: [{ slug: 'b-2', quantidade: 2, preco_exibido: 20 }, { slug: 'a-1', quantidade: 1, preco_exibido: 10 }] });

        expect(hashDoPedido(a)).toBe(hashDoPedido(b));
        expect(hashDoPedido(a)).toMatch(/^[0-9a-f]{64}$/);
    });

    test('muda com quantidade, preço exibido, item ou e-mail', () => {
        const base = hashDoPedido(pedidoSchema.parse(pedidoValido()));
        const variar = (f) => { const p = pedidoValido(); f(p); return hashDoPedido(pedidoSchema.parse(p)); };

        expect(variar((p) => { p.itens[0].quantidade = 3; })).not.toBe(base);
        expect(variar((p) => { p.itens[0].preco_exibido = 64; })).not.toBe(base);
        expect(variar((p) => { p.itens[0].slug = 'anel-2'; })).not.toBe(base);
        expect(variar((p) => { p.cliente.email = 'outra@teste.com'; })).not.toBe(base);
    });
});

describe('CHAVE_IDEMPOTENCIA', () => {
    test.each([['abcdefgh', true], ['a'.repeat(80), true], ['uuid-1234_ABCD', true], ['curta', false], ['a'.repeat(81), false], ['com espaço aqui', false], ['acentuação', false]])('%s → %s', (chave, ok) => {
        expect(CHAVE_IDEMPOTENCIA.test(chave)).toBe(ok);
    });
});

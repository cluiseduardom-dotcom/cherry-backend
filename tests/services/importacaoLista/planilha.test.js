const { mapearCabecalho, extrairLinhas } = require('../../../src/services/importacaoLista/planilha');
const { lerRegistros } = require('../../../src/services/importacaoLista/csv');

const ler = (csv, tipo) => extrairLinhas(lerRegistros(csv).registros, tipo);

describe('mapearCabecalho', () => {
    test('aceita qualquer ordem, caixa, acento, espaço e sinônimo', () => {
        const { indices } = mapearCabecalho([' CUSTO ', 'Nome', 'Saldo', 'SKU', 'Categoria', 'Local'], 'produtos');
        expect(indices).toEqual({ custo: 0, nome: 1, saldo: 2, sku: 3, categoria: 4, local: 5 });

        const clientes = mapearCabecalho(['Nome', 'Telefone', 'Data de Nascimento', 'Observações'], 'clientes');
        expect(clientes.indices).toEqual({ nome: 0, telefone: 1, nascimento: 2, observacoes: 3 });
    });

    test('só as obrigatórias bastam', () => {
        expect(mapearCabecalho(['nome', 'custo'], 'produtos').indices).toEqual({ nome: 0, custo: 1 });
    });

    test('falta coluna obrigatória: derruba o arquivo e diz qual', () => {
        expect(() => mapearCabecalho(['nome', 'preco'], 'produtos')).toThrow(
            expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/faltam as colunas obrigatórias \(custo\)/) })
        );
        expect(() => mapearCabecalho(['nome', 'custo'], 'clientes')).toThrow(expect.objectContaining({ message: expect.stringMatching(/\(telefone\)/) }));
    });

    test('coluna repetida derruba o arquivo', () => {
        expect(() => mapearCabecalho(['nome', 'custo', 'Nome'], 'produtos')).toThrow(expect.objectContaining({ message: expect.stringMatching(/mais de uma vez/) }));
    });

    test('coluna desconhecida é ignorada com aviso; preço tem aviso próprio', () => {
        const { ignoradas, avisos } = mapearCabecalho(['nome', 'custo', 'Preço de Venda', 'cor'], 'produtos');
        expect(ignoradas).toEqual(['Preço de Venda', 'cor']);
        expect(avisos[0]).toMatch(/Precificar por canal/);
        expect(avisos[1]).toBe('A coluna "cor" não faz parte do modelo e foi ignorada');
    });

    test('limita o número de colunas', () => {
        expect(() => mapearCabecalho(Array.from({ length: 31 }, (_, i) => `c${i}`), 'produtos')).toThrow(expect.objectContaining({ message: expect.stringMatching(/mais de 30 colunas/) }));
    });
});

describe('extrairLinhas', () => {
    test('monta valores por coluna, mantendo o número da linha do arquivo', () => {
        const { linhas } = ler('custo;nome\n10;Anel\n\n20;Brinco', 'produtos');
        expect(linhas).toEqual([
            { linha: 2, valores: { custo: '10', nome: 'Anel' }, colunasAMais: false },
            { linha: 4, valores: { custo: '20', nome: 'Brinco' }, colunasAMais: false }
        ]);
    });

    test('célula ausente vira texto vazio', () => {
        expect(ler('nome;custo\nAnel', 'produtos').linhas[0].valores).toEqual({ nome: 'Anel', custo: '' });
    });

    test('células além do cabeçalho marcam a linha (nome com vírgula sem aspas)', () => {
        expect(ler('nome;custo\nAnel; Ouro;10;x', 'produtos').linhas[0].colunasAMais).toBe(true);
        expect(ler('nome;custo\nAnel;10;;', 'produtos').linhas[0].colunasAMais).toBe(false);
    });

    test('arquivo sem dados ou só com cabeçalho é recusado', () => {
        expect(() => extrairLinhas([], 'produtos')).toThrow(expect.objectContaining({ message: expect.stringMatching(/nenhuma linha/) }));
        expect(() => ler('nome;custo', 'produtos')).toThrow(expect.objectContaining({ message: expect.stringMatching(/só o cabeçalho/) }));
    });
});

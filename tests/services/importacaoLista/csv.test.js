const { decodificar, detectarDelimitador, lerRegistros } = require('../../../src/services/importacaoLista/csv');
const { LIMITES } = require('../../../src/constants/importacaoLista');

describe('decodificar', () => {
    test('recusa arquivo vazio', () => {
        expect(() => decodificar(Buffer.alloc(0))).toThrow(expect.objectContaining({ statusCode: 400, message: 'O arquivo está vazio' }));
    });

    test('recusa .xlsx/.xlsm (ZIP) pelo conteúdo, mesmo com nome .csv', () => {
        const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('conteudo qualquer')]);
        expect(() => decodificar(zip)).toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/Excel/) }));
    });

    test('recusa .xls antigo (OLE)', () => {
        const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from('x')]);
        expect(() => decodificar(ole)).toThrow(expect.objectContaining({ message: expect.stringMatching(/Excel/) }));
    });

    test('recusa PDF e binário (byte nulo, como UTF-16)', () => {
        expect(() => decodificar(Buffer.from('%PDF-1.7 ...'))).toThrow(expect.objectContaining({ message: expect.stringMatching(/PDF/) }));
        expect(() => decodificar(Buffer.from('n\u0000o\u0000m\u0000e\u0000', 'utf8'))).toThrow(expect.objectContaining({ message: expect.stringMatching(/não parece ser um CSV/) }));
    });

    test('recusa acima do limite de bytes com 413', () => {
        expect(() => decodificar(Buffer.alloc(LIMITES.MAX_BYTES + 1, 'a'))).toThrow(expect.objectContaining({ statusCode: 413 }));
    });

    test('lê UTF-8, com ou sem BOM', () => {
        expect(decodificar(Buffer.from('nome;custo\nAnel de Ação;10', 'utf8'))).toBe('nome;custo\nAnel de Ação;10');
        expect(decodificar(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('nome;custo', 'utf8')]))).toBe('nome;custo');
    });

    test('cai para Windows-1252 quando não é UTF-8 válido (CSV do Excel em português)', () => {
        const latin = Buffer.from([0x6e, 0x6f, 0x6d, 0x65, 0x3b, 0x41, 0xe7, 0xe3, 0x6f]); // nome;Ação
        expect(decodificar(latin)).toBe('nome;Ação');
    });

    test('não interpreta fórmula: o texto passa como veio', () => {
        expect(decodificar(Buffer.from('=HYPERLINK("http://x")', 'utf8'))).toBe('=HYPERLINK("http://x")');
    });
});

describe('detectarDelimitador', () => {
    test.each([
        ['nome;custo;saldo\na;1;2', ';'],
        ['nome,custo,saldo\na,1,2', ','],
        ['nome\tcusto\na\t1', '\t'],
        ['nome', ',']
    ])('%p', (texto, esperado) => {
        expect(detectarDelimitador(texto)).toBe(esperado);
    });

    test('ignora delimitador dentro de aspas na linha de cabeçalho', () => {
        expect(detectarDelimitador('"a,b,c";custo')).toBe(';');
    });
});

describe('lerRegistros', () => {
    test('lê registros com número da linha física e pula linhas vazias', () => {
        const { registros } = lerRegistros('nome;custo\n\nAnel;10\n;;\nBrinco;20\n');
        expect(registros).toEqual([
            { linha: 1, celulas: ['nome', 'custo'] },
            { linha: 3, celulas: ['Anel', '10'] },
            { linha: 5, celulas: ['Brinco', '20'] }
        ]);
    });

    test('aceita CRLF, CR e arquivo sem quebra final', () => {
        expect(lerRegistros('a;b\r\n1;2\r\n3;4').registros.map((r) => r.celulas)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
        expect(lerRegistros('a;b\r1;2').registros.map((r) => r.linha)).toEqual([1, 2]);
    });

    test('aspas: delimitador, aspas duplicadas e quebra de linha dentro da célula', () => {
        const { registros } = lerRegistros('nome;obs\n"Silva; João";"disse ""oi"""\n"A\nB";x\nfim;y');
        expect(registros[1].celulas).toEqual(['Silva; João', 'disse "oi"']);
        expect(registros[2]).toEqual({ linha: 3, celulas: ['A\nB', 'x'] });
        expect(registros[3].linha).toBe(5);
    });

    test('aspas não fechadas derrubam o arquivo apontando a linha', () => {
        expect(() => lerRegistros('nome;obs\n"aberta;x\nB;y')).toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/linha 2/) }));
    });

    test('fórmulas ficam como texto', () => {
        const { registros } = lerRegistros('nome;custo\n=1+1;@x');
        expect(registros[1].celulas).toEqual(['=1+1', '@x']);
    });

    test('recusa mais de 2.000 linhas de dados, e aceita exatamente 2.000', () => {
        const linhas = (n) => ['nome;custo', ...Array.from({ length: n }, (_, i) => `p${i};1`)].join('\n');
        expect(lerRegistros(linhas(LIMITES.MAX_LINHAS)).registros).toHaveLength(LIMITES.MAX_LINHAS + 1);
        expect(() => lerRegistros(linhas(LIMITES.MAX_LINHAS + 1))).toThrow(expect.objectContaining({ message: expect.stringMatching(/mais de 2000 linhas/) }));
    });
});

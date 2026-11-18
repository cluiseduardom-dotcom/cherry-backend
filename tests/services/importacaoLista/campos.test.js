const { parseNome, parseCusto, parseSaldo, parseSku, parseTelefone, parseNascimento, parseObservacoes } = require('../../../src/services/importacaoLista/campos');

describe('parseCusto', () => {
    test.each([
        ['12,50', '12.50'],
        ['12.50', '12.50'],
        ['R$ 12,50', '12.50'],
        ['r$12,5', '12.50'],
        ['1.234,56', '1234.56'],
        ['1,234.56', '1234.56'],
        ['1.234', '1234.00'],
        ['1.234.567', '1234567.00'],
        ['10', '10.00'],
        ['0,01', '0.01'],
        ['007,10', '7.10'],
        ['  9,9  ', '9.90']
    ])('aceita %p como %p', (entrada, esperado) => {
        expect(parseCusto(entrada)).toEqual({ valor: esperado });
    });

    test.each([
        ['', /apenas números/],
        ['abc', /apenas números/],
        ['12 reais', /apenas números/],
        ['1,2,3', /apenas números/],
        ['1.23.4', /apenas números/],
        ['12,345', /2 casas decimais/],
        ['-5', /negativo/],
        ['0', /maior que zero/],
        ['0,00', /maior que zero/],
        ['R$ 0', /maior que zero/],
        ['123456789', /limite/]
    ])('recusa %p', (entrada, motivo) => {
        expect(parseCusto(entrada).erro).toMatch(motivo);
    });
});

describe('parseSaldo', () => {
    test('vazio vale 0', () => {
        expect(parseSaldo('')).toEqual({ valor: 0 });
        expect(parseSaldo('   ')).toEqual({ valor: 0 });
        expect(parseSaldo(undefined)).toEqual({ valor: 0 });
    });

    test('aceita inteiro maior ou igual a 0', () => {
        expect(parseSaldo('0')).toEqual({ valor: 0 });
        expect(parseSaldo(' 25 ')).toEqual({ valor: 25 });
    });

    test.each(['2,5', '2.5', '-1', 'dez', '1e3'])('recusa %p', (entrada) => {
        expect(parseSaldo(entrada).erro).toMatch(/inteiro/);
    });

    test('recusa acima do limite', () => {
        expect(parseSaldo('1000001').erro).toMatch(/limite/);
        expect(parseSaldo('1000000')).toEqual({ valor: 1000000 });
    });
});

describe('parseTelefone', () => {
    test('normaliza para dígitos', () => {
        expect(parseTelefone('(11) 91234-5678')).toEqual({ valor: '11912345678', avisos: [] });
        expect(parseTelefone('11 3456-7890')).toEqual({ valor: '1134567890', avisos: [] });
    });

    test('remove DDI 55 com aviso', () => {
        expect(parseTelefone('+55 11 91234-5678')).toEqual({ valor: '11912345678', avisos: ['DDI 55 removido do telefone'] });
        expect(parseTelefone('551134567890').valor).toBe('1134567890');
    });

    test('remove zero inicial com aviso', () => {
        expect(parseTelefone('(011) 91234-5678')).toEqual({ valor: '11912345678', avisos: ['zero inicial removido do telefone'] });
    });

    test.each([
        ['91234-5678', /10 ou 11 dígitos/],
        ['123', /10 ou 11 dígitos/],
        ['119123456789012', /10 ou 11 dígitos/],
        ['(10) 3456-7890', /DDD/],
        ['11 81234-5678', /começar com 9/]
    ])('recusa %p', (entrada, motivo) => {
        expect(parseTelefone(entrada).erro).toMatch(motivo);
    });
});

describe('parseNascimento', () => {
    const hoje = '2026-11-17';

    test('aceita DD/MM/AAAA e AAAA-MM-DD, devolvendo texto ISO sem passar por Date', () => {
        expect(parseNascimento('05/03/1990', hoje)).toEqual({ valor: '1990-03-05' });
        expect(parseNascimento('5/3/1990', hoje)).toEqual({ valor: '1990-03-05' });
        expect(parseNascimento('1990-03-05', hoje)).toEqual({ valor: '1990-03-05' });
        expect(parseNascimento('29/02/2000', hoje)).toEqual({ valor: '2000-02-29' });
    });

    test.each(['31/02/1990', '29/02/2001', '00/01/1990', '1990/03/05', '05-03-1990', 'ontem', '05/03/90', '01/01/1899'])(
        'recusa %p',
        (entrada) => {
            expect(parseNascimento(entrada, hoje).erro).toBe('data inválida: use DD/MM/AAAA');
        }
    );

    test('recusa data futura e aceita hoje', () => {
        expect(parseNascimento('18/11/2026', hoje).erro).toMatch(/futura/);
        expect(parseNascimento('17/11/2026', hoje)).toEqual({ valor: '2026-11-17' });
    });
});

describe('parseNome', () => {
    test('colapsa espaços e remove caracteres de controle', () => {
        expect(parseNome('  Anel   de \u0007 Ouro ')).toEqual({ valor: 'Anel de Ouro' });
    });

    test('exige de 2 a 120 caracteres', () => {
        expect(parseNome('A').erro).toMatch(/2 a 120/);
        expect(parseNome('   ').erro).toMatch(/2 a 120/);
        expect(parseNome('x'.repeat(121)).erro).toMatch(/2 a 120/);
        expect(parseNome('x'.repeat(120)).valor).toHaveLength(120);
    });
});

describe('parseSku', () => {
    test('maiúsculo e sem espaços', () => {
        expect(parseSku(' an-001/a ')).toEqual({ valor: 'AN-001/A' });
    });

    test.each(['', 'AN 001', '-AN', 'AN#1', 'x'.repeat(51)])('recusa %p', (entrada) => {
        expect(parseSku(entrada).erro).toMatch(/SKU inválido/);
    });
});

describe('parseObservacoes', () => {
    test('aceita vazio e até 500 caracteres', () => {
        expect(parseObservacoes('')).toEqual({ valor: '' });
        expect(parseObservacoes('x'.repeat(500)).valor).toHaveLength(500);
        expect(parseObservacoes('x'.repeat(501)).erro).toMatch(/500/);
    });
});

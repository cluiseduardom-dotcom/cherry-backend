const { telefoneParaWhatsApp, formatarMoeda, montarMensagemDeCobranca, linkWhatsApp } = require('../../src/utils/fiadoCobranca');

describe('telefoneParaWhatsApp', () => {
    test('celular e fixo com DDD ganham o 55; já com 55 fica como está', () => {
        expect(telefoneParaWhatsApp('(11) 91234-5678')).toBe('5511912345678');
        expect(telefoneParaWhatsApp('11 3234-5678')).toBe('551132345678');
        expect(telefoneParaWhatsApp('+55 11 91234-5678')).toBe('5511912345678');
        expect(telefoneParaWhatsApp('011912345678')).toBe('5511912345678');
    });

    test('recusa vazio, curto, longo, celular sem o 9 e fixo começando fora de 2 a 5', () => {
        for (const ruim of [null, undefined, '', '123', '1191234567', '551191234567890', '11 81234-5678', '11 63234-5678']) {
            expect(telefoneParaWhatsApp(ruim)).toBeNull();
        }
    });
});

describe('formatarMoeda', () => {
    test('milhar, centavos e arredondamento sem erro de ponto flutuante', () => {
        expect(formatarMoeda(45)).toBe('R$ 45,00');
        expect(formatarMoeda(1234.5)).toBe('R$ 1.234,50');
        expect(formatarMoeda(1234567.89)).toBe('R$ 1.234.567,89');
        expect(formatarMoeda(0.1 + 0.2)).toBe('R$ 0,30');
        expect(formatarMoeda(0.05)).toBe('R$ 0,05');
    });
});

describe('mensagem e link', () => {
    test('mensagem usa o primeiro nome e o saldo; sem nome, só "Olá!"', () => {
        expect(montarMensagemDeCobranca({ nome: 'joão da SILVA', saldo: 45 }))
            .toBe('Olá, João! Consta em nosso controle um saldo pendente de R$ 45,00. Caso já tenha realizado o pagamento, por favor, desconsidere esta mensagem. Obrigado!');
        expect(montarMensagemDeCobranca({ nome: '  ', saldo: 10 })).toMatch(/^Olá! Consta/);
    });

    test('link wa.me com número e texto codificados (acentos, espaços, vírgula)', () => {
        const mensagem = montarMensagemDeCobranca({ nome: 'Joana', saldo: 1234.5 });
        const link = linkWhatsApp('(11) 91234-5678', mensagem);

        expect(link.startsWith('https://wa.me/5511912345678?text=')).toBe(true);
        expect(decodeURIComponent(link.split('?text=')[1])).toBe(mensagem);
        expect(link).not.toMatch(/\s/);
        expect(linkWhatsApp('sem telefone', mensagem)).toBeNull();
    });
});

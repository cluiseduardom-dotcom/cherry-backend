const { obterInstrucaoPagamento } = require('../../src/config/cobrancaTaxaConfig');

describe('instrução de pagamento da taxa', () => {
    test('chave e favorecido do ambiente, aparados', () => {
        expect(obterInstrucaoPagamento({ TAXA_COBRANCA_PIX_CHAVE: '  12.345.678/0001-90 ', TAXA_COBRANCA_FAVORECIDO: ' GiroNex Ltda ' }))
            .toEqual({ chave_pix: '12.345.678/0001-90', favorecido: 'GiroNex Ltda' });
    });

    test('favorecido é opcional', () => {
        expect(obterInstrucaoPagamento({ TAXA_COBRANCA_PIX_CHAVE: 'pix@gironex.invalid' })).toEqual({ chave_pix: 'pix@gironex.invalid', favorecido: null });
    });

    test('sem chave, vazia, longa demais ou com caractere de controle: não configurada', () => {
        expect(obterInstrucaoPagamento({})).toBeNull();
        expect(obterInstrucaoPagamento({ TAXA_COBRANCA_PIX_CHAVE: '   ' })).toBeNull();
        expect(obterInstrucaoPagamento({ TAXA_COBRANCA_PIX_CHAVE: 'x'.repeat(141) })).toBeNull();
        expect(obterInstrucaoPagamento({ TAXA_COBRANCA_PIX_CHAVE: 'chave\nlinha2' })).toBeNull();
    });

    test('favorecido inválido some, mas a chave continua valendo', () => {
        expect(obterInstrucaoPagamento({ TAXA_COBRANCA_PIX_CHAVE: 'abc', TAXA_COBRANCA_FAVORECIDO: 'a\tb' }))
            .toEqual({ chave_pix: 'abc', favorecido: null });
    });
});

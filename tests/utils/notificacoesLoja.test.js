const { montarNotificacoesLoja, TIPOS_LOJA, LIMITES_LOJA } = require('../../src/utils/notificacoesLoja');

const CODIGO = '79de7794-1111-4222-8333-444455556666';
const pago = (extra = {}) => ({ id: 7, codigo: CODIGO, cliente_nome: 'Maria Souza', cliente_telefone: '11912345678', total: '136.00', horas: 2, ...extra });
const semVenda = (extra = {}) => ({ id: 9, codigo: CODIGO, status: 'expirado', cliente_nome: 'Ana', cliente_telefone: '11900000000', total: '99.00', ...extra });
const admin = { administrador: true, vendedor: false };

describe('quem recebe', () => {
    test.each([[{ administrador: true }], [{ vendedor: true }]])('%j recebe', (perfil) => {
        expect(montarNotificacoesLoja({ aCombinar: [pago()] }, perfil)).toHaveLength(1);
    });

    test.each([[{}], [{ estoquista: true }], [{ administrador: false, vendedor: false }]])('%j não recebe (o aviso traz nome e telefone da cliente)', (perfil) => {
        expect(montarNotificacoesLoja({ aCombinar: [pago()], semVenda: [semVenda()] }, perfil)).toEqual([]);
    });
});

describe('pedido pago aguardando contato', () => {
    test('traz nome, valor, telefone e a ação, e um id estável por pedido', () => {
        const [a] = montarNotificacoesLoja({ aCombinar: [pago()] }, admin);

        expect(a).toMatchObject({ id: 'loja_pedido_pago:7', tipo: TIPOS_LOJA.PEDIDO_PAGO, item: 'pedido', produto_id: null, sku: null, nome: null, pedido_codigo: CODIGO });
        expect(a.mensagem).toContain('79DE7794');
        expect(a.mensagem).toContain('R$ 136,00');
        expect(a.mensagem).toContain('Maria Souza');
        expect(a.mensagem).toContain('Telefone: 11912345678');
        expect(a.acao).toMatch(/Combinar o frete e a entrega/);
        expect(a.dados).toEqual({ pedido_id: 7, total: 136, horas: 2 });
    });

    test.each([[0, 'media', /agora há pouco/], [5, 'media', /há 5 h/], [LIMITES_LOJA.PEDIDO_PAGO_ALTA_HORAS, 'alta', /há 24 h/], [72, 'alta', /há 3 dias/]])('%i h de espera: prioridade %s', (horas, prioridade, texto) => {
        const [a] = montarNotificacoesLoja({ aCombinar: [pago({ horas })] }, admin);

        expect(a.prioridade).toBe(prioridade);
        expect(a.mensagem).toMatch(texto);
    });

    test('sem telefone, não escreve "Telefone: null"', () => {
        const [a] = montarNotificacoesLoja({ aCombinar: [pago({ cliente_telefone: null })] }, admin);

        expect(a.mensagem).not.toMatch(/Telefone|null/);
    });
});

describe('pagamento recebido que não virou venda', () => {
    test('expirado sem estoque: alta, manda devolver', () => {
        const [a] = montarNotificacoesLoja({ semVenda: [semVenda()] }, admin);

        expect(a).toMatchObject({ id: 'loja_pagamento_sem_venda:9', tipo: TIPOS_LOJA.PAGAMENTO_SEM_VENDA, prioridade: 'alta' });
        expect(a.mensagem).toMatch(/depois de a reserva expirar/);
        expect(a.acao).toMatch(/devolver/i);
        expect(a.dados).toEqual({ pedido_id: 9, total: 99, situacao: 'expirado' });
    });

    test('aguardando (conversão que não concluiu): manda aguardar e, se persistir, falar com a GiroNex', () => {
        const [a] = montarNotificacoesLoja({ semVenda: [semVenda({ status: 'aguardando_pagamento' })] }, admin);

        expect(a.mensagem).toMatch(/ainda não virou venda/);
        expect(a.acao).toMatch(/GiroNex/);
    });
});

describe('segurança do conteúdo', () => {
    test('nenhum aviso traz custo, margem, taxa nem dado do provedor, nem e-mail da cliente', () => {
        const texto = JSON.stringify(montarNotificacoesLoja({ aCombinar: [pago()], semVenda: [semVenda()] }, admin));

        expect(texto).not.toMatch(/custo|margem|taxa|id_externo|email|@/i);
    });

    test('sem dados, sem avisos', () => {
        expect(montarNotificacoesLoja({}, admin)).toEqual([]);
    });
});

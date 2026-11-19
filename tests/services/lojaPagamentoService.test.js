jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../../src/services/cobrancasPagamentoService');
jest.mock('../../src/repositories/lojaPedidosRepository');

const cobrancasService = require('../../src/services/cobrancasPagamentoService');
const pedidosRepository = require('../../src/repositories/lojaPedidosRepository');
const { iniciarPagamento, urlsDeRetorno, paraCliente } = require('../../src/services/lojaPagamentoService');
const { pagamentoSchema } = require('../../src/validations/lojaValidation');

const CODIGO_PEDIDO = '22222222-2222-4222-8222-222222222222';
const PEDIDO = { id: 9, codigo: CODIGO_PEDIDO, total: '126.00', cliente_email: 'maria@exemplo.com' };

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('urlsDeRetorno', () => {
    test('com endereço https da loja: monta as três URLs do pedido', () => {
        expect(urlsDeRetorno(CODIGO_PEDIDO, { LOJA_PUBLIC_URL: 'https://loja.exemplo.com/' })).toEqual({
            sucesso: `https://loja.exemplo.com/pedido/${CODIGO_PEDIDO}?pagamento=sucesso`,
            pendente: `https://loja.exemplo.com/pedido/${CODIGO_PEDIDO}?pagamento=pendente`,
            falha: `https://loja.exemplo.com/pedido/${CODIGO_PEDIDO}?pagamento=falha`
        });
    });

    test.each([[undefined], [''], ['   '], ['http://loja.exemplo.com'], ['loja.exemplo.com'], ['ftp://x'], ['javascript:alert(1)']])('endereço %j: sem retorno (o Mercado Pago exige https)', (url) => {
        expect(urlsDeRetorno(CODIGO_PEDIDO, { LOJA_PUBLIC_URL: url })).toBeNull();
    });
});

describe('urlsDeRetorno: cada empresa volta para a própria loja', () => {
    const LOJAS = 'https://www.cherrysemijoias.com.br, https://www.valvazoriimport.com.br/';
    const ENV = { LOJA_PUBLIC_URL: 'https://www.cherrysemijoias.com.br', LOJA_CORS_ORIGINS: LOJAS };
    const sucesso = (origem, env = ENV) => urlsDeRetorno(CODIGO_PEDIDO, env, origem)?.sucesso;

    test('origem de uma loja da lista: a cliente volta para ESSA loja (a da Valvazori não cai na da Cherry)', () => {
        expect(sucesso('https://www.valvazoriimport.com.br')).toBe(`https://www.valvazoriimport.com.br/pedido/${CODIGO_PEDIDO}?pagamento=sucesso`);
        expect(sucesso('https://www.cherrysemijoias.com.br')).toBe(`https://www.cherrysemijoias.com.br/pedido/${CODIGO_PEDIDO}?pagamento=sucesso`);
        expect(sucesso('https://www.valvazoriimport.com.br/')).toContain('https://www.valvazoriimport.com.br/pedido/');
    });

    test.each([
        ['origem fora da lista (site de terceiro)', 'https://evil.example.com'],
        ['subdomínio parecido', 'https://www.valvazoriimport.com.br.evil.com'],
        ['http em vez de https', 'http://www.valvazoriimport.com.br'],
        ['origem com caminho (não é uma origem pura)', 'https://www.valvazoriimport.com.br/x'],
        ['origem ausente', undefined],
        ['origem vazia', ''],
        ['origem "null" (documento isolado)', 'null']
    ])('%s: ignorada, vale LOJA_PUBLIC_URL (comportamento anterior)', (_nome, origem) => {
        expect(sucesso(origem)).toBe(`https://www.cherrysemijoias.com.br/pedido/${CODIGO_PEDIDO}?pagamento=sucesso`);
    });

    test('sem LOJA_CORS_ORIGINS nada muda: origem enviada pelo navegador não vale, só LOJA_PUBLIC_URL', () => {
        const env = { LOJA_PUBLIC_URL: 'https://loja.exemplo.com' };
        expect(sucesso('https://qualquer.com', env)).toBe(`https://loja.exemplo.com/pedido/${CODIGO_PEDIDO}?pagamento=sucesso`);
    });

    test('origem da lista mesmo sem LOJA_PUBLIC_URL: a loja nova já devolve a cliente; sem as duas, sem retorno', () => {
        expect(sucesso('https://www.valvazoriimport.com.br', { LOJA_CORS_ORIGINS: LOJAS })).toContain('https://www.valvazoriimport.com.br/pedido/');
        expect(urlsDeRetorno(CODIGO_PEDIDO, { LOJA_CORS_ORIGINS: LOJAS }, 'https://outra.com')).toBeNull();
    });

    test('lista com origem http (inválida para o Mercado Pago): nunca é usada como retorno', () => {
        const env = { LOJA_PUBLIC_URL: 'https://loja.exemplo.com', LOJA_CORS_ORIGINS: 'http://localhost:5173' };
        expect(sucesso('http://localhost:5173', env)).toBe(`https://loja.exemplo.com/pedido/${CODIGO_PEDIDO}?pagamento=sucesso`);
    });
});

describe('paraCliente', () => {
    const resposta = { codigo: 'interno', status: 'pendente', valor: '126.00', expira_em: 'x', expira_em_segundos: 10, qr_code: 'QR', qr_code_base64: 'B', ticket_url: 'https://t', link_url: 'https://l', parcelas_maximas: 12, taxa_plataforma: 1, id_externo: '5' };

    test('Pix: só QR e prazo; sem link, código interno, taxa, id do provedor nem ticket', () => {
        const r = paraCliente(resposta, 'pix');

        expect(Object.keys(r).sort()).toEqual(['expira_em', 'expira_em_segundos', 'metodo', 'qr_code', 'qr_code_base64', 'status', 'valor']);
        expect(r.valor).toBe(126);
    });

    test('cartão: só o link e as parcelas; sem QR', () => {
        const r = paraCliente(resposta, 'cartao');

        expect(Object.keys(r).sort()).toEqual(['expira_em', 'expira_em_segundos', 'link_url', 'metodo', 'parcelas_maximas', 'status', 'valor']);
    });
});

describe('iniciarPagamento', () => {
    test('cobrança já em aberto: devolve a mesma, sem criar outra', async () => {
        pedidosRepository.prepararPagamento.mockResolvedValue({ acao: 'reutilizar', pedido: PEDIDO, cobrancaCodigo: 'c-1' });
        cobrancasService.consultar.mockResolvedValue({ status: 'pendente', valor: '126.00', qr_code: 'QR' });

        const r = await iniciarPagamento({ empresa_id: 3, codigoPedido: CODIGO_PEDIDO, metodo: 'pix' });

        expect(r.criado).toBe(false);
        expect(cobrancasService.criarPix).not.toHaveBeenCalled();
        expect(pedidosRepository.estenderReserva).not.toHaveBeenCalled();
    });

    test('Pix novo: usa o valor e o e-mail do PEDIDO (servidor), o código já gravado e depois estende a reserva', async () => {
        pedidosRepository.prepararPagamento.mockResolvedValue({ acao: 'criar', pedido: PEDIDO, cobrancaCodigo: 'c-novo' });
        cobrancasService.criarPix.mockResolvedValue({ status: 'pendente', valor: '126.00', qr_code: 'QR', qr_code_base64: 'B' });

        const r = await iniciarPagamento({ empresa_id: 3, codigoPedido: CODIGO_PEDIDO, metodo: 'pix' });

        expect(cobrancasService.criarPix).toHaveBeenCalledWith(
            { empresa_id: 3, usuario_id: null },
            { valor: 126, cliente_email: 'maria@exemplo.com' },
            { codigo: 'c-novo', descricao: 'Pedido na loja online' }
        );
        expect(pedidosRepository.estenderReserva).toHaveBeenCalledWith({ empresa_id: 3, pedido_id: 9, cobrancaCodigo: 'c-novo', metodo: 'pix' });
        expect(r).toMatchObject({ criado: true, pagamento: { metodo: 'pix', qr_code: 'QR' } });
    });

    test('falha ao criar: libera o código gravado e devolve 503 sem a mensagem do provedor', async () => {
        pedidosRepository.prepararPagamento.mockResolvedValue({ acao: 'criar', pedido: PEDIDO, cobrancaCodigo: 'c-novo' });
        cobrancasService.criarPix.mockRejectedValue(new Error('segredo do provedor'));

        const erro = await iniciarPagamento({ empresa_id: 3, codigoPedido: CODIGO_PEDIDO, metodo: 'pix' }).catch((e) => e);

        expect(erro).toMatchObject({ statusCode: 503, codigo: 'PAGAMENTO_INDISPONIVEL' });
        expect(erro.message).not.toContain('segredo');
        expect(pedidosRepository.liberarPagamentoNaoCriado).toHaveBeenCalledWith({ empresa_id: 3, pedido_id: 9, cobrancaCodigo: 'c-novo' });
        expect(pedidosRepository.estenderReserva).not.toHaveBeenCalled();
    });

    test('Pix suspenso na loja: a cliente é avisada com a verdade (sem "tente novamente"), sem motivo nem taxa', async () => {
        pedidosRepository.prepararPagamento.mockResolvedValue({ acao: 'criar', pedido: PEDIDO, cobrancaCodigo: 'c-novo' });
        const suspenso = Object.assign(new Error('O Pix está indisponível para esta empresa no momento.'), { codigo: 'PIX_SUSPENSO', statusCode: 403 });
        cobrancasService.criarPix.mockRejectedValue(suspenso);

        const erro = await iniciarPagamento({ empresa_id: 3, codigoPedido: CODIGO_PEDIDO, metodo: 'pix' }).catch((e) => e);

        expect(erro).toMatchObject({ statusCode: 503, codigo: 'PAGAMENTO_INDISPONIVEL', message: 'O Pix está indisponível nesta loja no momento. Escolha outra forma de pagamento.' });
        expect(erro.message).not.toMatch(/taxa|atraso|empresa|administrador/i);
        expect(pedidosRepository.liberarPagamentoNaoCriado).toHaveBeenCalled();
    });
});

describe('pagamentoSchema', () => {
    test.each([['pix'], ['cartao']])('aceita %s', (metodo) => {
        expect(pagamentoSchema.parse({ metodo })).toEqual({ metodo });
    });

    test.each([[{}], [{ metodo: 'boleto' }], [{ metodo: 'pix', valor: 1 }], [{ metodo: 'pix', empresa_id: 2 }], [{ metodo: 'cartao_link' }]])('rejeita %j', (corpo) => {
        expect(pagamentoSchema.safeParse(corpo).success).toBe(false);
    });
});

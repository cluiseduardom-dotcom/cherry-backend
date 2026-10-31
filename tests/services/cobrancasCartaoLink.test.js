jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../../src/integrations/mercadoPagoClient');
jest.mock('../../src/services/mercadoPagoService');
jest.mock('../../src/repositories/cobrancasPagamentoRepository');
jest.mock('../../src/repositories/cobrancaDevolucoesRepository');
jest.mock('../../src/repositories/taxasPlataformaRepository');
jest.mock('../../src/repositories/mercadoPagoRepository');

const client = require('../../src/integrations/mercadoPagoClient');
const mercadoPagoService = require('../../src/services/mercadoPagoService');
const repo = require('../../src/repositories/cobrancasPagamentoRepository');
const mpRepo = require('../../src/repositories/mercadoPagoRepository');
const service = require('../../src/services/cobrancasPagamentoService');

const CODIGO = '11111111-1111-4111-8111-111111111111';
const CONFIG = { webhookUrl: 'https://api.exemplo.com/webhooks/mercadopago' };

const cobranca = (extra = {}) => ({
    id: 7, codigo: CODIGO, empresa_id: 3, metodo: 'cartao_link', valor: '120.00', status: 'pendente',
    id_externo: null, expira_em: new Date(Date.now() + 3600_000).toISOString(), link_url: 'https://mp.exemplo/checkout',
    parcelas_maximas: 12, tipo_cartao: null, parcelas: null, ...extra
});

const pagamentoMp = (extra = {}) => ({
    id: 555, status: 'approved', external_reference: CODIGO, payment_type_id: 'credit_card',
    transaction_amount: 120, installments: 3, ...extra
});

beforeEach(() => {
    jest.resetAllMocks();
    mercadoPagoService.exigirConfig.mockReturnValue(CONFIG);
    mercadoPagoService.obterAccessToken.mockResolvedValue('token-da-loja');
});

describe('criarLinkCartao', () => {
    test('cria a cobrança de cartão, a preferência com teto de 12x e devolve o link sem expor taxa', async () => {
        repo.criar.mockResolvedValue(cobranca());
        client.criarPreferenciaCartao.mockResolvedValue({ preferenciaId: 'pref-1', linkUrl: 'https://mp.exemplo/checkout' });
        repo.registrarLinkCriado.mockImplementation(async (dados) => cobranca({ preferencia_id: dados.preferenciaId, link_url: dados.linkUrl }));

        const res = await service.criarLinkCartao({ empresa_id: 3, usuario_id: 9 }, { valor: 120 });

        expect(repo.criar).toHaveBeenCalledWith(expect.objectContaining({
            empresa_id: 3, metodo: 'cartao_link', taxa_plataforma: 0, parcelas_maximas: 12, valor: '120.00'
        }));
        expect(client.criarPreferenciaCartao).toHaveBeenCalledWith(CONFIG, expect.objectContaining({
            accessToken: 'token-da-loja', valor: 120, taxaPlataforma: 0, parcelasMaximas: 12
        }));
        expect(res).toMatchObject({ metodo: 'cartao_link', link_url: 'https://mp.exemplo/checkout', parcelas_maximas: 12, status: 'pendente' });
        expect(res).not.toHaveProperty('taxa_plataforma');
        expect(res).not.toHaveProperty('id_externo');
    });

    test('falha do provedor marca a cobrança como falhou e repassa o erro', async () => {
        repo.criar.mockResolvedValue(cobranca());
        client.criarPreferenciaCartao.mockRejectedValue(new Error('recusou'));

        await expect(service.criarLinkCartao({ empresa_id: 3, usuario_id: 9 }, { valor: 120 })).rejects.toThrow('recusou');
        expect(repo.marcarFalhou).toHaveBeenCalledWith(7, 3);
        expect(repo.registrarLinkCriado).not.toHaveBeenCalled();
    });

    test('loja sem Mercado Pago conectado falha antes de gravar qualquer cobrança', async () => {
        mercadoPagoService.obterAccessToken.mockRejectedValue(new Error('sem conexão'));

        await expect(service.criarLinkCartao({ empresa_id: 3, usuario_id: 9 }, { valor: 120 })).rejects.toThrow('sem conexão');
        expect(repo.criar).not.toHaveBeenCalled();
    });
});

describe('escolherPagamentoCartao', () => {
    const base = cobranca();

    test('só vale pagamento aprovado, nosso, de cartão e do valor exato', () => {
        expect(service.escolherPagamentoCartao([pagamentoMp()], base)).toMatchObject({ id: 555 });
        expect(service.escolherPagamentoCartao([pagamentoMp({ status: 'rejected' })], base)).toBeNull();
        expect(service.escolherPagamentoCartao([pagamentoMp({ status: 'in_process' })], base)).toBeNull();
        expect(service.escolherPagamentoCartao([pagamentoMp({ external_reference: 'outra' })], base)).toBeNull();
        expect(service.escolherPagamentoCartao([pagamentoMp({ payment_type_id: 'bank_transfer' })], base)).toBeNull();
        expect(service.escolherPagamentoCartao([pagamentoMp({ transaction_amount: 119.99 })], base)).toBeNull();
    });

    test('uma tentativa recusada não impede de achar a aprovada depois', () => {
        const lista = [pagamentoMp({ id: 1, status: 'rejected' }), pagamentoMp({ id: 2 })];
        expect(service.escolherPagamentoCartao(lista, base)).toMatchObject({ id: 2 });
    });
});

describe('consultar / sincronizar link de cartão', () => {
    test('pagamento aprovado: grava id, tipo e parcelas do Mercado Pago e muda para pago', async () => {
        const pendente = cobranca();
        const registrada = cobranca({ id_externo: '555', tipo_cartao: 'credito', parcelas: 3 });
        repo.buscarPorCodigo.mockResolvedValueOnce(pendente);
        client.buscarPagamentosPorReferencia.mockResolvedValue([pagamentoMp()]);
        repo.registrarPagamentoCartao.mockResolvedValue(registrada);
        repo.atualizarStatus.mockResolvedValue({ ...registrada, status: 'pago' });

        const res = await service.consultar(3, CODIGO);

        expect(client.buscarPagamentosPorReferencia).toHaveBeenCalledWith(CONFIG, { accessToken: 'token-da-loja', codigo: CODIGO });
        expect(repo.registrarPagamentoCartao).toHaveBeenCalledWith({
            id: 7, empresa_id: 3, idExterno: '555', tipoCartao: 'credito', parcelas: 3
        });
        expect(repo.atualizarStatus).toHaveBeenCalledWith({ id: 7, empresa_id: 3, de: 'pendente', para: 'pago' });
        expect(res).toMatchObject({ status: 'pago', tipo_cartao: 'credito', parcelas: 3 });
    });

    test('débito fica sempre em 1 parcela, mesmo que o provedor informe outro número', async () => {
        repo.buscarPorCodigo.mockResolvedValueOnce(cobranca());
        client.buscarPagamentosPorReferencia.mockResolvedValue([pagamentoMp({ payment_type_id: 'debit_card', installments: 4 })]);
        repo.registrarPagamentoCartao.mockResolvedValue(cobranca({ id_externo: '555', tipo_cartao: 'debito', parcelas: 1 }));
        repo.atualizarStatus.mockResolvedValue(cobranca({ status: 'pago', tipo_cartao: 'debito', parcelas: 1 }));

        await service.consultar(3, CODIGO);

        expect(repo.registrarPagamentoCartao).toHaveBeenCalledWith(expect.objectContaining({ tipoCartao: 'debito', parcelas: 1 }));
    });

    test('sem pagamento aprovado a cobrança continua pendente e nada é gravado', async () => {
        repo.buscarPorCodigo.mockResolvedValueOnce(cobranca());
        client.buscarPagamentosPorReferencia.mockResolvedValue([pagamentoMp({ status: 'rejected' })]);

        const res = await service.consultar(3, CODIGO);

        expect(repo.registrarPagamentoCartao).not.toHaveBeenCalled();
        expect(repo.atualizarStatus).not.toHaveBeenCalled();
        expect(res.status).toBe('pendente');
    });

    test('cobrança de outra empresa não é encontrada (404)', async () => {
        repo.buscarPorCodigo.mockResolvedValue(null);
        await expect(service.consultar(99, CODIGO)).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('processarNotificacao de link de cartão', () => {
    test('liga o pagamento à cobrança pelo external_reference, com o token da loja do user_id', async () => {
        repo.buscarPorIdExterno.mockResolvedValue(null);
        mpRepo.buscarEmpresaPorMpUserId.mockResolvedValue({ empresa_id: 3 });
        client.buscarPagamento.mockResolvedValue(pagamentoMp());
        repo.buscarPorCodigo.mockResolvedValue(cobranca());
        client.buscarPagamentosPorReferencia.mockResolvedValue([pagamentoMp()]);
        repo.registrarPagamentoCartao.mockResolvedValue(cobranca({ id_externo: '555', tipo_cartao: 'credito', parcelas: 3 }));
        repo.atualizarStatus.mockResolvedValue(cobranca({ status: 'pago' }));

        const res = await service.processarNotificacao('555', { mpUserId: 123 });

        expect(mpRepo.buscarEmpresaPorMpUserId).toHaveBeenCalledWith('123');
        expect(mercadoPagoService.obterAccessToken).toHaveBeenCalledWith(3);
        expect(repo.buscarPorCodigo).toHaveBeenCalledWith(CODIGO, 3);
        expect(res).toEqual({ processada: true });
    });

    test.each([
        ['sem user_id', null, null],
        ['loja desconhecida', 123, null]
    ])('%s: ignora', async (_rotulo, mpUserId, conexao) => {
        repo.buscarPorIdExterno.mockResolvedValue(null);
        mpRepo.buscarEmpresaPorMpUserId.mockResolvedValue(conexao);

        expect(await service.processarNotificacao('555', { mpUserId })).toEqual({ processada: false });
        expect(client.buscarPagamento).not.toHaveBeenCalled();
    });

    test('pagamento sem referência nossa, de outra empresa ou de Pix é ignorado', async () => {
        repo.buscarPorIdExterno.mockResolvedValue(null);
        mpRepo.buscarEmpresaPorMpUserId.mockResolvedValue({ empresa_id: 3 });

        client.buscarPagamento.mockResolvedValue(pagamentoMp({ external_reference: 'texto-qualquer' }));
        expect(await service.processarNotificacao('555', { mpUserId: 1 })).toEqual({ processada: false });

        client.buscarPagamento.mockResolvedValue(pagamentoMp());
        repo.buscarPorCodigo.mockResolvedValue(null);
        expect(await service.processarNotificacao('555', { mpUserId: 1 })).toEqual({ processada: false });

        repo.buscarPorCodigo.mockResolvedValue(cobranca({ metodo: 'pix' }));
        expect(await service.processarNotificacao('555', { mpUserId: 1 })).toEqual({ processada: false });
        expect(repo.atualizarStatus).not.toHaveBeenCalled();
    });
});

describe('devolver', () => {
    test('devolução de cartão é recusada com 409 e não chama o provedor', async () => {
        repo.buscarPorCodigo.mockResolvedValue(cobranca({ status: 'pago' }));

        await expect(service.devolver({ empresa_id: 3, usuario_id: 9 }, CODIGO, { motivo: 'teste' })).rejects.toMatchObject({ statusCode: 409 });
        expect(client.devolverPagamento).not.toHaveBeenCalled();
    });
});

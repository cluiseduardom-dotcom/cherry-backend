jest.mock('../src/repositories/produtosRepository', () => ({
    buscarPorId: jest.fn()
}));

jest.mock('../src/repositories/produtosCodigosRepository', () => ({
    listarPorProduto: jest.fn(),
    buscarPorCodigo: jest.fn(),
    criar: jest.fn(),
    desativar: jest.fn()
}));

const produtosRepository = require('../src/repositories/produtosRepository');
const produtosCodigosRepository = require('../src/repositories/produtosCodigosRepository');
const service = require('../src/services/produtosCodigosService');

describe('produtosCodigosService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('aceita EAN-13 válido e normaliza separadores', async () => {
        produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
        produtosCodigosRepository.criar.mockResolvedValue({ id: 10, codigo: '7894900011517' });

        const result = await service.adicionar(1, {
            codigo: '789490001151-7',
            tipo: 'EAN_13',
            principal: true
        }, 5, 9);

        expect(result.codigo).toBe('7894900011517');
        expect(produtosCodigosRepository.criar).toHaveBeenCalledWith(expect.objectContaining({
            empresaId: 5,
            produtoId: 1,
            codigo: '7894900011517',
            tipo: 'EAN_13',
            principal: true,
            usuarioId: 9
        }));
    });

    test('rejeita EAN-13 com dígito verificador inválido', async () => {
        produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });

        await expect(service.adicionar(1, {
            codigo: '7894900011518',
            tipo: 'EAN_13'
        }, 5, 9)).rejects.toMatchObject({ statusCode: 400 });

        expect(produtosCodigosRepository.criar).not.toHaveBeenCalled();
    });

    test('permite código interno alfanumérico', async () => {
        produtosRepository.buscarPorId.mockResolvedValue({ id: 1 });
        produtosCodigosRepository.criar.mockResolvedValue({ id: 11, codigo: 'PROD-AZ-001' });

        await service.adicionar(1, {
            codigo: ' PROD-AZ-001 ',
            tipo: 'INTERNO'
        }, 5, 9);

        expect(produtosCodigosRepository.criar).toHaveBeenCalledWith(expect.objectContaining({
            codigo: 'PROD-AZ-001',
            tipo: 'INTERNO'
        }));
    });

    test('retorna 404 quando código não existe', async () => {
        produtosCodigosRepository.buscarPorCodigo.mockResolvedValue(null);

        await expect(service.buscarPorCodigo('7894900011517', 5))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

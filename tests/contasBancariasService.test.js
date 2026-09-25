jest.mock('../src/repositories/contasBancariasRepository', () => ({
    criar: jest.fn(),
    buscarPorId: jest.fn(),
    listar: jest.fn(),
    atualizarStatus: jest.fn()
}));

const repository = require('../src/repositories/contasBancariasRepository');
const service = require('../src/services/contasBancariasService');

describe('contasBancariasService', () => {
    beforeEach(() => jest.clearAllMocks());

    test('cria conta manual isolada por empresa', async () => {
        repository.criar.mockResolvedValue({ id: 1, nome: 'Banco Principal' });

        await expect(service.criar(
            {
                nome: 'Banco Principal',
                tipo: 'CONTA_CORRENTE',
                saldo_inicial: 1500
            },
            { empresa_id: 10, id: 7 }
        )).resolves.toEqual({ id: 1, nome: 'Banco Principal' });

        expect(repository.criar).toHaveBeenCalledWith(
            expect.objectContaining({
                empresa_id: 10,
                origem: 'MANUAL',
                saldo_inicial: 1500,
                usuario_id: 7
            })
        );
    });

    test('cria caixa sem dados bancários', async () => {
        repository.criar.mockResolvedValue({ id: 2, tipo: 'CAIXA' });

        await expect(service.criar(
            { nome: 'Caixa Loja', tipo: 'CAIXA' },
            { empresa_id: 20 }
        )).resolves.toEqual({ id: 2, tipo: 'CAIXA' });

        expect(repository.criar).toHaveBeenCalledWith(
            expect.objectContaining({ tipo: 'CAIXA', saldo_inicial: 0 })
        );
    });

    test('exige provedor para conta integrada', async () => {
        await expect(service.criar(
            { nome: 'Conta conectada', tipo: 'CONTA_CORRENTE', origem: 'OPEN_FINANCE' },
            { empresa_id: 10 }
        )).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('bloqueia saldo inicial inválido', async () => {
        await expect(service.criar(
            { nome: 'Conta', tipo: 'CONTA_CORRENTE', saldo_inicial: 'abc' },
            { empresa_id: 10 }
        )).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.criar).not.toHaveBeenCalled();
    });

    test('busca sempre pelo tenant', async () => {
        repository.buscarPorId.mockResolvedValue({ id: 5 });

        await expect(service.buscarPorId(5, { empresa_id: 99 }))
            .resolves.toEqual({ id: 5 });

        expect(repository.buscarPorId).toHaveBeenCalledWith(5, 99);
    });

    test('lista sempre pelo tenant', async () => {
        repository.listar.mockResolvedValue([]);

        await expect(service.listar({ status: 'ATIVA' }, { empresa_id: 99 }))
            .resolves.toEqual([]);

        expect(repository.listar).toHaveBeenCalledWith(99, { status: 'ATIVA' });
    });

    test('não permite conta inativa como principal', async () => {
        await expect(service.criar(
            { nome: 'Conta', tipo: 'CONTA_CORRENTE', principal: true, status: 'INATIVA' },
            { empresa_id: 10 }
        )).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.criar).not.toHaveBeenCalled();
    });
});

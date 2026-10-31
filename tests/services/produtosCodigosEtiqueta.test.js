jest.mock('../../src/repositories/produtosRepository');
jest.mock('../../src/repositories/produtosCodigosRepository');

const repo = require('../../src/repositories/produtosCodigosRepository');
const service = require('../../src/services/produtosCodigosService');

const erro23505 = () => Object.assign(new Error('duplicado'), { code: '23505' });

beforeEach(() => {
    jest.resetAllMocks();
    repo.idsDeProdutosDaEmpresa.mockImplementation(async (ids) => ids);
    repo.listarAtivosDeProdutos.mockResolvedValue([]);
    repo.criar.mockImplementation(async (d) => ({ codigo: d.codigo, tipo: d.tipo }));
});

describe('garantirCodigosParaEtiqueta', () => {
    test('produto sem código recebe INTERNO curto, principal, da empresa do JWT', async () => {
        const r = await service.garantirCodigosParaEtiqueta([42], 3, 9);

        expect(r).toEqual([{ produto_id: 42, codigo: '000042', tipo: 'INTERNO' }]);
        expect(repo.idsDeProdutosDaEmpresa).toHaveBeenCalledWith([42], 3);
        expect(repo.criar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 3, produtoId: 42, codigo: '000042', tipo: 'INTERNO', principal: true, usuarioId: 9 }));
    });

    test('produto que já tem código mantém o dele (principal primeiro) e nada é criado', async () => {
        repo.listarAtivosDeProdutos.mockResolvedValue([
            { produto_id: 42, codigo: '7891234567895', tipo: 'EAN_13', principal: true },
            { produto_id: 42, codigo: '000042', tipo: 'INTERNO', principal: false }
        ]);

        const r = await service.garantirCodigosParaEtiqueta([42], 3, 9);

        expect(r).toEqual([{ produto_id: 42, codigo: '7891234567895', tipo: 'EAN_13' }]);
        expect(repo.criar).not.toHaveBeenCalled();
    });

    test('é idempotente por pedido: ids repetidos viram um só', async () => {
        const r = await service.garantirCodigosParaEtiqueta([5, 5, 5], 3, 9);

        expect(r).toHaveLength(1);
        expect(repo.criar).toHaveBeenCalledTimes(1);
    });

    test('produto de outra empresa (ou inexistente) => 404 e nada é criado', async () => {
        repo.idsDeProdutosDaEmpresa.mockResolvedValue([1]);

        await expect(service.garantirCodigosParaEtiqueta([1, 2], 3, 9)).rejects.toMatchObject({ statusCode: 404 });
        expect(repo.criar).not.toHaveBeenCalled();
    });

    test('código curto já usado por outro produto cai no candidato longo', async () => {
        repo.criar.mockRejectedValueOnce(erro23505()).mockImplementationOnce(async (d) => ({ codigo: d.codigo, tipo: d.tipo }));

        const r = await service.garantirCodigosParaEtiqueta([42], 3, 9);

        expect(r[0].codigo).toBe('I00000042');
    });

    test('corrida: outro pedido criou o código agora, usa o que ficou', async () => {
        repo.criar.mockRejectedValueOnce(erro23505());
        repo.listarAtivosDeProdutos
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ produto_id: 42, codigo: '000042', tipo: 'INTERNO', principal: true }]);

        const r = await service.garantirCodigosParaEtiqueta([42], 3, 9);

        expect(r).toEqual([{ produto_id: 42, codigo: '000042', tipo: 'INTERNO' }]);
        expect(repo.criar).toHaveBeenCalledTimes(1);
    });

    test.each([[[]], [null], [[0]], [[-1]], [[1.5]], [['7']], [Array.from({ length: 201 }, (_, i) => i + 1)]])('entrada inválida %#', async (entrada) => {
        await expect(service.garantirCodigosParaEtiqueta(entrada, 3, 9)).rejects.toMatchObject({ statusCode: 400 });
        expect(repo.criar).not.toHaveBeenCalled();
    });

    test('erro que não é de duplicidade sobe sem engolir', async () => {
        repo.criar.mockRejectedValue(new Error('banco caiu'));

        await expect(service.garantirCodigosParaEtiqueta([42], 3, 9)).rejects.toThrow('banco caiu');
    });
});

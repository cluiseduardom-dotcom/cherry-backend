jest.mock('../../src/repositories/locaisEstoqueRepository');

const repo = require('../../src/repositories/locaisEstoqueRepository');
const service = require('../../src/services/locaisEstoqueService');

const usuario = (role, id = 1) => ({ id, role, empresa_id: 7 });

beforeEach(() => {
    jest.resetAllMocks();
    repo.listarVisiveis.mockResolvedValue([]);
    repo.saldosDoLocal.mockResolvedValue({ items: [], total: 0 });
});

describe('listar', () => {
    test.each(['admin', 'estoquista'])('%s lista todos os locais da empresa', async (role) => {
        await service.listar(usuario(role, 4));
        expect(repo.listarVisiveis).toHaveBeenCalledWith({ empresa_id: 7, usuario_id: undefined });
    });

    test('vendedor é restrito ao próprio usuário', async () => {
        await service.listar(usuario('vendedor', 4));
        expect(repo.listarVisiveis).toHaveBeenCalledWith({ empresa_id: 7, usuario_id: 4 });
    });
});

describe('saldos', () => {
    const maleta = { id: 5, tipo: 'maleta', nome: 'M', usuario_id: 10 };

    test('dono vê a própria maleta e a empresa vem do token', async () => {
        repo.obterLocal.mockResolvedValue(maleta);
        const r = await service.saldos(5, { page: 2, pageSize: 10, busca: 'an' }, usuario('vendedor', 10));
        expect(repo.obterLocal).toHaveBeenCalledWith(7, 5);
        expect(repo.saldosDoLocal).toHaveBeenCalledWith({ empresa_id: 7, local_id: 5, busca: 'an', limit: 10, offset: 10 });
        expect(r.local).toMatchObject({ id: 5, tipo: 'maleta' });
    });

    test.each([['vendedor', usuario('vendedor', 10)], ['estoquista', usuario('estoquista')], ['admin', usuario('admin')]])(
        'Central: %s lê o saldo',
        async (_, quem) => {
            repo.obterLocal.mockResolvedValue({ id: 1, tipo: 'central', nome: 'Central', usuario_id: null });
            const r = await service.saldos(1, { page: 1, pageSize: 10 }, quem);
            expect(repo.saldosDoLocal).toHaveBeenCalledWith({ empresa_id: 7, local_id: 1, busca: undefined, limit: 10, offset: 0 });
            expect(r.local).toMatchObject({ id: 1, tipo: 'central' });
        }
    );

    test.each([
        ['outro vendedor', maleta, usuario('vendedor', 11)],
        ['local inexistente', null, usuario('admin')],
        ['Em trânsito, mesmo para o admin', { id: 9, tipo: 'transito' }, usuario('admin')],
        ['consignado para vendedor', { id: 3, tipo: 'consignado' }, usuario('vendedor', 10)]
    ])('404 para %s', async (_, local, quem) => {
        repo.obterLocal.mockResolvedValue(local);
        await expect(service.saldos(5, { page: 1, pageSize: 10 }, quem)).rejects.toMatchObject({ statusCode: 404 });
        expect(repo.saldosDoLocal).not.toHaveBeenCalled();
    });
});

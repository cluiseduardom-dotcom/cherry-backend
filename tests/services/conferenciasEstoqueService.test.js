jest.mock('../../src/repositories/conferenciasEstoqueRepository');

const repo = require('../../src/repositories/conferenciasEstoqueRepository');
const service = require('../../src/services/conferenciasEstoqueService');

const usuario = (role, id = 1) => ({ id, role, empresa_id: 7 });
const maleta = { id: 5, tipo: 'maleta', nome: 'Maleta X', usuario_id: 10 };
const corpo = { itens: [{ produto_id: 1, quantidade_contada: 2 }], observacao: undefined, aplicar_ajuste: false };

beforeEach(() => {
    jest.resetAllMocks();
    repo.obterLocal.mockResolvedValue(maleta);
    repo.acerto.mockResolvedValue({ itens: [], totais: {}, confere: true });
    repo.criarConferencia.mockResolvedValue({ id: 1 });
    repo.listarConferencias.mockResolvedValue({ items: [], total: 0 });
});

describe('visibilidade (acerto e listagem)', () => {
    test.each(['admin', 'estoquista'])('%s vê qualquer local da empresa', async (role) => {
        await expect(service.acerto(5, {}, usuario(role, 99))).resolves.toMatchObject({ local: { id: 5 } });
        expect(repo.obterLocal).toHaveBeenCalledWith(7, 5);
    });

    test('dono da maleta vê a própria', async () => {
        await expect(service.acerto(5, {}, usuario('vendedor', 10))).resolves.toBeDefined();
        await expect(service.listarConferencias(5, { page: 1, pageSize: 20 }, usuario('vendedor', 10))).resolves.toBeDefined();
    });

    test('outro vendedor e local inexistente respondem 404', async () => {
        await expect(service.acerto(5, {}, usuario('vendedor', 11))).rejects.toMatchObject({ statusCode: 404 });
        repo.obterLocal.mockResolvedValue(null);
        await expect(service.acerto(5, {}, usuario('admin'))).rejects.toMatchObject({ statusCode: 404 });
        expect(repo.acerto).not.toHaveBeenCalled();
    });

    test('vendedor não vê consignado', async () => {
        repo.obterLocal.mockResolvedValue({ id: 6, tipo: 'consignado', usuario_id: null });
        await expect(service.acerto(6, {}, usuario('vendedor', 10))).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('criarConferencia', () => {
    test('vendedor não registra (403) nem na própria maleta', async () => {
        await expect(service.criarConferencia(5, corpo, usuario('vendedor', 10))).rejects.toMatchObject({ statusCode: 403 });
        expect(repo.criarConferencia).not.toHaveBeenCalled();
    });

    test('estoquista registra, mas não aplica ajuste', async () => {
        await service.criarConferencia(5, corpo, usuario('estoquista'));
        await expect(service.criarConferencia(5, { ...corpo, aplicar_ajuste: true }, usuario('estoquista'))).rejects.toMatchObject({ statusCode: 403 });
        expect(repo.criarConferencia).toHaveBeenCalledTimes(1);
    });

    test('admin aplica ajuste; empresa e usuário vêm do token', async () => {
        await service.criarConferencia(5, { ...corpo, aplicar_ajuste: true }, usuario('admin', 3));
        expect(repo.criarConferencia).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: 7, usuario_id: 3, local_id: 5, aplicar_ajuste: true }));
    });
});

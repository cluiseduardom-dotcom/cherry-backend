jest.mock('../../src/repositories/transferenciasEstoqueRepository');

const repo = require('../../src/repositories/transferenciasEstoqueRepository');
const service = require('../../src/services/transferenciasEstoqueService');

const equipe = { id: 1, role: 'estoquista', empresa_id: 4 };
const admin = { id: 2, role: 'admin', empresa_id: 4 };
const vendedor = { id: 3, role: 'vendedor', empresa_id: 4 };
const central = { id: 10, tipo: 'central', usuario_id: null };
const maletaDoVendedor = { id: 11, tipo: 'maleta', usuario_id: 3 };
const maletaAlheia = { id: 12, tipo: 'maleta', usuario_id: 9 };
const consignado = { id: 13, tipo: 'consignado', usuario_id: null };

beforeEach(() => {
    jest.clearAllMocks();
    repo.criar.mockResolvedValue(77);
    repo.resolver.mockResolvedValue(77);
    repo.obter.mockResolvedValue({ id: 77 });
});

// Roda a regra de autorização que o service entrega ao repositório.
const autorizacaoDeCriar = () => repo.criar.mock.calls[0][0].autorizar;
const autorizacaoDeResolver = () => repo.resolver.mock.calls[0][0].autorizar;
const dados = { origem_local_id: 10, destino_local_id: 11, itens: [{ produto_id: 1, quantidade: 1 }] };

describe('criar: quem pode enviar', () => {
    test('usa a empresa e o usuário do token, nunca do corpo', async () => {
        await service.criar({ ...dados, empresa_id: 999 }, equipe);

        expect(repo.criar).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: 4, usuario_id: 1 }));
    });

    test('equipe envia de/para qualquer local', async () => {
        await service.criar(dados, equipe);
        expect(() => autorizacaoDeCriar()(central, maletaDoVendedor)).not.toThrow();
        expect(() => autorizacaoDeCriar()(maletaAlheia, consignado)).not.toThrow();
    });

    test('vendedor só devolve da PRÓPRIA maleta ao Central', async () => {
        await service.criar(dados, vendedor);
        const autorizar = autorizacaoDeCriar();

        expect(() => autorizar(maletaDoVendedor, central)).not.toThrow();
        expect(() => autorizar(central, maletaDoVendedor)).toThrow(expect.objectContaining({ statusCode: 403 }));
        expect(() => autorizar(maletaAlheia, central)).toThrow(expect.objectContaining({ statusCode: 403 }));
        expect(() => autorizar(maletaDoVendedor, maletaAlheia)).toThrow(expect.objectContaining({ statusCode: 403 }));
        expect(() => autorizar(maletaDoVendedor, consignado)).toThrow(expect.objectContaining({ statusCode: 403 }));
    });
});

describe('resolver: quem pode responder', () => {
    test('destino maleta: só o dono aceita ou recusa (nem admin, nem equipe)', async () => {
        await service.resolver('aceitar', 77, undefined, vendedor);
        const autorizar = autorizacaoDeResolver();
        const t = { criado_por: 1, destino: maletaDoVendedor, origem: central };

        expect(() => autorizar(t)).not.toThrow();

        for (const ator of [admin, equipe]) {
            jest.clearAllMocks();
            await service.resolver('aceitar', 77, undefined, ator);
            expect(() => autorizacaoDeResolver()(t)).toThrow(expect.objectContaining({ statusCode: 403 }));
        }
    });

    test('destino Central ou consignado: só a equipe responde', async () => {
        await service.resolver('aceitar', 77, undefined, equipe);
        expect(() => autorizacaoDeResolver()({ criado_por: 3, destino: central })).not.toThrow();
        expect(() => autorizacaoDeResolver()({ criado_por: 3, destino: consignado })).not.toThrow();

        jest.clearAllMocks();
        await service.resolver('recusar', 77, 'motivo ok', vendedor);
        expect(() => autorizacaoDeResolver()({ criado_por: 3, destino: central })).toThrow(expect.objectContaining({ statusCode: 403 }));
    });

    test('cancelar: só quem criou ou o admin', async () => {
        await service.resolver('cancelar', 77, 'engano de envio', equipe);
        const t = { criado_por: 1, destino: maletaDoVendedor };
        expect(() => autorizacaoDeResolver()(t)).not.toThrow();

        jest.clearAllMocks();
        await service.resolver('cancelar', 77, 'engano de envio', admin);
        expect(() => autorizacaoDeResolver()(t)).not.toThrow();

        jest.clearAllMocks();
        await service.resolver('cancelar', 77, 'engano de envio', { ...equipe, id: 50 });
        expect(() => autorizacaoDeResolver()(t)).toThrow(expect.objectContaining({ statusCode: 403 }));
    });

    test('passa o motivo e o usuário do token ao repositório', async () => {
        await service.resolver('recusar', 77, 'Peças erradas', vendedor);

        expect(repo.resolver).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: 4, id: 77, acao: 'recusar', usuario_id: 3, motivo: 'Peças erradas' }));
    });
});

describe('visibilidade', () => {
    test('listar: equipe vê tudo; os demais só o que é deles', async () => {
        repo.listar.mockResolvedValue({ items: [], total: 0 });

        await service.listar({ page: 1, pageSize: 20 }, equipe);
        expect(repo.listar.mock.calls[0][0].usuario_id).toBeUndefined();

        await service.listar({ page: 2, pageSize: 10 }, vendedor);
        expect(repo.listar.mock.calls[1][0]).toMatchObject({ usuario_id: 3, limit: 10, offset: 10, empresa_id: 4 });
    });

    test('obter: transferência inexistente ou alheia = 404', async () => {
        repo.obter.mockResolvedValueOnce(null);
        await expect(service.obter(1, equipe)).rejects.toMatchObject({ statusCode: 404 });

        repo.obter.mockResolvedValueOnce({ id: 1, criado_por: 1, origem_usuario_id: null, destino_usuario_id: 9 });
        await expect(service.obter(1, vendedor)).rejects.toMatchObject({ statusCode: 404 });

        repo.obter.mockResolvedValueOnce({ id: 1, criado_por: 1, origem_usuario_id: null, destino_usuario_id: 3 });
        await expect(service.obter(1, vendedor)).resolves.toMatchObject({ id: 1 });
    });
});

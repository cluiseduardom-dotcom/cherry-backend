jest.mock('../../src/repositories/produtosRepository');
jest.mock('../../src/repositories/produtoImagensRepository');
jest.mock('../../src/services/storage/imagensStorage');

const produtosRepository = require('../../src/repositories/produtosRepository');
const imagensRepository = require('../../src/repositories/produtoImagensRepository');
const storage = require('../../src/services/storage/imagensStorage');
const service = require('../../src/services/produtoImagensService');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

beforeEach(() => {
    jest.resetAllMocks();
    storage.configurado.mockReturnValue(true);
    storage.urlPublica.mockImplementation((chave) => `https://fotos.exemplo.test/${chave}`);
    storage.enviar.mockResolvedValue();
    storage.remover.mockResolvedValue();
    produtosRepository.buscarPorId.mockResolvedValue({ id: 7, empresa_id: 3 });
});

describe('adicionar', () => {
    test('envia ao bucket com chave da empresa do JWT e grava a linha', async () => {
        imagensRepository.inserir.mockImplementation(async (d) => ({ id: 1, ordem: 0, content_type: d.content_type, tamanho_bytes: d.tamanho_bytes, chave: d.chave }));

        const r = await service.adicionar(7, { buffer: jpeg }, 3, 9);

        const { chave, contentType } = storage.enviar.mock.calls[0][0];
        expect(chave).toMatch(/^3\/produtos\/7\/[0-9a-f-]{36}\.jpg$/);
        expect(contentType).toBe('image/jpeg');
        expect(imagensRepository.inserir).toHaveBeenCalledWith(expect.objectContaining({ produto_id: 7, empresa_id: 3, criado_por: 9, limite: 5, content_type: 'image/jpeg' }));
        expect(r).toEqual({ id: 1, url: `https://fotos.exemplo.test/${chave}`, ordem: 0, principal: true, content_type: 'image/jpeg', tamanho_bytes: jpeg.length });
    });

    test('412 quando o armazenamento não está configurado, sem tocar no banco', async () => {
        storage.configurado.mockReturnValue(false);
        await expect(service.adicionar(7, { buffer: jpeg }, 3, 9)).rejects.toMatchObject({ statusCode: 412 });
        expect(storage.enviar).not.toHaveBeenCalled();
        expect(imagensRepository.inserir).not.toHaveBeenCalled();
    });

    test('400 sem arquivo e para conteúdo que não é JPEG/PNG/WebP (mesmo chamando de .jpg)', async () => {
        await expect(service.adicionar(7, undefined, 3, 9)).rejects.toMatchObject({ statusCode: 400 });
        await expect(service.adicionar(7, { buffer: Buffer.from('<svg></svg>'.padEnd(40, ' ')) }, 3, 9)).rejects.toMatchObject({ statusCode: 400 });
        expect(storage.enviar).not.toHaveBeenCalled();
    });

    test('413 acima de 2 MB', async () => {
        const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]);
        await expect(service.adicionar(7, { buffer: grande }, 3, 9)).rejects.toMatchObject({ statusCode: 413 });
        expect(storage.enviar).not.toHaveBeenCalled();
    });

    test('404 para produto de outra empresa, antes de enviar qualquer coisa', async () => {
        produtosRepository.buscarPorId.mockResolvedValue(null);
        await expect(service.adicionar(7, { buffer: jpeg }, 3, 9)).rejects.toMatchObject({ statusCode: 404 });
        expect(produtosRepository.buscarPorId).toHaveBeenCalledWith(7, 3);
        expect(storage.enviar).not.toHaveBeenCalled();
    });

    test('galeria cheia (409): apaga o objeto que acabou de enviar e repassa o erro', async () => {
        imagensRepository.inserir.mockRejectedValue(Object.assign(new Error('cheia'), { statusCode: 409 }));
        await expect(service.adicionar(7, { buffer: jpeg }, 3, 9)).rejects.toMatchObject({ statusCode: 409 });
        expect(storage.remover).toHaveBeenCalledWith(storage.enviar.mock.calls[0][0].chave);
    });
});

describe('remover', () => {
    test('apaga a linha e depois o objeto', async () => {
        imagensRepository.remover.mockResolvedValue({ id: 4, chave: '3/produtos/7/x.jpg' });
        expect(await service.remover(7, 4, 3)).toEqual({ id: 4 });
        expect(imagensRepository.remover).toHaveBeenCalledWith(4, 7, 3);
        expect(storage.remover).toHaveBeenCalledWith('3/produtos/7/x.jpg');
    });

    test('falha no bucket não desfaz a remoção da foto', async () => {
        imagensRepository.remover.mockResolvedValue({ id: 4, chave: 'k' });
        storage.remover.mockRejectedValue(new Error('rede'));
        await expect(service.remover(7, 4, 3)).resolves.toEqual({ id: 4 });
    });
});

describe('listar e reordenar', () => {
    test('listar marca a primeira como principal e 404 para produto alheio', async () => {
        imagensRepository.listarPorProduto.mockResolvedValue([
            { id: 1, ordem: 0, chave: 'a', content_type: 'image/png', tamanho_bytes: 10 },
            { id: 2, ordem: 1, chave: 'b', content_type: 'image/png', tamanho_bytes: 10 }
        ]);
        const r = await service.listar(7, 3);
        expect(r.map((i) => i.principal)).toEqual([true, false]);

        produtosRepository.buscarPorId.mockResolvedValue(null);
        await expect(service.listar(7, 3)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('reordenar delega ao repository com a empresa do JWT', async () => {
        imagensRepository.reordenar.mockResolvedValue([{ id: 2, ordem: 0, chave: 'b', content_type: 'image/png', tamanho_bytes: 10 }]);
        const r = await service.reordenar(7, [2], 3);
        expect(imagensRepository.reordenar).toHaveBeenCalledWith(7, 3, [2]);
        expect(r[0]).toMatchObject({ id: 2, principal: true });
    });
});

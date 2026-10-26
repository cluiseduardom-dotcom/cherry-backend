const { detectarTipo, extensaoDoTipo, MAX_BYTES, MAX_IMAGENS_POR_PRODUTO } = require('../../src/utils/imagemProduto');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(10)]);

describe('imagemProduto', () => {
    test('reconhece JPEG, PNG e WebP pelo conteúdo', () => {
        expect(detectarTipo(jpeg)).toBe('image/jpeg');
        expect(detectarTipo(png)).toBe('image/png');
        expect(detectarTipo(webp)).toBe('image/webp');
    });

    test('recusa o que não é foto, mesmo com cara de imagem', () => {
        expect(detectarTipo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
        expect(detectarTipo(Buffer.from('GIF89a' + 'x'.repeat(20)))).toBeNull();
        expect(detectarTipo(Buffer.from('%PDF-1.7' + 'x'.repeat(20)))).toBeNull();
        expect(detectarTipo(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(10)]))).toBeNull();
    });

    test('recusa vazio, curto demais e valores que não são Buffer', () => {
        expect(detectarTipo(Buffer.alloc(0))).toBeNull();
        expect(detectarTipo(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
        expect(detectarTipo('texto')).toBeNull();
        expect(detectarTipo(null)).toBeNull();
    });

    test('extensão vem do tipo detectado e limites estão nos valores combinados', () => {
        expect(extensaoDoTipo('image/jpeg')).toBe('jpg');
        expect(extensaoDoTipo('image/png')).toBe('png');
        expect(extensaoDoTipo('image/webp')).toBe('webp');
        expect(extensaoDoTipo('image/gif')).toBeNull();
        expect(MAX_BYTES).toBe(2 * 1024 * 1024);
        expect(MAX_IMAGENS_POR_PRODUTO).toBe(5);
    });
});

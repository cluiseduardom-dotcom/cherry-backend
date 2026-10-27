const { gerarSenhaTemporaria } = require('../../src/utils/senhaTemporaria');

describe('gerarSenhaTemporaria', () => {
    test('12 caracteres, sem ambíguos (0 O 1 l I) e diferente a cada chamada', () => {
        const senhas = Array.from({ length: 50 }, () => gerarSenhaTemporaria());

        senhas.forEach((s) => expect(s).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/));
        expect(new Set(senhas).size).toBe(50);
    });

    test('respeita o tamanho pedido', () => {
        expect(gerarSenhaTemporaria(20)).toHaveLength(20);
    });
});

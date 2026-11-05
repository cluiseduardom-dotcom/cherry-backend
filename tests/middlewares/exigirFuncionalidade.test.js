const exigirFuncionalidade = require('../../src/middlewares/exigirFuncionalidade');

const chamar = (funcionalidade, req) => {
    const next = jest.fn();
    exigirFuncionalidade(funcionalidade)(req, {}, next);
    return next;
};

describe('exigirFuncionalidade', () => {
    test('recusa na montagem uma funcionalidade fora do catálogo', () => {
        expect(() => exigirFuncionalidade('inexistente')).toThrow('Funcionalidade desconhecida');
    });

    test.each([
        ['sem usuário', {}],
        ['sem lista', { usuario: { id: 1, role: 'admin' } }],
        ['lista que não é array', { usuario: { id: 1, funcionalidades: 'bancos' } }],
        ['lista vazia', { usuario: { id: 1, funcionalidades: [] } }],
        ['outra funcionalidade ligada', { usuario: { id: 1, funcionalidades: ['comissoes'] } }]
    ])('403 fechado: %s', (_rotulo, req) => {
        const erro = chamar('bancos', req).mock.calls[0][0];

        expect(erro.statusCode).toBe(403);
        expect(erro.message).toBe(exigirFuncionalidade.MENSAGEM);
    });

    test('403 também para admin quando a funcionalidade não está ligada', () => {
        const erro = chamar('maletas', { usuario: { id: 1, role: 'admin', funcionalidades: [] } }).mock.calls[0][0];

        expect(erro.statusCode).toBe(403);
    });

    test('libera quando a funcionalidade está na lista', () => {
        const next = chamar('bancos', { usuario: { id: 1, role: 'vendedor', funcionalidades: ['bancos', 'maletas'] } });

        expect(next).toHaveBeenCalledWith();
    });
});

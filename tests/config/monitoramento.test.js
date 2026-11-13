const { limparEvento, mascarar, iniciarMonitoramento, registrarErro } = require('../../src/config/monitoramento');

describe('mascarar: nenhum dado pessoal sai na mensagem', () => {
    test.each([
        ['Cliente maria.silva@exemplo.com.br não encontrado', '[email]'],
        ['CPF 123.456.789-09 inválido', '[cpf]'],
        ['CNPJ 12.345.678/0001-95 duplicado', '[cnpj]'],
        ['Telefone (11) 91234-5678 recusado', '[telefone]'],
        ['Falha com Bearer eyJhbGciOi.abc.def na chamada', 'Bearer [token]'],
        ['connect failed postgres://usuario:segredo@host:5432/db', '[url-banco]']
    ])('%s', (entrada, esperado) => {
        const saida = mascarar(entrada);

        expect(saida).toContain(esperado);
        expect(saida).not.toMatch(/maria\.silva|123\.456\.789|12\.345\.678|91234|eyJhbGci|segredo/);
    });

    test('mensagem comprida é cortada', () => {
        expect(mascarar('x'.repeat(1000)).length).toBeLessThan(310);
    });
});

describe('limparEvento', () => {
    const bruto = {
        message: 'Erro para joao@x.com',
        user: { id: 7, email: 'joao@x.com', ip_address: '1.2.3.4' },
        extra: { corpo: { cpf: '123.456.789-09' } },
        breadcrumbs: [{ message: 'log com dado' }],
        request: { method: 'POST', url: 'https://api.exemplo/clientes?email=a@b.com', headers: { authorization: 'Bearer abc' }, cookies: { s: '1' }, data: { senha: 'x' }, query_string: 'email=a@b.com' },
        exception: { values: [{ type: 'Error', value: 'duplicate key (email)=(maria@x.com)' }] }
    };

    test('remove usuário, extra, breadcrumbs, cabeçalhos, cookies, corpo e query', () => {
        const limpo = limparEvento(bruto);

        expect(limpo.user).toBeUndefined();
        expect(limpo.extra).toBeUndefined();
        expect(limpo.breadcrumbs).toEqual([]);
        expect(limpo.request).toEqual({ method: 'POST', url: 'https://api.exemplo/clientes' });
        expect(JSON.stringify(limpo)).not.toMatch(/joao@x|maria@x|123\.456|Bearer abc|senha|1\.2\.3\.4|a@b\.com/);
    });

    test('não altera o objeto original e aceita entrada vazia', () => {
        limparEvento(bruto);

        expect(bruto.user).toBeDefined();
        expect(limparEvento(null)).toBeNull();
    });
});

describe('sem SENTRY_DSN nada é ligado nem enviado', () => {
    test('iniciarMonitoramento devolve false e registrarErro não faz nada', () => {
        expect(iniciarMonitoramento({})).toBe(false);
        expect(iniciarMonitoramento({ SENTRY_DSN: '   ' })).toBe(false);
        expect(registrarErro(new Error('x'))).toBe(false);
    });
});

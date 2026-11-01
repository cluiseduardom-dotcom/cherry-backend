'use strict';

const { Readable } = require('node:stream');
const {
    lerAmbiente, validarDados, resumo, confirmacaoValida, mensagemDeErro, enviar, criarPerguntador, coletarDados,
} = require('../../scripts/provisionar-tenant');

describe('provisionar-tenant: ambiente', () => {
    test('exige PROVISION_API_URL válida', () => {
        expect(() => lerAmbiente({})).toThrow(/PROVISION_API_URL/);
        expect(() => lerAmbiente({ PROVISION_API_URL: 'nao-e-url', ONBOARDING_SECRET: 'x' })).toThrow(/válida/);
    });

    test('remoto exige https e segredo', () => {
        expect(() => lerAmbiente({ PROVISION_API_URL: 'http://api.exemplo.com', ONBOARDING_SECRET: 'x' })).toThrow(/https/);
        expect(() => lerAmbiente({ PROVISION_API_URL: 'https://api.exemplo.com' })).toThrow(/ONBOARDING_SECRET/);
    });

    test('remoto https com segredo: normaliza para origin e não é local', () => {
        const d = lerAmbiente({ PROVISION_API_URL: 'https://api.exemplo.com/qualquer/caminho', ONBOARDING_SECRET: ' s3 ' });
        expect(d).toEqual({ base: 'https://api.exemplo.com', host: 'api.exemplo.com', local: false, segredo: 's3' });
    });

    test('localhost aceita http e dispensa o segredo', () => {
        const d = lerAmbiente({ PROVISION_API_URL: 'http://localhost:3000' });
        expect(d.local).toBe(true);
        expect(d.segredo).toBe('');
    });
});

describe('provisionar-tenant: validação e resumo', () => {
    const ok = { empresa_nome: 'Valvazori Imports', cnpj: '', nome_admin: 'Fulano', email_admin: ' Fulano@Exemplo.com ', senha_admin: 'senha-forte-123' };

    test('usa o schema do backend: normaliza e-mail e descarta CNPJ vazio', () => {
        const corpo = validarDados(ok);
        expect(corpo.email_admin).toBe('fulano@exemplo.com');
        expect(corpo).not.toHaveProperty('cnpj');
    });

    test('recusa senha curta, e-mail inválido e nome curto', () => {
        expect(() => validarDados({ ...ok, senha_admin: 'curta' })).toThrow(/8 caracteres/);
        expect(() => validarDados({ ...ok, email_admin: 'x' })).toThrow(/inválido/);
        expect(() => validarDados({ ...ok, empresa_nome: 'A' })).toThrow(/Nome da empresa/);
    });

    test('o resumo nunca contém a senha', () => {
        const texto = resumo(validarDados(ok), { base: 'https://x.com', local: false });
        expect(texto).not.toContain('senha-forte-123');
        expect(texto).toContain('(oculta)');
    });
});

describe('provisionar-tenant: confirmação', () => {
    test('remoto: só vale digitar o host do servidor', () => {
        const d = { host: 'api.exemplo.com', local: false };
        expect(confirmacaoValida(d, 'api.exemplo.com')).toBe(true);
        expect(confirmacaoValida(d, ' API.exemplo.com ')).toBe(true);
        expect(confirmacaoValida(d, 's')).toBe(false);
        expect(confirmacaoValida(d, '')).toBe(false);
    });

    test('local: "s" confirma', () => {
        const d = { host: 'localhost:3000', local: true };
        expect(confirmacaoValida(d, 's')).toBe(true);
        expect(confirmacaoValida(d, 'n')).toBe(false);
        expect(confirmacaoValida(d, '')).toBe(false);
    });
});

describe('provisionar-tenant: envio', () => {
    const corpo = { empresa_nome: 'Valvazori Imports', nome_admin: 'F', email_admin: 'a@b.com', senha_admin: 'senha-forte-123' };
    const destino = { base: 'https://api.exemplo.com', segredo: 'segredo-x', local: false };

    test('envia o segredo no cabeçalho, descarta o token e devolve só empresa e usuário', async () => {
        const chamadas = [];
        const fetchFalso = async (url, init) => {
            chamadas.push({ url, init });
            return { ok: true, status: 201, json: async () => ({ success: true, data: { token: 'TOKEN-SECRETO', empresa: { id: 2, nome: 'V' }, usuario: { id: 9, email: 'a@b.com' } } }) };
        };
        const r = await enviar(destino, corpo, fetchFalso);
        expect(chamadas[0].url).toBe('https://api.exemplo.com/onboarding');
        expect(chamadas[0].init.headers['X-Onboarding-Secret']).toBe('segredo-x');
        expect(r).toEqual({ empresa: { id: 2, nome: 'V' }, usuario: { id: 9, email: 'a@b.com' } });
        expect(JSON.stringify(r)).not.toContain('TOKEN-SECRETO');
    });

    test('local sem segredo não manda o cabeçalho', async () => {
        let init;
        await enviar({ base: 'http://localhost:3000', segredo: '', local: true }, corpo, async (_u, i) => {
            init = i;
            return { ok: true, status: 201, json: async () => ({ data: {} }) };
        });
        expect(init.headers).not.toHaveProperty('X-Onboarding-Secret');
    });

    test.each([[401, /segredo/], [503, /não está configurado/], [409, /e-mail/], [429, /Limite/]])(
        'status %i vira mensagem clara', async (status, regex) => {
            const fetchFalso = async () => ({ ok: false, status, json: async () => ({}) });
            await expect(enviar(destino, corpo, fetchFalso)).rejects.toThrow(regex);
        }
    );

    test('mensagemDeErro inclui o detalhe do backend nos demais casos', () => {
        expect(mensagemDeErro(400, { message: 'Email do administrador inválido' })).toBe('Falha 400: Email do administrador inválido');
        expect(mensagemDeErro(500, null)).toBe('Falha 500');
    });
});

describe('provisionar-tenant: perguntas pela entrada padrão (sem terminal)', () => {
    function entrada(linhas) {
        const r = Readable.from([`${linhas.join('\n')}\n`]);
        r.isTTY = false;
        return r;
    }
    const saidaFalsa = () => {
        const partes = [];
        return { write: (t) => { partes.push(String(t)); return true; }, partes };
    };

    test('coleta os campos na ordem e não ecoa a senha', async () => {
        const saida = saidaFalsa();
        const p = criarPerguntador(entrada(['Valvazori Imports', '', 'Fulano', 'a@b.com', 'senha-forte-123', 'senha-forte-123']), saida);
        const dados = await coletarDados(p);
        p.fechar();
        expect(dados).toEqual({ empresa_nome: 'Valvazori Imports', cnpj: '', nome_admin: 'Fulano', email_admin: 'a@b.com', senha_admin: 'senha-forte-123' });
        expect(saida.partes.join('')).not.toContain('senha-forte-123');
    });

    test('senhas diferentes abortam', async () => {
        const p = criarPerguntador(entrada(['V', '', 'F', 'a@b.com', 'senha-forte-123', 'outra-senha-123']), saidaFalsa());
        await expect(coletarDados(p)).rejects.toThrow(/não conferem/);
        p.fechar();
    });
});

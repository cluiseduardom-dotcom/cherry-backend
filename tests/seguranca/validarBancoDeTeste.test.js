const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    validarBancoDeTeste,
    lerUrlsDoArquivoEnv,
    lerUrlsCompartilhadas,
    formatarFalha,
    interpretarUrl,
} = require('./validarBancoDeTeste');

// Hosts FICTÍCIOS que imitam os bancos compartilhados (dev e produção) de um provedor remoto.
const DEV_COMPARTILHADO = 'postgresql://app:segredo-dev@ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';
const PRODUCAO = 'postgresql://app:segredo-prod@ep-exemplo-prod.sa-east-1.aws.neon.tech/neondb?sslmode=require';
const BANCO_LOCAL_DE_TESTE = 'postgresql://cherry:cherry@localhost:5432/cherry_test';

describe('banco de testes ausente ou inválido', () => {
    test('TEST_DATABASE_URL ausente: bloqueia com mensagem clara (sem usar DATABASE_URL como alternativa)', () => {
        const r = validarBancoDeTeste({ testUrl: undefined, env: { DATABASE_URL: BANCO_LOCAL_DE_TESTE }, urlsCompartilhadas: [] });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/TEST_DATABASE_URL não está definida/);
        expect(r.motivo).toMatch(/nunca são usados/);
    });

    test.each(['', '   ', null])('valor vazio (%p) é tratado como ausente', (valor) => {
        expect(validarBancoDeTeste({ testUrl: valor }).ok).toBe(false);
    });

    test.each(['isto não é uma url', 'http://localhost/cherry_test', 'mysql://u:p@localhost/cherry_test', 'postgresql://'])(
        'URL inválida ou de outro protocolo (%p) é rejeitada',
        (url) => {
            const r = validarBancoDeTeste({ testUrl: url });
            expect(r.ok).toBe(false);
            expect(r.motivo).toMatch(/URL postgres válida/);
        }
    );

    test('NODE_ENV=production nunca roda integração, mesmo com URL de teste válida', () => {
        const r = validarBancoDeTeste({ testUrl: BANCO_LOCAL_DE_TESTE, env: { NODE_ENV: 'production' } });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/production/);
    });
});

describe('bancos compartilhados são rejeitados', () => {
    test('banco compartilhado de DESENVOLVIMENTO (host remoto, banco neondb) é rejeitado', () => {
        const r = validarBancoDeTeste({
            testUrl: DEV_COMPARTILHADO,
            env: { TEST_DATABASE_HOST_PERMITIDO: 'ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech' },
            urlsCompartilhadas: [DEV_COMPARTILHADO],
        });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/não tem nome de banco de testes/);
    });

    test('banco de PRODUÇÃO é rejeitado', () => {
        const r = validarBancoDeTeste({ testUrl: PRODUCAO, urlsCompartilhadas: [PRODUCAO] });

        expect(r.ok).toBe(false);
    });

    test('mesmo com nome de banco "de teste", o MESMO servidor do DATABASE_URL habitual é rejeitado', () => {
        const noServidorDoDev = 'postgresql://app:x@ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech/cherry_test';

        const r = validarBancoDeTeste({
            testUrl: noServidorDoDev,
            env: { TEST_DATABASE_HOST_PERMITIDO: 'ep-exemplo-dev-pooler.sa-east-1.aws.neon.tech' },
            urlsCompartilhadas: [DEV_COMPARTILHADO],
        });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/mesmo servidor\/banco do DATABASE_URL habitual/);
    });

    test('endpoint com e sem "-pooler" é o mesmo compute: rejeitado nos dois sentidos', () => {
        const semPooler = 'postgresql://app:x@ep-exemplo-dev.sa-east-1.aws.neon.tech/cherry_test';

        expect(
            validarBancoDeTeste({
                testUrl: semPooler,
                env: { TEST_DATABASE_HOST_PERMITIDO: 'ep-exemplo-dev.sa-east-1.aws.neon.tech' },
                urlsCompartilhadas: [DEV_COMPARTILHADO],
            }).ok
        ).toBe(false);
    });

    test('host listado em BANCOS_COMPARTILHADOS_BLOQUEADOS é rejeitado', () => {
        const r = validarBancoDeTeste({
            testUrl: 'postgresql://u:p@banco.interno.exemplo/cherry_test',
            env: {
                TEST_DATABASE_HOST_PERMITIDO: 'banco.interno.exemplo',
                BANCOS_COMPARTILHADOS_BLOQUEADOS: 'outro.exemplo, banco.interno.exemplo',
            },
        });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/BANCOS_COMPARTILHADOS_BLOQUEADOS/);
    });

    test('banco LOCAL com nome de banco de produção/dev (neondb) é rejeitado pelo nome', () => {
        expect(validarBancoDeTeste({ testUrl: 'postgresql://u:p@localhost:5432/neondb' }).ok).toBe(false);
        expect(validarBancoDeTeste({ testUrl: 'postgresql://u:p@localhost:5432/cherry' }).ok).toBe(false);
    });

    test.each(['contest', 'attest', 'latest', 'protesto'])('"test" dentro de outra palavra (%s) não vale como banco de teste', (nome) => {
        expect(validarBancoDeTeste({ testUrl: `postgresql://u:p@localhost:5432/${nome}` }).ok).toBe(false);
    });
});

describe('banco de testes isolado é aceito', () => {
    test.each(['cherry_test', 'cherry_ci', 'test', 'teste_cherry', 'cherry-test-1'])('banco local %s passa', (banco) => {
        const r = validarBancoDeTeste({ testUrl: `postgresql://cherry:cherry@localhost:5432/${banco}`, urlsCompartilhadas: [] });

        expect(r.ok).toBe(true);
        expect(r.destino).toEqual({ host: 'localhost', porta: '5432', banco });
    });

    test('CI: o banco descartável do job pode ser, ao mesmo tempo, o DATABASE_URL e o TEST_DATABASE_URL', () => {
        const ci = 'postgresql://cherry:cherry@localhost:5432/cherry_ci';

        expect(validarBancoDeTeste({ testUrl: ci, urlsCompartilhadas: [ci] }).ok).toBe(true);
    });

    test('host remoto SÓ passa com confirmação explícita do mesmo host e nome de banco de teste', () => {
        const remoto = 'postgresql://u:p@banco-descartavel.exemplo:5432/cherry_test';

        expect(validarBancoDeTeste({ testUrl: remoto, env: {} }).ok).toBe(false);
        expect(validarBancoDeTeste({ testUrl: remoto, env: { TEST_DATABASE_HOST_PERMITIDO: 'outro-host.exemplo' } }).ok).toBe(false);
        expect(validarBancoDeTeste({ testUrl: remoto, env: { TEST_DATABASE_HOST_PERMITIDO: 'banco-descartavel.exemplo' } }).ok).toBe(true);
    });

    test('localhost, 127.0.0.1 e ::1 contam como locais', () => {
        for (const host of ['localhost', '127.0.0.1', '[::1]']) {
            expect(validarBancoDeTeste({ testUrl: `postgresql://u:p@${host}:5432/cherry_test` }).ok).toBe(true);
        }
    });
});

describe('credenciais nunca aparecem nas mensagens', () => {
    test('a mensagem de falha mostra host e banco, jamais usuário, senha ou a URL', () => {
        const r = validarBancoDeTeste({ testUrl: DEV_COMPARTILHADO, urlsCompartilhadas: [DEV_COMPARTILHADO] });
        const texto = formatarFalha(r);

        expect(texto).toMatch(/ep-exemplo-dev-pooler/);
        expect(texto).not.toMatch(/segredo-dev/);
        expect(texto).not.toMatch(/postgresql:\/\//);
        expect(texto).not.toMatch(/sslmode/);
        expect(JSON.stringify(r)).not.toMatch(/segredo-dev/);
    });

    test('interpretarUrl devolve só host, porta e banco', () => {
        expect(interpretarUrl('postgresql://usuario:senha-secreta@Host.Exemplo:6543/Meu_Banco')).toEqual({
            host: 'host.exemplo',
            porta: '6543',
            banco: 'Meu_Banco',
        });
    });
});

describe('leitura do .env só para BLOQUEAR (nunca para configurar)', () => {
    let pasta;

    beforeEach(() => {
        pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'env-teste-'));
    });

    afterEach(() => {
        fs.rmSync(pasta, { recursive: true, force: true });
    });

    test('extrai DATABASE_URL e DATABASE_MIGRATION_URL, ignora comentários e remove aspas', () => {
        const arquivo = path.join(pasta, '.env');
        fs.writeFileSync(
            arquivo,
            [
                '# DATABASE_URL=postgresql://comentado/naousar',
                'JWT_SECRET=nao-deve-aparecer',
                'DATABASE_URL="postgresql://a:b@host-dev.exemplo/neondb"',
                "export DATABASE_MIGRATION_URL='postgresql://dono:c@host-dev.exemplo/neondb'",
                'TEST_DATABASE_URL=postgresql://x:y@host-teste.exemplo/cherry_test',
            ].join('\n')
        );

        expect(lerUrlsDoArquivoEnv(arquivo)).toEqual([
            'postgresql://a:b@host-dev.exemplo/neondb',
            'postgresql://dono:c@host-dev.exemplo/neondb',
        ]);
    });

    test('arquivo inexistente devolve lista vazia, sem erro', () => {
        expect(lerUrlsDoArquivoEnv(path.join(pasta, 'nao-existe'))).toEqual([]);
    });

    test('lerUrlsCompartilhadas junta o .env com o DATABASE_URL do ambiente', () => {
        fs.writeFileSync(path.join(pasta, '.env'), 'DATABASE_URL=postgresql://a:b@host-dev.exemplo/neondb\n');

        const urls = lerUrlsCompartilhadas({
            env: { DATABASE_URL: 'postgresql://c:d@host-env.exemplo/outro', DATABASE_MIGRATION_URL: '' },
            raiz: pasta,
        });

        expect(urls).toEqual(['postgresql://a:b@host-dev.exemplo/neondb', 'postgresql://c:d@host-env.exemplo/outro']);
    });

    test('o servidor do .env habitual é bloqueado mesmo com nome de banco de teste e host permitido', () => {
        fs.writeFileSync(path.join(pasta, '.env'), 'DATABASE_URL=postgresql://a:b@host-dev.exemplo/neondb\n');

        const r = validarBancoDeTeste({
            testUrl: 'postgresql://a:b@host-dev.exemplo/cherry_test',
            env: { TEST_DATABASE_HOST_PERMITIDO: 'host-dev.exemplo' },
            urlsCompartilhadas: lerUrlsCompartilhadas({ env: {}, raiz: pasta }),
        });

        expect(r.ok).toBe(false);
    });
});

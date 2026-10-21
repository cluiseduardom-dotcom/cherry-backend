const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const TESTS = path.join(RAIZ, 'tests');

function listarTestes(dir = TESTS, acc = []) {
    for (const nome of fs.readdirSync(dir)) {
        const caminho = path.join(dir, nome);
        if (fs.statSync(caminho).isDirectory()) listarTestes(caminho, acc);
        else if (nome.endsWith('.test.js')) acc.push(caminho);
    }
    return acc;
}

const relativo = (arquivo) => path.relative(RAIZ, arquivo).split(path.sep).join('/');
const ehIntegracao = (arquivo) => /\.integration\.test\.js$/.test(arquivo);
const ler = (arquivo) => fs.readFileSync(arquivo, 'utf8');

const testes = listarTestes();

// Estes arquivos importam o pool/pg mas NUNCA abrem conexão real no projeto unitário:
//  - inicializacaoConexoes: mocka o pacote `pg` inteiro (jest.doMock('pg')).
//  - migration045: a parte com banco só roda com TESTE_DE_INTEGRACAO=1 (projeto integration).
const USAM_BANCO_COM_PROTECAO_PROPRIA = new Set(['tests/database/inicializacaoConexoes.test.js', 'tests/database/migration045.test.js']);

describe('convenção: o que escreve no banco é teste de integração', () => {
    test('há suítes unitárias e de integração (a separação existe)', () => {
        expect(testes.filter(ehIntegracao).length).toBeGreaterThanOrEqual(4);
        expect(testes.filter((t) => !ehIntegracao(t)).length).toBeGreaterThan(50);
    });

    test('suíte que usa o pool real (src/config/db sem mock) é *.integration.test.js', () => {
        const infratores = testes.filter((arquivo) => {
            if (ehIntegracao(arquivo) || USAM_BANCO_COM_PROTECAO_PROPRIA.has(relativo(arquivo)) || relativo(arquivo).startsWith('tests/seguranca/')) {
                return false;
            }

            const codigo = ler(arquivo);
            const importaPool = /require\([^)]*config\/db['"]\)/.test(codigo);
            const mockaPool = /jest\.(do)?mock\([^)]*config\/db['"]/.test(codigo);

            return importaPool && !mockaPool;
        });

        expect(infratores.map(relativo)).toEqual([]);
    });

    test('suíte que abre conexão própria com `pg` sem mockar é *.integration.test.js', () => {
        const infratores = testes.filter((arquivo) => {
            if (ehIntegracao(arquivo) || USAM_BANCO_COM_PROTECAO_PROPRIA.has(relativo(arquivo)) || relativo(arquivo).startsWith('tests/seguranca/')) {
                return false;
            }

            const codigo = ler(arquivo);
            return /new (Client|Pool)\(/.test(codigo) && !/jest\.(do)?mock\(['"]pg['"]/.test(codigo);
        });

        expect(infratores.map(relativo)).toEqual([]);
    });

    test('nenhuma suíte unitária lê DATABASE_URL para decidir se roda contra o banco', () => {
        const infratores = testes.filter((arquivo) => {
            if (ehIntegracao(arquivo) || relativo(arquivo).startsWith('tests/seguranca/')) return false;
            if (relativo(arquivo) === 'tests/database/inicializacaoConexoes.test.js') return false; // só testa a leitura da variável, com pg mockado

            return /process\.env\.DATABASE_URL\s*\?\s*describe/.test(ler(arquivo));
        });

        expect(infratores.map(relativo)).toEqual([]);
    });

    test('INSERT INTO empresas/usuarios só aparece em suítes de integração (ou com o banco mockado)', () => {
        const infratores = testes.filter((arquivo) => {
            if (ehIntegracao(arquivo) || relativo(arquivo).startsWith('tests/seguranca/')) return false;

            const codigo = ler(arquivo);
            const insere = /INSERT INTO (empresas|usuarios)\b/.test(codigo);
            const bancoMockado = /jest\.(do)?mock\([^)]*(config\/db|['"]pg['"])/.test(codigo);

            return insere && !bancoMockado;
        });

        expect(infratores.map(relativo)).toEqual([]);
    });
});

describe('convenção: a preparação das suítes de integração não deixa resíduos', () => {
    const integracao = testes.filter(ehIntegracao).filter((a) => /INSERT INTO empresas/.test(ler(a)));

    test('existem suítes de integração que criam empresas', () => {
        expect(integracao.length).toBeGreaterThanOrEqual(4);
    });

    test.each(integracao.map((a) => [relativo(a), a]))('%s registra a empresa logo após o INSERT e limpa no afterAll', (_nome, arquivo) => {
        const codigo = ler(arquivo);

        expect(codigo).toMatch(/criarRegistroDeEmpresas\(db\)/);
        expect(codigo).toMatch(/registro\.registrar\(/);
        expect(codigo).toMatch(/registro\.limpar\(\)/);
        // db.end() precisa estar num finally: se a limpeza falhar, o pool ainda fecha
        expect(codigo).toMatch(/finally\s*\{[\s\S]*db\.end\(\)/);
    });

    test('o registro vem ANTES de login/produtos/preços na preparação (taxaPlataforma e taxaPlataformaComercial)', () => {
        for (const nome of ['tests/routes/taxaPlataforma.integration.test.js', 'tests/routes/taxaPlataformaComercial.integration.test.js']) {
            const codigo = ler(path.join(RAIZ, nome));
            const insercao = codigo.indexOf('INSERT INTO empresas');
            const registro = codigo.indexOf('registro.registrar(', insercao);

            // primeiro passo "caro" da preparação depois do INSERT: criar usuário/logar
            const proximos = [codigo.indexOf('criarUsuario(', insercao), codigo.indexOf("post('/auth/login')", insercao)].filter((i) => i > -1);
            const primeiroPasso = Math.min(...proximos);

            expect(insercao).toBeGreaterThan(-1);
            expect(proximos.length).toBeGreaterThan(0);
            expect(registro).toBeGreaterThan(insercao);
            expect(registro).toBeLessThan(primeiroPasso);
        }
    });
});

describe('configuração: o Jest separa os projetos e o npm test não toca em banco', () => {
    const pacote = JSON.parse(ler(path.join(RAIZ, 'package.json')));

    test('npm test roda só o projeto unitário; integração é um script separado', () => {
        expect(pacote.scripts.test).toMatch(/--selectProjects unit/);
        expect(pacote.scripts.test).not.toMatch(/integration/);
        expect(pacote.scripts['test:integration']).toMatch(/--selectProjects integration/);
        expect(pacote.scripts['test:integration']).toMatch(/--runInBand/);
        expect(pacote.scripts['test:coverage']).toMatch(/--selectProjects unit/);
    });

    test('a configuração do Jest vive em jest.config.js (sem chave "jest" no package.json)', () => {
        expect(pacote.jest).toBeUndefined();
    });

    const config = require('../../jest.config.js');
    const unit = config.projects.find((p) => p.displayName === 'unit');
    const integracao = config.projects.find((p) => p.displayName === 'integration');

    test('projeto unitário: ignora *.integration.test.js e bloqueia o banco', () => {
        expect(unit.testPathIgnorePatterns.join(' ')).toMatch(/integration/);
        expect(unit.setupFiles).toContain('<rootDir>/tests/setupBloqueioBanco.js');
        expect(unit.globalSetup).toBeUndefined();
    });

    test('projeto de integração: valida a URL em globalSetup (antes de qualquer conexão)', () => {
        expect(integracao.globalSetup).toBe('<rootDir>/tests/integration/globalSetup.js');
        expect(integracao.setupFiles).toContain('<rootDir>/tests/integration/setupIntegracao.js');
        expect(integracao.testMatch.join(' ')).toMatch(/integration\.test\.js/);
    });

    test('os dois projetos substituem o dotenv: o .env habitual nunca é lido pelos testes', () => {
        for (const projeto of [unit, integracao]) {
            expect(projeto.moduleNameMapper['^dotenv$']).toBe('<rootDir>/tests/stubs/dotenv.js');
        }
    });

    test('o stub do dotenv não carrega nada no ambiente', () => {
        const antes = { ...process.env };

        // moduleNameMapper faz `require('dotenv')` devolver o stub dentro do Jest
        const dotenv = require('dotenv');

        expect(dotenv).toBe(require('../stubs/dotenv'));
        expect(dotenv.config({ path: path.join(RAIZ, '.env') })).toEqual({ parsed: {} });
        expect(process.env).toEqual(antes);
    });

    test('nos testes unitários o banco é o destino bloqueado e não há TEST_DATABASE_URL', () => {
        expect(process.env.DATABASE_URL).toBe('postgresql://testes_unitarios:sem-banco@127.0.0.1:1/testes_unitarios_sem_banco');
        expect(process.env.DATABASE_MIGRATION_URL).toBe('');
        expect(process.env.TEST_DATABASE_URL).toBeUndefined();
        expect(process.env.TESTE_DE_INTEGRACAO).toBeUndefined();
    });

    test('src/config/db.js, importado num teste unitário, usa o destino bloqueado (nunca o .env)', () => {
        let Pool;

        jest.isolateModules(() => {
            Pool = jest.fn();
            jest.doMock('pg', () => ({ Pool }));
            require('../../src/config/db');
        });

        expect(Pool).toHaveBeenCalledWith({ connectionString: process.env.DATABASE_URL });
        expect(String(Pool.mock.calls[0][0].connectionString)).toMatch(/127\.0\.0\.1:1/);
    });
});

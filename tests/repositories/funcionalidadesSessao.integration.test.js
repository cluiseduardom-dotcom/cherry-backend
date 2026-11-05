// Integração de verdade (Postgres de testes): a lista de funcionalidades que a consulta da sessão devolve.
// Regra: (plano inclui OU ligação avulsa vigente) E NÃO desligada de forma vigente. Plano resolvido igual a
// taxasPlataformaRepository.buscarPlanoDaEmpresa. Empresas próprias e temporárias; remove tudo no fim.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const RECURSOS = ['analise_financeira', 'bancos', 'comissoes', 'maletas'];
const HOJE = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

const inserir = async (sql, params) => (await db.query(sql, params)).rows[0].id;

async function novaEmpresa(rotulo) {
    const empresaId = registro.registrar(
        await inserir(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Funcionalidades ${rotulo} ${sufixo}`])
    );
    const usuarioId = await inserir(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', 'admin') RETURNING id`,
        [empresaId, `Admin ${rotulo}`, `func-${rotulo}-${sufixo}@teste.local`]
    );
    return { empresaId, usuarioId };
}

async function plano(empresaId, codigo, { inicio = `${HOJE}`, fim = null, ativo = true } = {}) {
    await db.query(
        `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, vigencia_fim, ativo, justificativa, responsavel)
         SELECT $1, id, ${inicio}, $2, $3, 'teste', 'teste' FROM planos_comerciais WHERE codigo = $4`,
        [empresaId, fim, ativo, codigo]
    );
}

async function ligacao(empresaId, funcionalidade, ligada, { inicio = HOJE, fim = 'NULL' } = {}) {
    await db.query(
        `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel, vigencia_inicio, vigencia_fim)
         VALUES ($1, $2, $3, 'teste', 'teste', ${inicio}, ${fim})`,
        [empresaId, funcionalidade, ligada]
    );
}

const lista = async ({ usuarioId, empresaId }) => (await sessaoRepository.buscarEstado(usuarioId, empresaId)).funcionalidades;

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('funcionalidades na consulta da sessão', () => {
    test('empresa sem plano cai no padrão sem_mensalidade e recebe os recursos', async () => {
        const e = await novaEmpresa('semplano');

        expect(await lista(e)).toEqual(RECURSOS);
        expect((await taxasPlataformaRepository.buscarPlanoDaEmpresa(e.empresaId, db)).codigo).toBe('sem_mensalidade');
    });

    test.each([
        ['com_mensalidade', RECURSOS],
        ['padrao', RECURSOS],
        ['pro', RECURSOS],
        ['basico', []],
        ['cortesia', []]
    ])('plano %s', async (codigo, esperado) => {
        const e = await novaEmpresa(codigo);
        await plano(e.empresaId, codigo);

        expect(await lista(e)).toEqual(esperado);
        // Mesmo plano que a taxa da venda enxerga.
        expect((await taxasPlataformaRepository.buscarPlanoDaEmpresa(e.empresaId, db)).codigo).toBe(codigo);
    });

    test('plano futuro, vencido ou inativo não conta: volta ao padrão', async () => {
        const futuro = await novaEmpresa('futuro');
        await plano(futuro.empresaId, 'basico', { inicio: `${HOJE} + 5` });
        const vencido = await novaEmpresa('vencido');
        await plano(vencido.empresaId, 'basico', { inicio: `${HOJE} - 10`, fim: null });
        await db.query(`UPDATE empresa_planos SET vigencia_fim = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1 WHERE empresa_id = $1`, [vencido.empresaId]);
        const inativo = await novaEmpresa('inativo');
        await plano(inativo.empresaId, 'basico', { ativo: false });

        for (const e of [futuro, vencido, inativo]) {
            expect(await lista(e)).toEqual(RECURSOS);
            expect((await taxasPlataformaRepository.buscarPlanoDaEmpresa(e.empresaId, db)).codigo).toBe('sem_mensalidade');
        }
    });

    test('Básico + ligação avulsa vigente liga só aquela funcionalidade', async () => {
        const e = await novaEmpresa('avulsa');
        await plano(e.empresaId, 'basico');
        await ligacao(e.empresaId, 'bancos', true);

        expect(await lista(e)).toEqual(['bancos']);
    });

    test('desligar vence o plano que inclui', async () => {
        const e = await novaEmpresa('desliga');
        await plano(e.empresaId, 'padrao');
        await ligacao(e.empresaId, 'comissoes', false);

        expect(await lista(e)).toEqual(['analise_financeira', 'bancos', 'maletas']);
    });

    test('ligação vencida ou futura não vale; ligação com vigência aberta vale até o último dia', async () => {
        const e = await novaEmpresa('vigencia');
        await plano(e.empresaId, 'basico');
        await ligacao(e.empresaId, 'bancos', true, { inicio: `${HOJE} - 10`, fim: `${HOJE} - 1` });
        await ligacao(e.empresaId, 'maletas', true, { inicio: `${HOJE} + 1` });
        await ligacao(e.empresaId, 'comissoes', true, { inicio: `${HOJE} - 3`, fim: HOJE });

        expect(await lista(e)).toEqual(['comissoes']);
    });

    test('desligamento vencido não bloqueia o plano', async () => {
        const e = await novaEmpresa('deslvenc');
        await plano(e.empresaId, 'padrao');
        await ligacao(e.empresaId, 'bancos', false, { inicio: `${HOJE} - 10`, fim: `${HOJE} - 1` });

        expect(await lista(e)).toEqual(RECURSOS);
    });

    test('isolamento: ligação de uma empresa não aparece em outra', async () => {
        const a = await novaEmpresa('isoa');
        const b = await novaEmpresa('isob');
        await plano(a.empresaId, 'cortesia');
        await plano(b.empresaId, 'cortesia');
        await ligacao(a.empresaId, 'maletas', true);

        expect(await lista(a)).toEqual(['maletas']);
        expect(await lista(b)).toEqual([]);
    });

    test('catálogo, banco e constantes coincidem e módulos não vendáveis não vêm por plano', async () => {
        const { rows } = await db.query(`SELECT codigo FROM funcionalidades ORDER BY codigo`);
        const { CODIGOS_FUNCIONALIDADES } = require('../../src/constants/funcionalidades');
        const e = await novaEmpresa('catalogo');
        await plano(e.empresaId, 'pro');

        expect(rows.map((r) => r.codigo)).toEqual([...CODIGOS_FUNCIONALIDADES].sort());
        expect(await lista(e)).not.toContain('fiscal');
    });

    test('custo: a consulta da sessão continua rápida (EXPLAIN ANALYZE)', async () => {
        const e = await novaEmpresa('custo');
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < 20; i += 1) await sessaoRepository.buscarEstado(e.usuarioId, e.empresaId);
        const mediaMs = Number(process.hrtime.bigint() - t0) / 1e6 / 20;

        // Teto folgado só para acusar regressão grosseira; o número real vai para o PR.
        expect(mediaMs).toBeLessThan(50);
    });
});

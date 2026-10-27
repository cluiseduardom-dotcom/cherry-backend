// Integração de verdade: GET /plataforma/taxas (operador da plataforma).
// Prova o acesso (só plataforma_admin + admin, lido do BANCO), a leitura agregada entre
// empresas, o corte do mês no fuso de Brasília e que a marca não vem do token.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);
const A = { u: {} };
const B = { u: {} };
let politica;

async function criarEmpresa(alvo, rotulo, papeis) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Plataforma ${rotulo} ${sufixo}`]);
    alvo.nome = `Teste Plataforma ${rotulo} ${sufixo}`;
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    for (const papel of papeis) {
        alvo.u[papel] = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH, papel]
        )).rows[0].id;
    }
}

// instante UTC -> "relógio" da sessão do banco, que é como vendas.data é gravada (NOW()).
async function criarTaxa(alvo, instanteUtc, { base, valor, status = 'apurada', percentual = 0.15 }) {
    const venda = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, total, status, data)
         VALUES ($1, $2, $3, 'finalizada', ($4::timestamptz) AT TIME ZONE current_setting('TimeZone')) RETURNING id`,
        [alvo.empresaId, alvo.canalId, base, instanteUtc]
    );
    await db.query(
        `INSERT INTO taxas_venda (venda_id, empresa_id, politica_id, plano_id, origem, tipo, percentual, base_calculo, valor, status)
         VALUES ($1, $2, $3, $4, 'padrao_sem_plano', 'percentual', $5, $6, $7, $8)`,
        [venda.rows[0].id, alvo.empresaId, politica.id, politica.plano_id, percentual, base, valor, status]
    );
}

const tk = (alvo, papel, extra = {}) => makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0, ...extra });
const get = (alvo, papel, query = '', extra = {}) =>
    request(app).get(`/plataforma/taxas${query}`).set('Authorization', `Bearer ${tk(alvo, papel, extra)}`);
const marcar = (alvo, papel, valor) => db.query('UPDATE usuarios SET plataforma_admin = $1 WHERE id = $2', [valor, alvo.u[papel]]);
const linha = (res, alvo) => res.body.data.items.find((i) => i.empresa_id === alvo.empresaId);

beforeAll(async () => {
    politica = (await db.query('SELECT id, plano_id FROM politicas_taxa_plataforma ORDER BY id LIMIT 1')).rows[0];
    await criarEmpresa(A, 'A', ['admin', 'vendedor', 'estoquista']);
    await criarEmpresa(B, 'B', ['admin']);

    // Março/2026 (fuso de Brasília): A tem 2 apuradas + 1 estornada; B tem 1 apurada.
    await criarTaxa(A, '2026-03-10T15:00:00Z', { base: 100, valor: 0.15 });
    await criarTaxa(A, '2026-03-20T15:00:00Z', { base: 200, valor: 0.30 });
    await criarTaxa(A, '2026-03-21T15:00:00Z', { base: 50, valor: 0.08, status: 'estornada' });
    await criarTaxa(B, '2026-03-15T15:00:00Z', { base: 1000, valor: 1.00, percentual: 0.10 });

    // Corte do mês em Brasília (UTC-3): 02:59Z de 01/03 ainda é fevereiro; 03:00Z já é março.
    await criarTaxa(B, '2026-03-01T02:59:00Z', { base: 10, valor: 0.01 });
    await criarTaxa(B, '2026-03-01T03:00:00Z', { base: 20, valor: 0.02 });
    // 02:00Z de 01/04 ainda é 31/03 em Brasília (março); 03:00Z já é abril.
    await criarTaxa(B, '2026-04-01T02:00:00Z', { base: 30, valor: 0.03 });
    await criarTaxa(B, '2026-04-01T03:00:00Z', { base: 40, valor: 0.04 });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('GET /plataforma/taxas — acesso', () => {
    test('sem token: 401', async () => {
        expect((await request(app).get('/plataforma/taxas')).status).toBe(401);
    });

    test('admin de empresa SEM a marca: 403; vendedor e estoquista: 403', async () => {
        expect((await get(A, 'admin')).status).toBe(403);
        expect((await get(A, 'vendedor')).status).toBe(403);
        expect((await get(A, 'estoquista')).status).toBe(403);
    });

    test('a marca vem do banco: reivindicar plataforma_admin no token não abre o acesso', async () => {
        const res = await get(A, 'admin', '', { plataforma_admin: true });
        expect(res.status).toBe(403);
    });

    test('vendedor com a marca ligada continua barrado (exige papel admin)', async () => {
        await marcar(A, 'vendedor', true);
        expect((await get(A, 'vendedor')).status).toBe(403);
        await marcar(A, 'vendedor', false);
    });

    test('marca ligada vale na próxima requisição e desligada é revogada na seguinte', async () => {
        await marcar(A, 'admin', true);
        expect((await get(A, 'admin', '?mes=2026-03')).status).toBe(200);
        await marcar(A, 'admin', false);
        expect((await get(A, 'admin', '?mes=2026-03')).status).toBe(403);
    });

    test('/auth/me informa a marca (e false para quem não a tem)', async () => {
        const me = (alvo, papel) => request(app).get('/auth/me').set('Authorization', `Bearer ${tk(alvo, papel)}`);
        expect((await me(A, 'admin')).body.data.plataforma_admin).toBe(false);
        await marcar(A, 'admin', true);
        expect((await me(A, 'admin')).body.data.plataforma_admin).toBe(true);
        await marcar(A, 'admin', false);
    });

    test('a marca não é escrita por nenhuma rota: PATCH de usuário ignora/recusa plataforma_admin', async () => {
        const res = await request(app)
            .patch(`/usuarios/${A.u.vendedor}`)
            .set('Authorization', `Bearer ${tk(A, 'admin')}`)
            .send({ plataforma_admin: true });
        expect(res.status).toBeGreaterThanOrEqual(400);
        const { rows } = await db.query('SELECT plataforma_admin FROM usuarios WHERE id = $1', [A.u.vendedor]);
        expect(rows[0].plataforma_admin).toBe(false);
    });
});

describe('GET /plataforma/taxas — dados (operador)', () => {
    beforeAll(() => marcar(A, 'admin', true));
    afterAll(() => marcar(A, 'admin', false));

    test('enxerga as duas empresas (leitura entre empresas) com somas corretas e estorno fora do a receber', async () => {
        const res = await get(A, 'admin', '?mes=2026-03');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('no-store');
        expect(res.body.data.mes).toBe('2026-03');

        const a = linha(res, A);
        expect(a).toMatchObject({
            empresa_nome: A.nome,
            qtd_vendas: 2,
            total_base: '300.00',
            total_taxa: '0.45',
            qtd_estornadas: 1,
            total_estornado: '0.08',
            percentuais: [0.15]
        });

        // B em março: percentuais usados no mês (0,10 da venda de 1000 e 0,15 das demais).
        const b = linha(res, B);
        expect(b).toBeDefined();
        expect(b.percentuais).toEqual([0.1, 0.15]);
    });

    test('corte do mês no fuso de Brasília', async () => {
        const marco = linha(await get(A, 'admin', '?mes=2026-03'), B);
        // março de B: 1000 (15/03) + 20 (01/03 03:00Z) + 30 (31/03 23:00 BRT) = 1050; 10 caiu em fevereiro, 40 em abril.
        expect(marco.qtd_vendas).toBe(3);
        expect(marco.total_base).toBe('1050.00');
        expect(marco.total_taxa).toBe('1.05');

        const fev = linha(await get(A, 'admin', '?mes=2026-02'), B);
        expect(fev.qtd_vendas).toBe(1);
        expect(fev.total_base).toBe('10.00');

        const abr = linha(await get(A, 'admin', '?mes=2026-04'), B);
        expect(abr.qtd_vendas).toBe(1);
        expect(abr.total_base).toBe('40.00');
    });

    test('empresa ativa sem venda no mês aparece com zeros', async () => {
        const res = await get(A, 'admin', '?mes=2026-02');
        expect(linha(res, A)).toMatchObject({ qtd_vendas: 0, total_base: '0.00', total_taxa: '0.00', percentuais: [] });
    });

    test('totais fecham com a soma das linhas', async () => {
        const res = await get(A, 'admin', '?mes=2026-03');
        const soma = res.body.data.items.reduce((acc, i) => acc + Math.round(Number(i.total_taxa) * 100), 0);
        expect(Math.round(Number(res.body.data.totais.total_taxa) * 100)).toBe(soma);
        expect(res.body.data.totais.qtd_vendas).toBe(res.body.data.items.reduce((acc, i) => acc + i.qtd_vendas, 0));
    });

    test('sem mes usa o mês corrente de Brasília', async () => {
        const res = await get(A, 'admin');
        expect(res.status).toBe(200);
        expect(res.body.data.mes).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    });

    test('mes inválido ou parâmetro desconhecido: 400', async () => {
        expect((await get(A, 'admin', '?mes=2026-13')).status).toBe(400);
        expect((await get(A, 'admin', '?mes=marco')).status).toBe(400);
        expect((await get(A, 'admin', '?mes=2026-03&empresa_id=1')).status).toBe(400);
    });

    test('só agregados: nenhum dado de venda ou cliente na resposta', async () => {
        const res = await get(A, 'admin', '?mes=2026-03');
        const chaves = Object.keys(res.body.data.items[0]).sort();
        expect(chaves).toEqual(['empresa_id', 'empresa_nome', 'percentuais', 'qtd_estornadas', 'qtd_vendas', 'total_base', 'total_estornado', 'total_taxa']);
    });
});

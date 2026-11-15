// Integração: comprovante de pagamento da taxa no bucket PRIVADO (Painel GiroNex). O provedor (R2) é
// substituído por um armazenamento em memória; rotas, sessão, banco, chave e trilha são os reais.
jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const mockObjetos = new Map();
let mockConfigurado = true;
jest.mock('../../src/services/storage/comprovantesStorage', () => {
    const { Readable } = require('node:stream');
    return {
        configurado: () => mockConfigurado,
        enviar: jest.fn(async ({ chave, buffer, contentType }) => { mockObjetos.set(chave, { buffer, contentType }); }),
        existe: jest.fn(async (chave) => mockObjetos.has(chave)),
        obter: jest.fn(async (chave) => {
            const o = mockObjetos.get(chave);
            return { corpo: Readable.from(o.buffer), contentType: o.contentType, tamanho: o.buffer.length };
        })
    };
});

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { hojeSP } = require('../../src/utils/dataSaoPaulo');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);

let operador;
let politica;
const A = {};
const B = {};

async function criarEmpresaComMesFechado(alvo, rotulo, competencia) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Comprovante ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    const canal = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'Loja', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
    alvo.adminId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.empresaId, `admin ${sufixo}`, `admin-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH]
    )).rows[0].id;
    const venda = (await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, total, status, data)
         VALUES ($1, $2, 4000, 'finalizada', ($3::timestamptz) AT TIME ZONE current_setting('TimeZone')) RETURNING id`,
        [alvo.empresaId, canal, `${competencia}-10T15:00:00Z`]
    )).rows[0].id;
    await db.query(
        `INSERT INTO taxas_venda (venda_id, empresa_id, politica_id, plano_id, origem, tipo, percentual, base_calculo, valor, status)
         VALUES ($1, $2, $3, $4, 'padrao_sem_plano', 'percentual', 0.5, 4000, 20, 'apurada')`,
        [venda, alvo.empresaId, politica.id, politica.plano_id]
    );
    const res = await request(app).post('/painel/taxas/periodos/fechar').set(operador.cabecalho)
        .send({ competencia, empresa_id: alvo.empresaId });
    alvo.periodoId = res.body.data.items[0].periodo_id;
}

const enviar = (periodoId, buffer, nome = 'comprovante.pdf') =>
    request(app).post(`/painel/taxas/periodos/${periodoId}/comprovantes`).set(operador.cabecalho).attach('arquivo', buffer, nome);
const pagar = (periodoId, extra = {}) => request(app).post(`/painel/taxas/periodos/${periodoId}/pagamentos`).set(operador.cabecalho)
    .send({ valor: 5, data_pagamento: hojeSP(), forma_pagamento: 'pix', ...extra });

async function removerTrilhaDasEmpresas(ids) {
    const c = await db.connect();
    try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL vertumno.limpeza_teste = 'on'`);
        await c.query('DELETE FROM plataforma_eventos WHERE alvo_empresa_id = ANY($1::int[])', [ids]);
        await c.query('COMMIT');
    } catch (erro) {
        await c.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        c.release();
    }
}

beforeAll(async () => {
    operador = await criarOperadorComSessao('comprovante');
    politica = (await db.query('SELECT id, plano_id FROM politicas_taxa_plataforma ORDER BY id LIMIT 1')).rows[0];
    await criarEmpresaComMesFechado(A, 'A', '2025-02');
    await criarEmpresaComMesFechado(B, 'B', '2025-02');
});

afterAll(async () => {
    try {
        await removerTrilhaDasEmpresas(registro.ids());
        await registro.limpar();
        await removerOperador(operador);
    } finally {
        await db.end();
    }
});

describe('envio do comprovante', () => {
    test('PDF e PNG aceitos pelo conteúdo; chave presa à empresa e ao período', async () => {
        const pdf = await enviar(A.periodoId, PDF);
        expect(pdf.status).toBe(201);
        expect(pdf.body.data.comprovante_chave).toMatch(new RegExp(`^taxas/${A.empresaId}/${A.periodoId}/[0-9a-f-]{36}\\.pdf$`));

        // Extensão mentirosa: vale o conteúdo (PNG), não o nome.
        const png = await enviar(A.periodoId, PNG, 'foto.pdf');
        expect(png.body.data.comprovante_chave).toMatch(/\.png$/);
    });

    test('conteúdo que não é PDF/JPEG/PNG: 415; sem arquivo: 400; acima de 5 MB: 413', async () => {
        expect((await enviar(A.periodoId, Buffer.from('<html>não sou comprovante</html>'), 'x.pdf')).status).toBe(415);
        expect((await request(app).post(`/painel/taxas/periodos/${A.periodoId}/comprovantes`).set(operador.cabecalho)).status).toBe(400);
        const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024)]);
        expect((await enviar(A.periodoId, grande)).status).toBe(413);
    });

    test('período aberto: 409; inexistente: 404', async () => {
        const aberto = await request(app).post(`/painel/empresas/${A.empresaId}/taxas/ajustes`).set(operador.cabecalho)
            .send({ valor: 1, justificativa: 'abre o mês corrente' });
        expect((await enviar(aberto.body.data.periodo.id, PDF)).status).toBe(409);
        expect((await enviar(999999999, PDF)).status).toBe(404);
    });

    test('armazenamento não configurado: 412 (o pagamento sem anexo segue funcionando)', async () => {
        mockConfigurado = false;
        try {
            expect((await enviar(A.periodoId, PDF)).status).toBe(412);
        } finally {
            mockConfigurado = true;
        }
    });

    test('token do ERP não envia nem baixa comprovante', async () => {
        const tokenErp = makeToken({ id: A.adminId, empresa_id: A.empresaId, papel: 'admin' });
        const r = await request(app).post(`/painel/taxas/periodos/${A.periodoId}/comprovantes`)
            .set('Authorization', `Bearer ${tokenErp}`).attach('arquivo', PDF, 'c.pdf');
        expect(r.status).toBe(401);
        expect((await request(app).get('/painel/taxas/lancamentos/1/comprovante').set('Authorization', `Bearer ${tokenErp}`)).status).toBe(401);
    });
});

describe('pagamento com comprovante e download', () => {
    test('comprovante de outro período/empresa: 400; chave que não existe no bucket: 400', async () => {
        const deB = (await enviar(B.periodoId, PDF)).body.data.comprovante_chave;
        expect((await pagar(A.periodoId, { comprovante_chave: deB })).status).toBe(400);

        const inexistente = `taxas/${A.empresaId}/${A.periodoId}/${crypto.randomUUID()}.pdf`;
        expect((await pagar(A.periodoId, { comprovante_chave: inexistente })).status).toBe(400);
        expect((await pagar(A.periodoId, { comprovante_chave: '../../etc/passwd' })).status).toBe(400);
    });

    test('pagamento com comprovante: lançamento marca o anexo; download devolve o arquivo e grava a trilha', async () => {
        const chave = (await enviar(A.periodoId, PDF)).body.data.comprovante_chave;
        const res = await pagar(A.periodoId, { comprovante_chave: chave });
        expect(res.status).toBe(201);

        const lancamento = res.body.data.lancamentos.find((l) => l.id === res.body.data.lancamento_id);
        expect(lancamento).toMatchObject({ tipo: 'pagamento', tem_comprovante: true });
        expect(lancamento).not.toHaveProperty('comprovante_chave');

        const baixado = await request(app).get(`/painel/taxas/lancamentos/${lancamento.id}/comprovante`)
            .set(operador.cabecalho).buffer(true).parse((r, cb) => { const p = []; r.on('data', (c) => p.push(c)); r.on('end', () => cb(null, Buffer.concat(p))); });
        expect(baixado.status).toBe(200);
        expect(baixado.headers['content-type']).toMatch(/application\/pdf/);
        expect(baixado.headers['cache-control']).toBe('no-store');
        expect(baixado.headers['content-disposition']).toMatch(/attachment; filename="comprovante-lancamento-\d+\.pdf"/);
        expect(Buffer.compare(baixado.body, PDF)).toBe(0);

        const { rows } = await db.query(
            `SELECT operador_id, detalhe FROM plataforma_eventos WHERE alvo_empresa_id = $1 AND acao = 'taxa_comprovante_baixado'`,
            [A.empresaId]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ operador_id: operador.id, detalhe: { lancamento_id: lancamento.id } });
    });

    test('lançamento sem comprovante: 404', async () => {
        const res = await pagar(B.periodoId);
        expect((await request(app).get(`/painel/taxas/lancamentos/${res.body.data.lancamento_id}/comprovante`).set(operador.cabecalho)).status).toBe(404);
    });
});

// Fiação da rota de importação (prévia e modelo): auth, papel, funcionalidade, upload e validação.
// A regra da prévia é coberta em tests/services/importacaoListaService.test.js; o service é mockado aqui.
jest.mock('../../src/services/importacaoListaService');
jest.mock('../../src/services/importacaoListaConfirmacaoService');

const request = require('supertest');
const app = require('../../src/app');
const importacaoListaService = require('../../src/services/importacaoListaService');
const confirmacaoService = require('../../src/services/importacaoListaConfirmacaoService');
const AppError = require('../../src/errors/AppError');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const { MENSAGEM } = require('../../src/middlewares/exigirFuncionalidade');
const { makeToken } = require('../helpers/token');

const admin = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedor = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });
const estoquista = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });

const comFuncionalidade = (ligada = true) =>
    sessaoRepository.buscarEstado.mockResolvedValue({
        ativo: true, token_version: 0, empresa_status: 'ativa', funcionalidades: ligada ? ['importacao_lista'] : ['maletas']
    });

const csv = Buffer.from('nome;custo;sku\nAnel;10;A1', 'utf8');
const enviar = (token, campos = { tipo: 'produtos' }, arquivo = csv) => {
    const req = request(app).post('/importacao/previa').set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(campos)) req.field(k, v);
    if (arquivo) req.attach('arquivo', arquivo, { filename: 'lista.csv', contentType: 'text/csv' });
    return req;
};

beforeEach(() => {
    jest.clearAllMocks();
    comFuncionalidade(true);
});

describe('acesso', () => {
    test.each([
        ['get', '/importacao/modelo?tipo=produtos'],
        ['post', '/importacao/previa']
    ])('%s %s: 401 sem token', async (metodo, url) => {
        expect((await request(app)[metodo](url)).status).toBe(401);
    });

    test.each([['vendedor', vendedor], ['estoquista', estoquista]])('%s recebe 403 e o service nem é chamado', async (_, token) => {
        const modelo = await request(app).get('/importacao/modelo?tipo=produtos').set('Authorization', `Bearer ${token}`);
        const previa = await enviar(token);

        expect(modelo.status).toBe(403);
        expect(previa.status).toBe(403);
        expect(importacaoListaService.gerarModelo).not.toHaveBeenCalled();
        expect(importacaoListaService.previa).not.toHaveBeenCalled();
    });

    test('admin de empresa sem a funcionalidade: 403 com a mensagem do plano', async () => {
        comFuncionalidade(false);
        const modelo = await request(app).get('/importacao/modelo?tipo=produtos').set('Authorization', `Bearer ${admin}`);
        const previa = await enviar(admin);

        for (const res of [modelo, previa]) {
            expect(res.status).toBe(403);
            expect(res.body.message).toBe(MENSAGEM);
        }
        expect(importacaoListaService.previa).not.toHaveBeenCalled();
    });
});

describe('GET /importacao/modelo', () => {
    test('baixa o CSV como anexo, sem cache', async () => {
        importacaoListaService.gerarModelo.mockReturnValue({ nome: 'modelo-produtos.csv', conteudo: '﻿nome;custo\r\n' });

        const res = await request(app).get('/importacao/modelo?tipo=produtos&formato=csv').set('Authorization', `Bearer ${admin}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/csv/);
        expect(res.headers['content-disposition']).toBe('attachment; filename="modelo-produtos.csv"');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(importacaoListaService.gerarModelo).toHaveBeenCalledWith('produtos', 'csv');
    });

    test('formato padrão é csv; tipo e formato inválidos viram 400', async () => {
        importacaoListaService.gerarModelo.mockReturnValue({ nome: 'm.csv', conteudo: '' });
        await request(app).get('/importacao/modelo?tipo=clientes').set('Authorization', `Bearer ${admin}`);
        expect(importacaoListaService.gerarModelo).toHaveBeenCalledWith('clientes', 'csv');

        const semTipo = await request(app).get('/importacao/modelo').set('Authorization', `Bearer ${admin}`);
        const tipoRuim = await request(app).get('/importacao/modelo?tipo=vendas').set('Authorization', `Bearer ${admin}`);
        const formatoRuim = await request(app).get('/importacao/modelo?tipo=produtos&formato=pdf').set('Authorization', `Bearer ${admin}`);
        expect([semTipo.status, tipoRuim.status, formatoRuim.status]).toEqual([400, 400, 400]);
    });
});

describe('POST /importacao/previa', () => {
    test('repassa arquivo, tipo e local ao service e o usuário do JWT', async () => {
        importacaoListaService.previa.mockResolvedValue({ importacao_id: 1, token: 't' });

        const res = await enviar(admin, { tipo: 'produtos', local_padrao_id: '12' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { importacao_id: 1, token: 't' } });
        expect(res.headers['cache-control']).toBe('no-store');

        const [params, usuario] = importacaoListaService.previa.mock.calls[0];
        expect(params).toMatchObject({ tipo: 'produtos', localPadraoId: 12 });
        expect(params.arquivo.buffer.equals(csv)).toBe(true);
        expect(usuario).toMatchObject({ id: 1, empresa_id: 1 });
    });

    test('empresa_id e usuario_id enviados no corpo são recusados (a empresa vem só do JWT)', async () => {
        const res = await enviar(admin, { tipo: 'produtos', empresa_id: '2' });
        expect(res.status).toBe(400);
        expect(importacaoListaService.previa).not.toHaveBeenCalled();
    });

    test.each([
        [{}, 'sem tipo'],
        [{ tipo: 'vendas' }, 'tipo inválido'],
        [{ tipo: 'produtos', local_padrao_id: 'abc' }, 'local inválido'],
        [{ tipo: 'produtos', local_padrao_id: '0' }, 'local zero']
    ])('400 para %j (%s)', async (campos) => {
        const res = await enviar(admin, campos);
        expect(res.status).toBe(400);
        expect(importacaoListaService.previa).not.toHaveBeenCalled();
    });

    test('sem arquivo, o service responde o erro de arquivo', async () => {
        const AppError = require('../../src/errors/AppError');
        importacaoListaService.previa.mockRejectedValue(new AppError('Envie o arquivo CSV no campo "arquivo"', 400));
        const res = await enviar(admin, { tipo: 'produtos' }, null);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Envie o arquivo CSV no campo "arquivo"');
    });

    test('arquivo acima de 5 MB: 413 sem chamar o service', async () => {
        const res = await enviar(admin, { tipo: 'produtos' }, Buffer.alloc(5 * 1024 * 1024 + 10, 'a'));
        expect(res.status).toBe(413);
        expect(res.body.message).toBe('O arquivo deve ter no máximo 5 MB');
        expect(importacaoListaService.previa).not.toHaveBeenCalled();
    });

    test('dois arquivos: 400', async () => {
        const res = await request(app)
            .post('/importacao/previa')
            .set('Authorization', `Bearer ${admin}`)
            .field('tipo', 'produtos')
            .attach('arquivo', csv, 'a.csv')
            .attach('arquivo', csv, 'b.csv');
        expect(res.status).toBe(400);
    });
});

const TOKEN = 'a'.repeat(43);
const confirmar = (token, corpo) => request(app).post('/importacao/confirmar').set('Authorization', `Bearer ${token}`).send(corpo);

describe('POST /importacao/confirmar', () => {
    test('401 sem token; 403 para vendedor, estoquista e empresa sem a funcionalidade', async () => {
        expect((await request(app).post('/importacao/confirmar').send({ token: TOKEN })).status).toBe(401);
        expect((await confirmar(vendedor, { token: TOKEN })).status).toBe(403);
        expect((await confirmar(estoquista, { token: TOKEN })).status).toBe(403);

        comFuncionalidade(false);
        const res = await confirmar(admin, { token: TOKEN });
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(MENSAGEM);
        expect(confirmacaoService.confirmar).not.toHaveBeenCalled();
    });

    test('201 com o resultado; somente_validas assume falso; o usuário vem do JWT', async () => {
        confirmacaoService.confirmar.mockResolvedValue({ importacao_id: 55, criados: 3 });

        const res = await confirmar(admin, { token: TOKEN });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ success: true, data: { importacao_id: 55, criados: 3 } });
        expect(res.headers['cache-control']).toBe('no-store');
        expect(confirmacaoService.confirmar).toHaveBeenCalledWith({ token: TOKEN, somenteValidas: false }, expect.objectContaining({ id: 1, empresa_id: 1 }));
    });

    test('repassa somente_validas verdadeiro', async () => {
        confirmacaoService.confirmar.mockResolvedValue({});
        await confirmar(admin, { token: TOKEN, somente_validas: true });
        expect(confirmacaoService.confirmar).toHaveBeenCalledWith({ token: TOKEN, somenteValidas: true }, expect.anything());
    });

    test.each([
        [{}, 'sem token'],
        [{ token: 'curto' }, 'token curto'],
        [{ token: `${TOKEN}x` }, 'token longo'],
        [{ token: 123 }, 'token não texto'],
        [{ token: TOKEN, somente_validas: 'sim' }, 'somente_validas não booleano'],
        [{ token: TOKEN, empresa_id: 2 }, 'campo extra (empresa vem do JWT)']
    ])('400 para %j (%s)', async (corpo) => {
        const res = await confirmar(admin, corpo);
        expect(res.status).toBe(400);
        expect(confirmacaoService.confirmar).not.toHaveBeenCalled();
    });

    test('erros do service chegam com o status e a mensagem (404 prévia, 409 erros, 410 expirada)', async () => {
        for (const [status, msg] of [[404, 'Prévia não encontrada'], [409, 'Tem erro'], [410, 'A prévia expirou']]) {
            confirmacaoService.confirmar.mockRejectedValueOnce(new AppError(msg, status));
            const res = await confirmar(admin, { token: TOKEN });
            expect([res.status, res.body.message]).toEqual([status, msg]);
        }
    });
});

describe('GET /importacao/:id/relatorio', () => {
    const baixar = (id, token = admin) => request(app).get(`/importacao/${id}/relatorio`).set('Authorization', `Bearer ${token}`);

    test('401 sem token; 403 para vendedor e empresa sem a funcionalidade', async () => {
        expect((await request(app).get('/importacao/5/relatorio')).status).toBe(401);
        expect((await baixar(5, vendedor)).status).toBe(403);

        comFuncionalidade(false);
        expect((await baixar(5)).status).toBe(403);
        expect(confirmacaoService.relatorioCsv).not.toHaveBeenCalled();
    });

    test('baixa o CSV como anexo, sem cache, para a empresa do JWT', async () => {
        confirmacaoService.relatorioCsv.mockResolvedValue({ nome: 'relatorio-importacao-5.csv', conteudo: 'linha;resultado\r\n' });

        const res = await baixar(5);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/csv/);
        expect(res.headers['content-disposition']).toBe('attachment; filename="relatorio-importacao-5.csv"');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(confirmacaoService.relatorioCsv).toHaveBeenCalledWith(5, expect.objectContaining({ empresa_id: 1 }));
    });

    test.each(['abc', '0', '-1', '1.5'])('400 para id %p', async (id) => {
        expect((await baixar(id)).status).toBe(400);
        expect(confirmacaoService.relatorioCsv).not.toHaveBeenCalled();
    });

    test('importação de outra empresa ou não confirmada: o status do service', async () => {
        confirmacaoService.relatorioCsv.mockRejectedValueOnce(new AppError('Importação não encontrada', 404));
        confirmacaoService.relatorioCsv.mockRejectedValueOnce(new AppError('O relatório só existe depois da confirmação da importação', 409));
        expect((await baixar(9)).status).toBe(404);
        expect((await baixar(9)).status).toBe(409);
    });
});

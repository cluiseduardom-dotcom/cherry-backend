// Fiação da rota de importação (prévia e modelo): auth, papel, funcionalidade, upload e validação.
// A regra da prévia é coberta em tests/services/importacaoListaService.test.js; o service é mockado aqui.
jest.mock('../../src/services/importacaoListaService');

const request = require('supertest');
const app = require('../../src/app');
const importacaoListaService = require('../../src/services/importacaoListaService');
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

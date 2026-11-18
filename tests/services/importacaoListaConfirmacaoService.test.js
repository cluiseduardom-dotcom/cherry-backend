jest.mock('../../src/repositories/importacaoListaGravacaoRepository');
jest.mock('../../src/repositories/importacaoListaRepository');
jest.mock('../../src/repositories/estoqueRepository');
jest.mock('../../src/services/skuService');
jest.mock('../../src/services/produtosCodigosService', () => ({
    candidatosCodigoInterno: (id) => [String(id).padStart(6, '0'), `I${String(id).padStart(8, '0')}`]
}));

const crypto = require('node:crypto');
const gravacao = require('../../src/repositories/importacaoListaGravacaoRepository');
const importacaoListaRepository = require('../../src/repositories/importacaoListaRepository');
const estoqueRepository = require('../../src/repositories/estoqueRepository');
const skuService = require('../../src/services/skuService');
const service = require('../../src/services/importacaoListaConfirmacaoService');

const TOKEN = 'a'.repeat(43);
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');
const usuario = { id: 4, empresa_id: 9, role: 'admin' };
const client = { query: jest.fn() };

const importacao = (extra = {}) => ({ id: 55, empresa_id: 9, status: 'previa', total_com_erro: 0, ...extra });
const previa = (registros, extra = {}) => ({ tipo: 'produtos', registros, ignoradas: [], erros: [], ...extra });

function preparar({ imp = importacao(), dados, lancadoEm = null } = {}) {
    gravacao.buscarPreviaPorToken.mockResolvedValue({ importacao_id: 55, expirada: false });
    gravacao.comImportacaoTravada.mockImplementation(async (id, empresaId, callback) => callback(imp, client));
    gravacao.consumirPrevia.mockResolvedValue(dados);
    gravacao.travarEmpresa.mockResolvedValue(lancadoEm);
}

beforeEach(() => {
    jest.resetAllMocks();
    importacaoListaRepository.buscarProdutosExistentes.mockResolvedValue([]);
    importacaoListaRepository.buscarTelefonesDeClientes.mockResolvedValue([]);
    gravacao.buscarCategoriasPorIds.mockResolvedValue([]);
    gravacao.inserirProdutos.mockImplementation(async (c, { produtos }) => new Map(produtos.map((p, i) => [p.sku, 100 + i])));
    gravacao.vincularCategorias.mockResolvedValue();
    gravacao.registrarSkusGerados.mockResolvedValue();
    gravacao.inserirCodigosInternos.mockImplementation(async (c, { produto_ids }) => ({ criados: produto_ids.length, sem_codigo: [] }));
    gravacao.gravarTravaEstoqueInicial.mockResolvedValue();
    gravacao.marcarConfirmada.mockResolvedValue();
    gravacao.inserirClientes.mockImplementation(async (c, { clientes }) => new Map(clientes.map((cl, i) => [cl.telefone, 700 + i])));
    estoqueRepository.criarEntradasIniciaisEmLote.mockImplementation(async ({ itens }) => ({ movimentacoes: itens.length, unidades: itens.reduce((a, i) => a + i.quantidade, 0) }));
});

describe('confirmar: acesso ao token', () => {
    test('token desconhecido ou de outra empresa: 404, sem abrir transação', async () => {
        gravacao.buscarPreviaPorToken.mockResolvedValue(null);
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 404 });
        expect(gravacao.buscarPreviaPorToken).toHaveBeenCalledWith(TOKEN_HASH, 9);
        expect(gravacao.comImportacaoTravada).not.toHaveBeenCalled();
    });

    test('o token chega ao banco só como hash SHA-256', async () => {
        preparar({ dados: previa([]) });
        await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);
        expect(JSON.stringify([...gravacao.buscarPreviaPorToken.mock.calls, ...gravacao.consumirPrevia.mock.calls])).not.toContain(TOKEN);
        expect(gravacao.consumirPrevia).toHaveBeenCalledWith(client, { importacao_id: 55, token_hash: TOKEN_HASH, empresa_id: 9 });
    });

    test('prévia vencida: 410', async () => {
        gravacao.buscarPreviaPorToken.mockResolvedValue({ importacao_id: 55, expirada: true });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 410 });
        expect(gravacao.comImportacaoTravada).not.toHaveBeenCalled();
    });

    test('vencida entre a busca e o consumo: 410 (a transação desfaz tudo)', async () => {
        preparar({ dados: null });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 410 });
        expect(gravacao.marcarConfirmada).not.toHaveBeenCalled();
    });

    test('importação já confirmada: 409', async () => {
        preparar({ imp: importacao({ status: 'confirmada' }), dados: previa([]) });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 409, message: 'Esta importação já foi confirmada' });
        expect(gravacao.consumirPrevia).not.toHaveBeenCalled();
    });

    test('importação lida com a empresa do JWT: o lock filtra por ela', async () => {
        preparar({ dados: previa([]) });
        await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);
        expect(gravacao.comImportacaoTravada).toHaveBeenCalledWith(55, 9, expect.any(Function));
        expect(gravacao.travarEmpresa).toHaveBeenCalledWith(client, 9);
    });
});

describe('confirmar: prévia com erros', () => {
    test('padrão: bloqueia e não consome o token', async () => {
        preparar({ imp: importacao({ total_com_erro: 3 }), dados: previa([]) });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/3 linha\(s\) com erro/)
        });
        expect(gravacao.consumirPrevia).not.toHaveBeenCalled();
    });

    test('opção explícita: confirma só as válidas e o relatório lista o que ficou de fora', async () => {
        preparar({
            imp: importacao({ total_com_erro: 1 }),
            dados: previa([{ linha: 2, nome: 'Anel', custo: '10.00', saldo: 0, sku: 'A1', categoria_id: null, local_id: 1 }], {
                ignoradas: [{ linha: 4, motivo: 'já existe produto com este nome; a linha foi ignorada' }],
                erros: [{ linha: 3, coluna: 'custo', motivo: 'valor inválido' }, { linha: 3, coluna: 'saldo', motivo: 'inteiro' }]
            })
        });

        const r = await service.confirmar({ token: TOKEN, somenteValidas: true }, usuario);

        expect(r).toMatchObject({ criados: 1, ignorados: 1, nao_importados: 1, sem_preco: 1, relatorio_url: '/importacao/55/relatorio' });
        const { relatorio } = gravacao.marcarConfirmada.mock.calls[0][1];
        expect(relatorio.linhas.map((l) => [l.linha, l.resultado])).toEqual([[2, 'criado'], [3, 'nao_importado'], [3, 'nao_importado'], [4, 'ignorado']]);
    });
});

describe('confirmar produtos', () => {
    const registros = [
        { linha: 2, nome: 'Anel Ouro', custo: '12.50', saldo: 5, sku: null, categoria_id: 7, local_id: 10 },
        { linha: 3, nome: 'Brinco', custo: '8.00', saldo: 3, sku: 'BR-1', categoria_id: null, local_id: 30 },
        { linha: 4, nome: 'Colar', custo: '20.00', saldo: 0, sku: 'CL-1', categoria_id: null, local_id: 10 }
    ];

    beforeEach(() => {
        // Como o repository real: devolve só as categorias pedidas que ainda existem.
        gravacao.buscarCategoriasPorIds.mockImplementation(async (c, ids) => ids.map((id) => ({ id, nivel: 1, codigo: 'AN' })));
        skuService.gerar.mockResolvedValue({ sku: 'AN-001', configuracao: { id: 3 } });
        gravacao.inserirProdutos
            .mockResolvedValueOnce(new Map([['BR-1', 11], ['CL-1', 12]]))
            .mockResolvedValueOnce(new Map([['AN-001', 13]]));
    });

    test('grava informados, depois gera SKU, vincula categoria, lança estoque em lote, códigos e a trava', async () => {
        preparar({ dados: previa(registros) });

        const r = await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);

        expect(r).toMatchObject({
            importacao_id: 55, tipo: 'produtos', criados: 3, ignorados: 0, skus_gerados: 1,
            com_estoque_inicial: 2, unidades_estoque_inicial: 8, codigos_gerados: 2, sem_preco: 3
        });

        const base = { empresa_id: 9, importacao_id: 55 };
        expect(gravacao.inserirProdutos).toHaveBeenNthCalledWith(1, client, { ...base, produtos: [registros[1], registros[2]].map((p) => expect.objectContaining({ sku: p.sku })) });
        expect(gravacao.inserirProdutos.mock.calls[1][1].produtos).toEqual([expect.objectContaining({ nome: 'Anel Ouro', sku: 'AN-001' })]);
        expect(skuService.gerar).toHaveBeenCalledWith([{ id: 7, nivel: 1, codigo: 'AN' }], 9, client, 'produto', undefined);
        expect(gravacao.buscarCategoriasPorIds).toHaveBeenCalledWith(client, [7], 9);

        expect(gravacao.vincularCategorias).toHaveBeenCalledWith(client, { empresa_id: 9, vinculos: [{ produto_id: 13, categoria_id: 7 }] });
        expect(gravacao.registrarSkusGerados).toHaveBeenCalledWith(client, { empresa_id: 9, usuario_id: 4, itens: [{ produto_id: 13, sku: 'AN-001', configuracao_id: 3 }] });
        expect(estoqueRepository.criarEntradasIniciaisEmLote).toHaveBeenCalledWith({
            itens: [{ produto_id: 13, quantidade: 5, local_id: 10 }, { produto_id: 11, quantidade: 3, local_id: 30 }],
            usuario_id: 4,
            empresa_id: 9
        }, client);
        expect(gravacao.inserirCodigosInternos.mock.calls[0][1].produto_ids).toEqual([13, 11]);
        expect(gravacao.gravarTravaEstoqueInicial).toHaveBeenCalledWith(client, 9);
        expect(gravacao.marcarConfirmada).toHaveBeenCalledWith(client, expect.objectContaining({ importacao_id: 55, empresa_id: 9, usuario_id: 4 }));
    });

    test('reusa a configuração do padrão de SKU entre linhas da mesma categoria', async () => {
        const dois = [
            { linha: 2, nome: 'A', custo: '1.00', saldo: 0, sku: null, categoria_id: 7, local_id: 10 },
            { linha: 3, nome: 'B', custo: '1.00', saldo: 0, sku: null, categoria_id: 7, local_id: 10 }
        ];
        skuService.gerar.mockReset();
        skuService.gerar.mockResolvedValueOnce({ sku: 'AN-001', configuracao: { id: 3 } }).mockResolvedValueOnce({ sku: 'AN-002', configuracao: { id: 3 } });
        gravacao.inserirProdutos.mockReset();
        gravacao.inserirProdutos.mockResolvedValueOnce(new Map()).mockResolvedValueOnce(new Map([['AN-001', 1], ['AN-002', 2]]));
        preparar({ dados: previa(dois) });

        await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);

        expect(skuService.gerar.mock.calls[0][4]).toBeUndefined();
        expect(skuService.gerar.mock.calls[1][4]).toEqual({ id: 3 });
    });

    test('sem saldo em nenhuma linha: não mexe em estoque nem na trava', async () => {
        const semSaldo = [{ linha: 2, nome: 'Colar', custo: '20.00', saldo: 0, sku: 'CL-1', categoria_id: null, local_id: 10 }];
        gravacao.inserirProdutos.mockReset();
        gravacao.inserirProdutos.mockResolvedValue(new Map([['CL-1', 12]]));
        preparar({ dados: previa(semSaldo) });

        const r = await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);

        expect(r).toMatchObject({ criados: 1, com_estoque_inicial: 0, codigos_gerados: 0 });
        expect(gravacao.gravarTravaEstoqueInicial).not.toHaveBeenCalled();
    });

    test('trava por empresa gravada depois da prévia: saldo recusado com 409 e nada é inserido', async () => {
        preparar({ dados: previa(registros), lancadoEm: new Date() });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/saldo inicial já foi lançado/) });
        expect(gravacao.inserirProdutos).not.toHaveBeenCalled();
    });

    test('com a trava gravada, importar produto sem saldo continua permitido', async () => {
        const semSaldo = [{ linha: 2, nome: 'Colar', custo: '20.00', saldo: 0, sku: 'CL-1', categoria_id: null, local_id: 10 }];
        gravacao.inserirProdutos.mockReset();
        gravacao.inserirProdutos.mockResolvedValue(new Map([['CL-1', 12]]));
        preparar({ dados: previa(semSaldo), lancadoEm: new Date() });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).resolves.toMatchObject({ criados: 1 });
    });

    test('duplicado criado depois da prévia (SKU ou nome): a linha vira "ignorado" e as outras entram', async () => {
        importacaoListaRepository.buscarProdutosExistentes.mockResolvedValue([
            { sku: 'br-1', nome: 'Outro', tipo: 'acabado' },
            { sku: null, nome: 'Anel  OURO', tipo: 'acabado' }
        ]);
        gravacao.inserirProdutos.mockReset();
        gravacao.inserirProdutos.mockResolvedValue(new Map([['CL-1', 12]]));
        preparar({ dados: previa(registros) });

        const r = await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);

        expect(r).toMatchObject({ criados: 1, ignorados: 2, com_estoque_inicial: 0 });
        expect(importacaoListaRepository.buscarProdutosExistentes).toHaveBeenCalledWith(9, client);
        const { relatorio } = gravacao.marcarConfirmada.mock.calls[0][1];
        expect(relatorio.linhas.filter((l) => l.resultado === 'ignorado').map((l) => l.linha)).toEqual([2, 3]);
    });

    test('categoria removida depois da prévia: 409', async () => {
        gravacao.buscarCategoriasPorIds.mockResolvedValue([]);
        preparar({ dados: previa(registros) });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/categoria/) });
        expect(gravacao.inserirProdutos).not.toHaveBeenCalled();
    });

    test('local indisponível: 409 citando a linha, e a confirmação não é marcada', async () => {
        estoqueRepository.criarEntradasIniciaisEmLote.mockResolvedValue({ erro: 'LOCAL_NAO_ENCONTRADO', local_id: 30 });
        preparar({ dados: previa(registros) });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/linha 3/) });
        expect(gravacao.marcarConfirmada).not.toHaveBeenCalled();
        expect(gravacao.gravarTravaEstoqueInicial).not.toHaveBeenCalled();
    });

    test.each(['ENTRADA_INICIAL_COM_HISTORICO', 'PRODUTO_NAO_ENCONTRADO'])('erro %s do estoque derruba a confirmação inteira', async (erro) => {
        estoqueRepository.criarEntradasIniciaisEmLote.mockResolvedValue({ erro });
        preparar({ dados: previa(registros) });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 409 });
        expect(gravacao.marcarConfirmada).not.toHaveBeenCalled();
    });

    test('produto sem código de barras gerado: 409 (tudo desfeito pela transação)', async () => {
        gravacao.inserirCodigosInternos.mockResolvedValue({ criados: 1, sem_codigo: [13] });
        preparar({ dados: previa(registros) });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toMatchObject({ statusCode: 409 });
        expect(gravacao.gravarTravaEstoqueInicial).not.toHaveBeenCalled();
    });

    test('falha inesperada do gerador de SKU propaga (rollback na transação)', async () => {
        skuService.gerar.mockRejectedValue(new Error('banco caiu'));
        preparar({ dados: previa(registros) });
        await expect(service.confirmar({ token: TOKEN, somenteValidas: false }, usuario)).rejects.toThrow('banco caiu');
        expect(gravacao.marcarConfirmada).not.toHaveBeenCalled();
    });

    test('candidatos de código interno: o curto (6 dígitos) e, se ocupado, o longo', async () => {
        preparar({ dados: previa(registros) });
        await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);
        const { candidatos } = gravacao.inserirCodigosInternos.mock.calls[0][1];
        expect(candidatos.map((gerar) => gerar(42))).toEqual(['000042', 'I00000042']);
    });
});

describe('confirmar clientes', () => {
    const registros = [
        { linha: 2, nome: 'Maria', telefone: '11912345678', data_nascimento: '1990-03-05', observacoes: null },
        { linha: 3, nome: 'Joana', telefone: '21988887777', data_nascimento: null, observacoes: 'VIP' }
    ];

    test('cria os clientes com o responsável do JWT e devolve o resumo, sem tocar em estoque', async () => {
        preparar({ dados: { tipo: 'clientes', registros, ignoradas: [{ linha: 4, motivo: 'duplicado' }], erros: [] } });

        const r = await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);

        expect(r).toMatchObject({ tipo: 'clientes', criados: 2, ignorados: 1, nao_importados: 0 });
        expect(r.sem_preco).toBeUndefined();
        expect(gravacao.inserirClientes).toHaveBeenCalledWith(client, { empresa_id: 9, importacao_id: 55, usuario_id: 4, clientes: registros });
        expect(estoqueRepository.criarEntradasIniciaisEmLote).not.toHaveBeenCalled();
        expect(gravacao.gravarTravaEstoqueInicial).not.toHaveBeenCalled();
    });

    test('telefone cadastrado depois da prévia (em qualquer formato): ignorado', async () => {
        importacaoListaRepository.buscarTelefonesDeClientes.mockResolvedValue(['(11) 91234-5678']);
        preparar({ dados: { tipo: 'clientes', registros, ignoradas: [], erros: [] } });

        const r = await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);

        expect(r).toMatchObject({ criados: 1, ignorados: 1 });
        expect(importacaoListaRepository.buscarTelefonesDeClientes).toHaveBeenCalledWith(9, client);
        expect(gravacao.inserirClientes.mock.calls[0][1].clientes).toEqual([registros[1]]);
    });

    test('o relatório de clientes não carrega nome nem telefone', async () => {
        preparar({ dados: { tipo: 'clientes', registros, ignoradas: [], erros: [] } });
        await service.confirmar({ token: TOKEN, somenteValidas: false }, usuario);
        expect(JSON.stringify(gravacao.marcarConfirmada.mock.calls[0][1].relatorio)).not.toMatch(/Maria|Joana|1191234|2198888/);
    });
});

describe('relatorioCsv', () => {
    test('importação de outra empresa ou inexistente: 404', async () => {
        gravacao.buscarRelatorio.mockResolvedValue(null);
        await expect(service.relatorioCsv(55, usuario)).rejects.toMatchObject({ statusCode: 404 });
        expect(gravacao.buscarRelatorio).toHaveBeenCalledWith(55, 9);
    });

    test('antes da confirmação: 409', async () => {
        gravacao.buscarRelatorio.mockResolvedValue({ id: 55, tipo: 'produtos', status: 'previa', relatorio: null });
        await expect(service.relatorioCsv(55, usuario)).rejects.toMatchObject({ statusCode: 409 });
    });

    test('devolve o CSV com nome fixo e fórmulas neutralizadas', async () => {
        gravacao.buscarRelatorio.mockResolvedValue({
            id: 55, tipo: 'produtos', status: 'confirmada',
            relatorio: { linhas: [{ linha: 2, resultado: 'criado', id: 1, nome: '=1+1', sku: 'A1', saldo: 0, detalhe: '' }] }
        });
        const r = await service.relatorioCsv(55, usuario);
        expect(r.nome).toBe('relatorio-importacao-55.csv');
        expect(r.conteudo).toContain("'=1+1");
    });
});

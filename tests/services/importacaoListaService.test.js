jest.mock('../../src/repositories/importacaoListaRepository');
jest.mock('../../src/repositories/configuracoesSkuRepository');

const crypto = require('node:crypto');
const repo = require('../../src/repositories/importacaoListaRepository');
const skuRepo = require('../../src/repositories/configuracoesSkuRepository');
const AppError = require('../../src/errors/AppError');
const service = require('../../src/services/importacaoListaService');

const usuario = { id: 4, role: 'admin', empresa_id: 9 };
const arquivo = (csv, originalname = 'lista.csv') => ({ buffer: Buffer.from(csv, 'utf8'), originalname });

beforeEach(() => {
    jest.resetAllMocks();
    repo.buscarProdutosExistentes.mockResolvedValue([]);
    repo.buscarCategoriasDeProduto.mockResolvedValue([{ id: 7, nome: 'Anéis', nivel: 1 }]);
    repo.buscarLocaisImportaveis.mockResolvedValue([{ id: 10, nome: 'Central', tipo: 'central' }, { id: 30, nome: 'Maleta Ana', tipo: 'maleta' }]);
    repo.buscarTelefonesDeClientes.mockResolvedValue([]);
    repo.buscarEstoqueInicialLancadoEm.mockResolvedValue(null);
    repo.expirarPreviasVencidas.mockResolvedValue();
    repo.registrarPrevia.mockResolvedValue({ id: 55, criada_em: new Date(), expira_em: '2026-11-17T15:30:00.000Z' });
    skuRepo.buscarParaCategorias.mockResolvedValue({ segmentos: [{ nivel: 1, nome: 'Família', obrigatorio: true, participa_sku: true }] });
});

describe('gerarModelo', () => {
    test('CSV só com cabeçalho, com BOM e ponto e vírgula', () => {
        const m = service.gerarModelo('produtos', 'csv');
        expect(m.nome).toBe('modelo-produtos.csv');
        expect(m.conteudo).toBe('\uFEFFnome;custo;saldo;sku;categoria;local\r\n');
        expect(service.gerarModelo('clientes', 'csv').conteudo).toBe('\uFEFFnome;telefone;nascimento;observacoes\r\n');
    });

    test('xlsx ainda não existe', () => {
        expect(() => service.gerarModelo('produtos', 'xlsx')).toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/só o formato CSV/) }));
    });
});

describe('previa de produtos', () => {
    const csv = [
        'nome;custo;saldo;sku;categoria;local',
        'Anel Ouro;12,50;5;;Anéis;',
        'Brinco Prata;8,00;;BR-1;;Maleta Ana',
        'Colar;abc;;C1;;',
        'Anel Ouro;1;;X1;;'
    ].join('\n');

    test('devolve totais, problemas por linha e um token de uso único; nada de negócio é gravado', async () => {
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo(csv) }, usuario);

        expect(r.totais).toEqual({ linhas: 4, validas: 2, com_aviso: 1, com_erro: 1, a_criar: 2, ignoradas: 1 });
        expect(r.pode_confirmar).toBe(false);
        expect(r.pode_confirmar_somente_validas).toBe(true);
        expect(r.problemas).toEqual([
            { linha: 4, coluna: 'custo', nivel: 'erro', motivo: expect.stringMatching(/apenas números/) },
            { linha: 5, coluna: null, nivel: 'aviso', motivo: expect.stringMatching(/repetido no arquivo \(linha 2\)/) }
        ]);
        expect(r.importacao_id).toBe(55);
        expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(r.expira_em).toBe('2026-11-17T15:30:00.000Z');
    });

    test('guarda só o hash do token, o hash do arquivo e as linhas a criar; empresa e usuário vêm do JWT', async () => {
        const conteudo = arquivo(csv, 'C:\\Users\\loja\\lista.csv');
        const r = await service.previa({ tipo: 'produtos', arquivo: conteudo }, usuario);

        const gravado = repo.registrarPrevia.mock.calls[0][0];
        expect(gravado).toMatchObject({
            empresa_id: 9,
            usuario_id: 4,
            tipo: 'produtos',
            nome_arquivo: 'lista.csv',
            hash_sha256: crypto.createHash('sha256').update(conteudo.buffer).digest('hex'),
            local_padrao_id: 10
        });
        expect(gravado.previa.token_hash).toBe(crypto.createHash('sha256').update(r.token).digest('hex'));
        expect(JSON.stringify(gravado)).not.toContain(r.token);
        expect(gravado.previa.ttl_minutos).toBe(30);
        expect(gravado.previa.dados.registros).toEqual([
            { linha: 2, nome: 'Anel Ouro', custo: '12.50', saldo: 5, sku: null, categoria_id: 7, local_id: 10 },
            { linha: 3, nome: 'Brinco Prata', custo: '8.00', saldo: 0, sku: 'BR-1', categoria_id: null, local_id: 30 }
        ]);
    });

    test('todas as consultas de contexto são da empresa do JWT (isolamento)', async () => {
        await service.previa({ tipo: 'produtos', arquivo: arquivo(csv) }, usuario);

        for (const fn of [repo.expirarPreviasVencidas, repo.buscarProdutosExistentes, repo.buscarCategoriasDeProduto, repo.buscarLocaisImportaveis, repo.buscarEstoqueInicialLancadoEm]) {
            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenCalledWith(9);
        }
        expect(skuRepo.buscarParaCategorias).toHaveBeenCalledWith([7], 9, undefined, 'produto');
    });

    test('sem nada a criar não guarda prévia nem devolve token', async () => {
        repo.registrarPrevia.mockResolvedValue({ id: 56, criada_em: new Date(), expira_em: null });
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo\nColar;abc') }, usuario);

        expect(r.token).toBeNull();
        expect(r.expira_em).toBeNull();
        expect(r.pode_confirmar).toBe(false);
        expect(r.pode_confirmar_somente_validas).toBe(false);
        expect(repo.registrarPrevia.mock.calls[0][0].previa).toBeNull();
    });

    test('tudo certo: pode confirmar', async () => {
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;sku\nAnel;10;A1\nBrinco;5;B1') }, usuario);
        expect(r.pode_confirmar).toBe(true);
        expect(r.pode_confirmar_somente_validas).toBe(false);
    });

    test('duplicado contra produtos da empresa (SKU e nome normalizado); insumo não conflita', async () => {
        repo.buscarProdutosExistentes.mockResolvedValue([
            { sku: 'a1', nome: 'Outro', tipo: 'acabado' },
            { sku: null, nome: 'Pulseira Ação', tipo: 'acabado' },
            { sku: 'I1', nome: 'Fio de Ouro', tipo: 'insumo' }
        ]);
        const r = await service.previa(
            { tipo: 'produtos', arquivo: arquivo('nome;custo;sku\nAnel;1;A1\npulseira acao;1;P1\nFio de Ouro;1;F1') },
            usuario
        );
        expect(r.totais).toMatchObject({ a_criar: 1, ignoradas: 2 });
        expect(r.problemas.map((p) => p.linha)).toEqual([2, 3]);
    });

    test('empresa com estoque inicial já lançado: saldo > 0 vira erro', async () => {
        repo.buscarEstoqueInicialLancadoEm.mockResolvedValue(new Date());
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;sku;saldo\nAnel;1;A1;3\nBrinco;1;B1;') }, usuario);
        expect(r.totais).toMatchObject({ com_erro: 1, a_criar: 1 });
        expect(r.problemas[0]).toMatchObject({ linha: 2, coluna: 'saldo', nivel: 'erro' });
    });

    test('padrão de SKU que exige outro nível: erro na linha sem SKU, sem consumir a sequência', async () => {
        skuRepo.buscarParaCategorias.mockResolvedValue({
            segmentos: [{ nivel: 1, nome: 'Família', obrigatorio: true, participa_sku: true }, { nivel: 2, nome: 'Material', obrigatorio: true, participa_sku: true }]
        });
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;categoria;sku\nAnel;1;Anéis;\nBrinco;1;Anéis;B1') }, usuario);
        expect(r.problemas).toEqual([{ linha: 2, coluna: 'categoria', nivel: 'erro', motivo: expect.stringMatching(/exige também o nível "Material"/) }]);
        expect(r.totais).toMatchObject({ com_erro: 1, a_criar: 1 });
    });

    test('empresa sem padrão de SKU: erro orientando a informar o SKU', async () => {
        skuRepo.buscarParaCategorias.mockResolvedValue(null);
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;categoria\nAnel;1;Anéis') }, usuario);
        expect(r.problemas[0].motivo).toMatch(/não tem padrão de SKU/);
    });

    test('erro inesperado ao consultar o padrão de SKU não é engolido', async () => {
        skuRepo.buscarParaCategorias.mockRejectedValue(new Error('falha de banco'));
        await expect(service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;categoria\nAnel;1;Anéis') }, usuario)).rejects.toThrow('falha de banco');
    });

    test('local padrão escolhido: tem que ser da empresa; senão 404', async () => {
        await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;sku\nAnel;1;A1'), localPadraoId: 30 }, usuario);
        expect(repo.registrarPrevia.mock.calls[0][0].local_padrao_id).toBe(30);

        await expect(service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;sku\nAnel;1;A1'), localPadraoId: 999 }, usuario)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('empresa sem Central ainda: local padrão nulo (a confirmação cria o Central)', async () => {
        repo.buscarLocaisImportaveis.mockResolvedValue([]);
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;sku\nAnel;1;A1') }, usuario);
        expect(repo.registrarPrevia.mock.calls[0][0].previa.dados.registros[0].local_id).toBeNull();
        expect(r.totais.a_criar).toBe(1);
    });

    test('avisos de arquivo: coluna de preço é ignorada com a orientação', async () => {
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo;preço\nAnel;1;99;') }, usuario);
        expect(r.colunas_ignoradas).toEqual(['preço']);
        expect(r.avisos_do_arquivo[0]).toMatch(/Precificar por canal/);
    });

    test('corta a lista de problemas em 1.000 e avisa que foi cortada', async () => {
        const linhas = Array.from({ length: 1200 }, (_, i) => `Produto ${i};abc;S${i}`);
        const r = await service.previa({ tipo: 'produtos', arquivo: arquivo(['nome;custo;sku', ...linhas].join('\n')) }, usuario);
        expect(r.totais.com_erro).toBe(1200);
        expect(r.problemas).toHaveLength(1000);
        expect(r.problemas_truncados).toBe(true);
    });
});

describe('previa de clientes', () => {
    test('valida, compara telefone com os cadastrados (qualquer formato) e não usa local nem SKU', async () => {
        repo.buscarTelefonesDeClientes.mockResolvedValue(['(11) 91234-5678', '+55 21 98888-7777']);
        const csv = ['nome,telefone,nascimento,observacoes', 'Maria,11912345678,05/03/1990,VIP', 'Joana,"(21) 98888-7777",,', 'Ana,11 97777-6666,31/02/1990,'].join('\n');

        const r = await service.previa({ tipo: 'clientes', arquivo: arquivo(csv, 'clientes.csv') }, usuario);

        expect(r.totais).toEqual({ linhas: 3, validas: 0, com_aviso: 2, com_erro: 1, a_criar: 0, ignoradas: 2 });
        expect(r.token).toBeNull();
        expect(repo.buscarProdutosExistentes).not.toHaveBeenCalled();
        expect(repo.buscarTelefonesDeClientes).toHaveBeenCalledWith(9);
        expect(repo.registrarPrevia.mock.calls[0][0]).toMatchObject({ tipo: 'clientes', local_padrao_id: undefined });
    });

    test('clientes válidos geram prévia com as linhas normalizadas', async () => {
        const r = await service.previa({ tipo: 'clientes', arquivo: arquivo('nome;telefone;nascimento\nMaria;(11) 91234-5678;05/03/1990') }, usuario);
        expect(r.pode_confirmar).toBe(true);
        expect(repo.registrarPrevia.mock.calls[0][0].previa.dados).toEqual({
            tipo: 'clientes',
            registros: [{ linha: 2, nome: 'Maria', telefone: '11912345678', data_nascimento: '1990-03-05', observacoes: null }]
        });
    });
});

describe('previa: arquivo inválido', () => {
    test('sem arquivo', async () => {
        await expect(service.previa({ tipo: 'produtos', arquivo: undefined }, usuario)).rejects.toMatchObject({ statusCode: 400 });
    });

    test('Excel, cabeçalho errado e aspas abertas derrubam o arquivo antes de qualquer consulta', async () => {
        const zip = { buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xx')]), originalname: 'a.csv' };
        await expect(service.previa({ tipo: 'produtos', arquivo: zip }, usuario)).rejects.toBeInstanceOf(AppError);
        await expect(service.previa({ tipo: 'produtos', arquivo: arquivo('nome;preco\nA;1') }, usuario)).rejects.toMatchObject({ message: expect.stringMatching(/custo/) });
        await expect(service.previa({ tipo: 'produtos', arquivo: arquivo('nome;custo\n"aberta;1') }, usuario)).rejects.toMatchObject({ message: expect.stringMatching(/aspas/) });

        expect(repo.expirarPreviasVencidas).not.toHaveBeenCalled();
        expect(repo.registrarPrevia).not.toHaveBeenCalled();
    });

    test('o conteúdo do arquivo nunca vai para log', async () => {
        const espiao = jest.spyOn(console, 'log').mockImplementation(() => {});
        const erros = jest.spyOn(console, 'error').mockImplementation(() => {});
        await service.previa({ tipo: 'clientes', arquivo: arquivo('nome;telefone\nSEGREDO PESSOAL;11912345678') }, usuario);
        const tudo = JSON.stringify([...espiao.mock.calls, ...erros.mock.calls]);
        expect(tudo).not.toContain('SEGREDO PESSOAL');
        espiao.mockRestore();
        erros.mockRestore();
    });
});

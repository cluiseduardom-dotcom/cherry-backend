const { validarProdutos } = require('../../../src/services/importacaoLista/validadorProdutos');
const { validarClientes } = require('../../../src/services/importacaoLista/validadorClientes');

const linha = (n, valores, extra = {}) => ({ linha: n, valores, colunasAMais: false, ...extra });

const contextoProdutos = (sobrescrever = {}) => ({
    skusExistentes: new Set(),
    nomesExistentes: new Set(),
    categorias: new Map([['aneis', [{ id: 7, nome: 'Anéis', nivel: 1 }]], ['duplicada', [{ id: 1, nome: 'D', nivel: 1 }, { id: 2, nome: 'D', nivel: 2 }]]]),
    skuGeravel: new Map([[7, { ok: true }]]),
    locais: new Map([['maleta ana', [{ id: 30, nome: 'Maleta Ana' }]], ['dup', [{ id: 1 }, { id: 2 }]]]),
    localPadraoId: 10,
    saldoTravado: false,
    ...sobrescrever
});

const problemasDe = (r) => r.problemas.map((p) => `${p.nivel}:${p.coluna}`);

describe('validarProdutos', () => {
    test('linha válida: normaliza e cria, com local padrão e SKU a gerar', () => {
        const [r] = validarProdutos([linha(2, { nome: '  Anel  Ouro ', custo: 'R$ 12,50', saldo: '5', sku: '', categoria: 'ANÉIS', local: '' })], contextoProdutos());
        expect(r).toEqual({
            linha: 2,
            acao: 'criar',
            problemas: [],
            dados: { nome: 'Anel Ouro', custo: '12.50', saldo: 5, sku: null, categoria_id: 7, local_id: 10 }
        });
    });

    test('local da linha vence o padrão', () => {
        const [r] = validarProdutos([linha(2, { nome: 'Anel', custo: '1', sku: 'A1', local: 'Maleta  ANA' })], contextoProdutos());
        expect(r.dados.local_id).toBe(30);
    });

    test('erros por coluna, sem derrubar as outras linhas', () => {
        const rs = validarProdutos(
            [
                linha(2, { nome: 'A', custo: 'abc', saldo: '2,5', sku: 'a b', categoria: '', local: 'Nada' }),
                linha(3, { nome: 'Brinco', custo: '5', sku: 'B1' })
            ],
            contextoProdutos()
        );
        expect(rs[0].acao).toBe('erro');
        expect(problemasDe(rs[0])).toEqual(['erro:nome', 'erro:custo', 'erro:saldo', 'erro:sku', 'erro:local']);
        expect(rs[1].acao).toBe('criar');
    });

    test('custo é obrigatório', () => {
        const [r] = validarProdutos([linha(2, { nome: 'Anel', custo: '', sku: 'A1' })], contextoProdutos());
        expect(r.problemas).toEqual([{ coluna: 'custo', nivel: 'erro', motivo: 'o custo é obrigatório' }]);
    });

    test('sem SKU e sem categoria: erro (todo item tem SKU)', () => {
        const [r] = validarProdutos([linha(2, { nome: 'Anel', custo: '1' })], contextoProdutos());
        expect(r.acao).toBe('erro');
        expect(r.problemas[0].motivo).toMatch(/informe o SKU ou uma categoria/);
    });

    test('categoria desconhecida: aviso se há SKU, erro se não há', () => {
        const [comSku] = validarProdutos([linha(2, { nome: 'Anel', custo: '1', sku: 'A1', categoria: 'Inexistente' })], contextoProdutos());
        expect(comSku.acao).toBe('criar');
        expect(comSku.dados.categoria_id).toBeNull();
        expect(problemasDe(comSku)).toEqual(['aviso:categoria']);

        const [semSku] = validarProdutos([linha(3, { nome: 'Anel', custo: '1', categoria: 'Inexistente' })], contextoProdutos());
        expect(semSku.acao).toBe('erro');
        expect(semSku.problemas[0].motivo).toMatch(/não encontrada e SKU não informado/);
    });

    test('categoria ambígua é erro', () => {
        const [r] = validarProdutos([linha(2, { nome: 'Anel', custo: '1', sku: 'A1', categoria: 'Duplicada' })], contextoProdutos());
        expect(r.problemas[0]).toMatchObject({ coluna: 'categoria', nivel: 'erro' });
    });

    test('padrão de SKU que não gera com essa categoria só vale sem SKU informado', () => {
        const ctx = contextoProdutos({ skuGeravel: new Map([[7, { ok: false, motivo: 'exige o nível Material' }]]) });
        const [semSku] = validarProdutos([linha(2, { nome: 'Anel', custo: '1', categoria: 'Anéis' })], ctx);
        expect(semSku.problemas).toEqual([{ coluna: 'categoria', nivel: 'erro', motivo: 'exige o nível Material' }]);

        const [comSku] = validarProdutos([linha(3, { nome: 'Anel', custo: '1', categoria: 'Anéis', sku: 'A1' })], ctx);
        expect(comSku.acao).toBe('criar');
    });

    test('local ambíguo ou inexistente é erro', () => {
        const rs = validarProdutos(
            [linha(2, { nome: 'A1', custo: '1', sku: 'S1', local: 'dup' }), linha(3, { nome: 'A2', custo: '1', sku: 'S2', local: 'Fantasma' })],
            contextoProdutos()
        );
        expect(rs.map((r) => r.acao)).toEqual(['erro', 'erro']);
    });

    test('saldo travado: saldo > 0 é erro, saldo vazio ou 0 passa', () => {
        const ctx = contextoProdutos({ saldoTravado: true });
        const rs = validarProdutos(
            [
                linha(2, { nome: 'Com Saldo', custo: '1', sku: 'S1', saldo: '3' }),
                linha(3, { nome: 'Sem Saldo', custo: '1', sku: 'S2', saldo: '' }),
                linha(4, { nome: 'Saldo Zero', custo: '1', sku: 'S3', saldo: '0' })
            ],
            ctx
        );
        expect(rs[0].acao).toBe('erro');
        expect(rs[0].problemas[0]).toEqual({ coluna: 'saldo', nivel: 'erro', motivo: 'saldo inicial já lançado para esta empresa; deixe o saldo vazio' });
        expect(rs.slice(1).map((r) => r.acao)).toEqual(['criar', 'criar']);
    });

    describe('duplicidade', () => {
        test('contra o que já existe na empresa: por SKU e por nome normalizado (caixa, acento, espaços)', () => {
            const ctx = contextoProdutos({ skusExistentes: new Set(['A1']), nomesExistentes: new Set(['anel de acao']) });
            const rs = validarProdutos(
                [
                    linha(2, { nome: 'Outro', custo: '1', sku: 'a1' }),
                    linha(3, { nome: '  ANEL  de Ação ', custo: '1', sku: 'Z9' })
                ],
                ctx
            );
            expect(rs.map((r) => r.acao)).toEqual(['ignorar', 'ignorar']);
            expect(rs[0].problemas[0].motivo).toMatch(/já existe produto com o SKU A1/);
            expect(rs[1].problemas[0].motivo).toMatch(/já existe produto com este nome/);
            expect(rs[0].problemas[0].nivel).toBe('aviso');
        });

        test('dentro do arquivo: a primeira vale, a repetida é ignorada apontando a linha', () => {
            const rs = validarProdutos(
                [
                    linha(2, { nome: 'Anel', custo: '1', sku: 'A1' }),
                    linha(3, { nome: 'Pulseira', custo: '1', sku: 'A1' }),
                    linha(4, { nome: 'ANEL', custo: '1', sku: 'A2' })
                ],
                contextoProdutos()
            );
            expect(rs.map((r) => r.acao)).toEqual(['criar', 'ignorar', 'ignorar']);
            expect(rs[1].problemas[0].motivo).toMatch(/SKU A1 repetido no arquivo \(linha 2\)/);
            expect(rs[2].problemas[0].motivo).toMatch(/nome repetido no arquivo \(linha 2\)/);
        });

        test('linha com erro não "reserva" nome nem SKU para as seguintes', () => {
            const rs = validarProdutos(
                [linha(2, { nome: 'Anel', custo: 'ruim', sku: 'A1' }), linha(3, { nome: 'Anel', custo: '1', sku: 'A1' })],
                contextoProdutos()
            );
            expect(rs.map((r) => r.acao)).toEqual(['erro', 'criar']);
        });
    });

    test('linha com colunas a mais é erro', () => {
        const [r] = validarProdutos([linha(2, { nome: 'Anel', custo: '1', sku: 'A1' }, { colunasAMais: true })], contextoProdutos());
        expect(r.acao).toBe('erro');
        expect(r.problemas[0]).toMatchObject({ coluna: null, nivel: 'erro' });
    });
});

describe('validarClientes', () => {
    const contexto = (telefones = []) => ({ telefonesExistentes: new Set(telefones), hoje: '2026-11-17' });

    test('linha válida normaliza telefone e data', () => {
        const [r] = validarClientes(
            [linha(2, { nome: ' Maria  Silva ', telefone: '(11) 91234-5678', nascimento: '05/03/1990', observacoes: ' VIP ' })],
            contexto()
        );
        expect(r).toEqual({
            linha: 2,
            acao: 'criar',
            problemas: [],
            dados: { nome: 'Maria Silva', telefone: '11912345678', data_nascimento: '1990-03-05', observacoes: 'VIP' }
        });
    });

    test('nascimento e observações são opcionais', () => {
        const [r] = validarClientes([linha(2, { nome: 'Maria', telefone: '11912345678', nascimento: '', observacoes: '' })], contexto());
        expect(r.dados).toMatchObject({ data_nascimento: null, observacoes: null });
    });

    test('telefone com DDI vira aviso e continua a criar', () => {
        const [r] = validarClientes([linha(2, { nome: 'Maria', telefone: '+55 11 91234-5678' })], contexto());
        expect(r.acao).toBe('criar');
        expect(r.dados.telefone).toBe('11912345678');
        expect(problemasDe(r)).toEqual(['aviso:telefone']);
    });

    test('erros por coluna', () => {
        const [r] = validarClientes([linha(2, { nome: '', telefone: '123', nascimento: '31/02/1990', observacoes: 'x'.repeat(501) })], contexto());
        expect(problemasDe(r)).toEqual(['erro:nome', 'erro:telefone', 'erro:nascimento', 'erro:observacoes']);
    });

    test('telefone é obrigatório; nascimento futuro é erro', () => {
        const rs = validarClientes(
            [linha(2, { nome: 'Maria', telefone: '' }), linha(3, { nome: 'Joana', telefone: '11912345678', nascimento: '01/01/2027' })],
            contexto()
        );
        expect(rs[0].problemas[0].motivo).toBe('o telefone é obrigatório');
        expect(rs[1].problemas[0].motivo).toMatch(/futura/);
    });

    test('duplicado por telefone, contra a empresa e dentro do arquivo', () => {
        const rs = validarClientes(
            [
                linha(2, { nome: 'Maria', telefone: '(11) 91234-5678' }),
                linha(3, { nome: 'Maria Outra', telefone: '11 91234 5678' }),
                linha(4, { nome: 'Joana', telefone: '11 98888-7777' }),
                linha(5, { nome: 'Ana', telefone: '1133334444' })
            ],
            contexto(['1133334444'])
        );
        expect(rs.map((r) => r.acao)).toEqual(['criar', 'ignorar', 'criar', 'ignorar']);
        expect(rs[1].problemas[0].motivo).toMatch(/repetido no arquivo \(linha 2\)/);
        expect(rs[3].problemas[0].motivo).toMatch(/já existe cliente/);
    });
});

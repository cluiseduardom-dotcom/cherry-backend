jest.mock('../../src/repositories/plataformaComercialRepository');
jest.mock('../../src/repositories/taxasPlataformaRepository');
jest.mock('../../src/config/db', () => ({}));

const repo = require('../../src/repositories/plataformaComercialRepository');
const taxasRepo = require('../../src/repositories/taxasPlataformaRepository');
const service = require('../../src/services/plataformaComercialService');

beforeEach(() => jest.resetAllMocks());

describe('listarPlanos', () => {
    test('converte o percentual para número e preserva plano sem política vigente como null', async () => {
        repo.listarPlanos.mockResolvedValue([
            { codigo: 'pro', nome: 'Plano Pro', tem_mensalidade: true, ativo: true, percentual: '0.3000' },
            { codigo: 'novo', nome: 'Novo', tem_mensalidade: false, ativo: true, percentual: null }
        ]);

        expect(await service.listarPlanos()).toEqual([
            { codigo: 'pro', nome: 'Plano Pro', tem_mensalidade: true, ativo: true, percentual: 0.3 },
            { codigo: 'novo', nome: 'Novo', tem_mensalidade: false, ativo: true, percentual: null }
        ]);
    });
});

describe('listarEmpresas', () => {
    const linha = (extra) => ({
        empresa_id: 1, empresa_nome: 'Cherry', status: 'ativa',
        plano_codigo: null, plano_nome: null, tem_mensalidade: null, plano_inicio: null, plano_fim: null,
        condicao_id: null, condicao_percentual: null, condicao_inicio: null, condicao_fim: null,
        condicao_justificativa: null, condicao_responsavel: null,
        ...extra
    });

    test('usa o resolvedor da venda para a regra efetiva (fonte única) e monta plano/condição', async () => {
        repo.listarEmpresas.mockResolvedValue([
            linha({ plano_codigo: 'padrao', plano_nome: 'Plano padrão', tem_mensalidade: true, plano_inicio: '2026-10-30', condicao_id: 7, condicao_percentual: '0.5000', condicao_inicio: '2026-10-30', condicao_justificativa: 'Fundadora', condicao_responsavel: 'eu (#1)' })
        ]);
        taxasRepo.resolverRegra.mockResolvedValue({ percentual: '0.5000', origem: 'excecao_empresa' });

        const [empresa] = await service.listarEmpresas();

        expect(taxasRepo.resolverRegra).toHaveBeenCalledWith(1, expect.anything());
        expect(empresa.plano).toEqual({ codigo: 'padrao', nome: 'Plano padrão', tem_mensalidade: true, vigencia_inicio: '2026-10-30', vigencia_fim: null });
        expect(empresa.condicao).toMatchObject({ id: 7, percentual: 0.5, responsavel: 'eu (#1)' });
        expect(empresa.regra_efetiva).toEqual({ percentual: 0.5, origem: 'excecao_empresa', erro: null });
    });

    test('empresa sem plano nem condição: plano e condição null', async () => {
        repo.listarEmpresas.mockResolvedValue([linha({})]);
        taxasRepo.resolverRegra.mockResolvedValue({ percentual: '0.5000', origem: 'padrao_sem_plano' });

        const [empresa] = await service.listarEmpresas();

        expect(empresa.plano).toBeNull();
        expect(empresa.condicao).toBeNull();
    });

    test('configuração inválida de UMA empresa não derruba a lista: mostra o erro naquela linha', async () => {
        repo.listarEmpresas.mockResolvedValue([linha({ empresa_id: 1 }), linha({ empresa_id: 2, empresa_nome: 'Outra' })]);
        taxasRepo.resolverRegra
            .mockRejectedValueOnce(new Error('Nenhuma política de taxa da plataforma vigente para o plano x'))
            .mockResolvedValueOnce({ percentual: '0.4000', origem: 'plano_padrao' });

        const [ruim, boa] = await service.listarEmpresas();

        expect(ruim.regra_efetiva).toEqual({ percentual: null, origem: null, erro: 'Nenhuma política de taxa da plataforma vigente para o plano x' });
        expect(boa.regra_efetiva).toMatchObject({ percentual: 0.4, erro: null });
    });
});

describe('mudanças', () => {
    test('repassam os dados ao repository sem alterar (o responsável já vem pronto do controller)', async () => {
        repo.trocarPlano.mockResolvedValue({ id: 1 });
        repo.definirCondicao.mockResolvedValue({ id: 2 });
        repo.encerrarCondicao.mockResolvedValue({ id: 3 });

        const dados = { empresa_id: 5, responsavel: 'eu (#1)', justificativa: 'x' };
        await service.trocarPlano(dados);
        await service.definirCondicao(dados);
        await service.encerrarCondicao(dados);

        expect(repo.trocarPlano).toHaveBeenCalledWith(dados);
        expect(repo.definirCondicao).toHaveBeenCalledWith(dados);
        expect(repo.encerrarCondicao).toHaveBeenCalledWith(dados);
    });
});

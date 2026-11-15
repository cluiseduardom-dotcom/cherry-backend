jest.mock('../../src/repositories/notificacoesRepository');
jest.mock('../../src/repositories/empresaRepository');
jest.mock('../../src/repositories/lojaGestaoRepository');
jest.mock('../../src/services/suspensaoPixService');

const notificacoesRepository = require('../../src/repositories/notificacoesRepository');
const suspensaoPixService = require('../../src/services/suspensaoPixService');
const { listar } = require('../../src/services/notificacoesService');
const { obterCicloCobranca } = require('../../src/config/cicloCobrancaConfig');
const { avaliarCiclo } = require('../../src/utils/cicloCobranca');

const config = obterCicloCobranca({ COBRANCA_SUSPENSAO_PIX: 'ligada' });
const suspensa = () => {
    const ciclo = avaliarCiclo({ periodos: [{ competencia: '2026-10', vencimento: '2026-11-05', saldo: 25 }], hoje: '2026-11-25', config });
    return { ativa: true, suspenso: ciclo.suspender, desde: ciclo.suspensao_em, ciclo };
};
const ADMIN = { id: 1, empresa_id: 7, role: 'admin', funcionalidades: [] };
const VENDEDOR = { id: 2, empresa_id: 7, role: 'vendedor', funcionalidades: [] };

// 60 produtos em falta: mais alertas altos de estoque do que o teto de 50 do sino.
const produtosEmFalta = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1, nome: `Peça ${i + 1}`, sku: `P-${i + 1}`, tipo: 'produto', estoque_atual: 0, estoque_minimo: 3, vendido_30: 0, vendido_90: 0,
    dias_sem_venda: null, dias_cadastro: 10, ativo: true
}));

beforeEach(() => {
    jest.resetAllMocks();
    notificacoesRepository.listarBaseDeProdutos.mockResolvedValue([]);
    notificacoesRepository.listarPendenciasDeInsumo.mockResolvedValue([]);
    suspensaoPixService.situacao.mockResolvedValue(suspensa());
});

describe('sino — aviso de cobrança da plataforma', () => {
    test('o administrador recebe o aviso, em PRIMEIRO lugar, consultado pela empresa do JWT', async () => {
        const r = await listar(ADMIN);

        expect(suspensaoPixService.situacao).toHaveBeenCalledWith(7);
        expect(r.itens[0]).toMatchObject({ tipo: 'cobranca_plataforma', prioridade: 'alta' });
        expect(r.total).toBe(r.itens.length);
    });

    test('vendedor NÃO recebe e nem paga a consulta', async () => {
        const r = await listar(VENDEDOR);

        expect(r.itens.some((i) => i.tipo === 'cobranca_plataforma')).toBe(false);
        expect(suspensaoPixService.situacao).not.toHaveBeenCalled();
    });

    test('NUNCA é cortado pelo teto de 50: com mais de 50 alertas de estoque, o aviso continua lá, na frente', async () => {
        notificacoesRepository.listarBaseDeProdutos.mockResolvedValue(produtosEmFalta);
        const r = await listar(ADMIN);

        const estoque = r.itens.filter((i) => i.tipo !== 'cobranca_plataforma');
        expect(estoque).toHaveLength(50); // o teto segue valendo para o resto
        expect(r.itens[0].tipo).toBe('cobranca_plataforma');
        expect(r.total).toBe(51);
    });

    test('se a conta da cobrança falhar, o sino segue com estoque e giro (aviso é opcional)', async () => {
        notificacoesRepository.listarBaseDeProdutos.mockResolvedValue(produtosEmFalta.slice(0, 3));
        suspensaoPixService.situacao.mockRejectedValue(new Error('banco fora'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const r = await listar(ADMIN);

        expect(r.itens).toHaveLength(3);
        expect(r.itens.some((i) => i.tipo === 'cobranca_plataforma')).toBe(false);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('empresa 7'));
        spy.mockRestore();
    });

    test('suspensão desligada: sem aviso', async () => {
        suspensaoPixService.situacao.mockResolvedValue({ ativa: false, suspenso: false });
        expect((await listar(ADMIN)).itens).toEqual([]);
    });
});

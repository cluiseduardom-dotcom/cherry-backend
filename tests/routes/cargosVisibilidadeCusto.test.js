jest.mock('../../src/services/produtosService');

const request = require('supertest');
const produtosService = require('../../src/services/produtosService');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

// Custo/margem por CAPACIDADE do cargo (e não mais só pelo perfil do JWT).

const resultado = () => ({
    items: [{ id: 1, sku: 'CAM-001', nome: 'Camiseta', preco_venda: '49.90', custo: '20.00', margem_percentual: 59.92 }],
    page: 1, pageSize: 20, total: 1, totalPages: 1
});
const estado = (extra) => ({ ativo: true, token_version: 0, empresa_status: 'ativa', ...extra });
const cargo = (papel, nivel, capacidades) => estado({ papel, cargo_configurado: true, cargo_nivel: nivel, cargo_ativo: true, cargo_capacidades: capacidades });

async function listarComo(estadoSessao) {
    sessaoRepository.buscarEstado.mockResolvedValue(estadoSessao);
    produtosService.listar.mockResolvedValue(resultado());

    // O JWT diz "vendedor" de propósito: quem decide é o banco.
    return request(app).get('/produtos').set('Authorization', `Bearer ${makeToken({ id: 3, role: 'vendedor', empresa_id: 1, tv: 0 })}`);
}

beforeEach(() => jest.clearAllMocks());

describe('GET /produtos — custo e margem por cargo', () => {
    test.each([
        ['Diretor', cargo('diretor', 80, ['ver_custos'])],
        ['Gerente', cargo('gerente', 70, ['ver_custos'])],
        ['Coordenador', cargo('coordenador', 60, ['ver_custos'])],
        ['Admin', estado({ papel: 'admin' })],
        ['Estoquista (sempre viu custo operacional)', estado({ papel: 'estoquista' })]
    ])('%s recebe custo e margem', async (_nome, sessao) => {
        const res = await listarComo(sessao);

        expect(res.status).toBe(200);
        expect(res.body.data.items[0]).toMatchObject({ custo: '20.00', margem_percentual: 59.92 });
    });

    test.each([
        ['Vendedor', estado({ papel: 'vendedor' })],
        ['Supervisor', cargo('supervisor', 50, ['ver_vendas_de_todos', 'cancelar_venda'])],
        ['Analista', cargo('analista', 40, ['cancelar_venda'])],
        ['Operador', cargo('operador', 20, [])],
        ['Auxiliar', cargo('auxiliar', 10, [])],
        ['Gerente a quem o Admin retirou ver_custos', cargo('gerente', 70, ['cancelar_venda'])]
    ])('%s NÃO recebe custo nem margem', async (_nome, sessao) => {
        const res = await listarComo(sessao);

        expect(res.status).toBe(200);
        expect(res.body.data.items[0]).not.toHaveProperty('custo');
        expect(res.body.data.items[0]).not.toHaveProperty('margem_percentual');
    });

    test('Analista que o Admin deu ver_custos passa a ver (capacidade vale mais que o nome do cargo)', async () => {
        const res = await listarComo(cargo('analista', 60, ['ver_custos']));

        expect(res.body.data.items[0]).toHaveProperty('custo');
    });

    test('cargo desligado no comércio: 403 antes de qualquer dado', async () => {
        const res = await listarComo(estado({ papel: 'gerente', cargo_configurado: true, cargo_nivel: 70, cargo_ativo: false, cargo_capacidades: ['ver_custos'] }));

        expect(res.status).toBe(403);
        expect(produtosService.listar).not.toHaveBeenCalled();
    });
});

jest.mock('../../src/repositories/cargosRepository');

const cargosRepository = require('../../src/repositories/cargosRepository');
const cargosService = require('../../src/services/cargosService');

const admin = { id: 1, role: 'admin', cargo: 'admin', nivel: 90, capacidades: ['administrador', 'gerir_cargos', 'conceder_admin', 'ver_custos', 'ver_vendas_de_todos', 'cancelar_venda'], empresa_id: 7 };
const gerente = { id: 2, role: 'vendedor', cargo: 'gerente', nivel: 70, capacidades: ['gerir_cargos', 'ver_custos', 'cancelar_venda'], empresa_id: 7 };

beforeEach(() => {
    jest.clearAllMocks();
    cargosRepository.buscar.mockResolvedValue(null);
    cargosRepository.contarUsuariosAtivos.mockResolvedValue(0);
    cargosRepository.salvarComTravaDeUso.mockResolvedValue({});
});

const gravado = () => cargosRepository.salvarComTravaDeUso.mock.calls[0][0];

describe('cargosService.atualizar — Admin anexado ao cargo', () => {
    test('editar capacidades NÃO apaga o `administrador` do cargo', async () => {
        cargosRepository.buscar.mockResolvedValue({ nivel: 60, ativo: true, capacidades: ['ver_custos', 'administrador'] });

        await cargosService.atualizar(7, 'coordenador', { capacidades: ['cancelar_venda'] }, admin);

        expect(gravado().capacidades.sort()).toEqual(['administrador', 'cancelar_venda']);
    });

    test('mudar só o nível também preserva `administrador` e as demais capacidades', async () => {
        cargosRepository.buscar.mockResolvedValue({ nivel: 60, ativo: true, capacidades: ['ver_custos', 'administrador'] });

        await cargosService.atualizar(7, 'coordenador', { nivel: 65 }, admin);

        expect(gravado()).toMatchObject({ nivel: 65 });
        expect(gravado().capacidades.sort()).toEqual(['administrador', 'ver_custos']);
    });

    test('cargo sem `administrador` não ganha por edição', async () => {
        await cargosService.atualizar(7, 'coordenador', { capacidades: ['ver_custos'] }, admin);

        expect(gravado().capacidades).toEqual(['ver_custos']);
    });

    test('a resposta separa `administrador` da lista editável de capacidades', async () => {
        cargosRepository.buscar.mockResolvedValue({ nivel: 60, ativo: true, capacidades: ['ver_custos', 'administrador'] });

        const resposta = await cargosService.atualizar(7, 'coordenador', { nivel: 61 }, admin);

        expect(resposta.administrador).toBe(true);
        expect(resposta.capacidades).toEqual(['ver_custos']);
    });
});

describe('cargosService.atualizar — sem escalada de privilégio (quem não é Admin)', () => {
    test('não edita o PRÓPRIO cargo (nem para se dar `conceder_admin`)', async () => {
        await expect(cargosService.atualizar(7, 'gerente', { capacidades: ['gerir_cargos', 'conceder_admin'] }, gerente))
            .rejects.toMatchObject({ statusCode: 403, message: 'Você só pode editar cargos abaixo do seu nível' });

        expect(cargosRepository.salvarComTravaDeUso).not.toHaveBeenCalled();
    });

    test('não edita cargo de nível igual ou acima do seu', async () => {
        await expect(cargosService.atualizar(7, 'diretor', { ativo: true }, gerente)).rejects.toMatchObject({ statusCode: 403 });
        await expect(cargosService.atualizar(7, 'diretor', { nivel: 10 }, gerente)).rejects.toMatchObject({ statusCode: 403 });
        expect(cargosRepository.salvarComTravaDeUso).not.toHaveBeenCalled();
    });

    test('não sobe um cargo para nível igual ou acima do seu', async () => {
        await expect(cargosService.atualizar(7, 'coordenador', { nivel: 70 }, gerente)).rejects.toMatchObject({
            statusCode: 403, message: 'Você não pode definir um nível igual ou acima do seu'
        });
        await expect(cargosService.atualizar(7, 'coordenador', { nivel: 89 }, gerente)).rejects.toMatchObject({ statusCode: 403 });
    });

    test('só concede capacidades que possui', async () => {
        await expect(cargosService.atualizar(7, 'supervisor', { capacidades: ['conceder_admin'] }, gerente)).rejects.toMatchObject({
            statusCode: 403, message: 'Você só pode conceder capacidades que você possui'
        });
        await expect(cargosService.atualizar(7, 'analista', { capacidades: ['cancelar_venda', 'ver_vendas_de_todos'] }, gerente)).rejects.toMatchObject({ statusCode: 403 });
    });

    test('dentro dos limites, funciona: cargo abaixo, nível abaixo, capacidades próprias', async () => {
        await cargosService.atualizar(7, 'supervisor', { nivel: 55, capacidades: ['ver_custos', 'cancelar_venda'] }, gerente);

        expect(gravado()).toMatchObject({ cargo: 'supervisor', nivel: 55, usuario_id: 2 });
    });

    test('manter capacidades que o cargo JÁ tinha não conta como conceder (mesmo sem possuí-las)', async () => {
        cargosRepository.buscar.mockResolvedValue({ nivel: 50, ativo: true, capacidades: ['ver_vendas_de_todos', 'cancelar_venda'] });

        await cargosService.atualizar(7, 'supervisor', { nivel: 52 }, gerente);

        expect(gravado().capacidades.sort()).toEqual(['cancelar_venda', 'ver_vendas_de_todos']);
    });

    test('Estoquista/Faturista (fora da escada) podem ser editados por quem não é Admin, só com capacidades próprias', async () => {
        await cargosService.atualizar(7, 'faturista', { ativo: true, capacidades: ['ver_custos'] }, gerente);

        expect(gravado()).toMatchObject({ cargo: 'faturista', nivel: null });
    });

    test('ator sem nível (cargo fora da escada) só edita cargos fora da escada', async () => {
        const estoquistaComGestao = { id: 3, role: 'estoquista', cargo: 'estoquista', nivel: null, capacidades: ['gerir_cargos'], empresa_id: 7 };

        await expect(cargosService.atualizar(7, 'auxiliar', { ativo: true }, estoquistaComGestao)).rejects.toMatchObject({ statusCode: 403 });
        await expect(cargosService.atualizar(7, 'faturista', { ativo: true }, estoquistaComGestao)).resolves.toBeDefined();
    });

    test('Admin (inclusive concedido) não tem essas travas', async () => {
        await cargosService.atualizar(7, 'diretor', { nivel: 89, capacidades: ['conceder_admin', 'gerir_cargos'] }, admin);

        expect(gravado()).toMatchObject({ nivel: 89 });
    });
});

describe('cargosService.atualizar — desligar cargo em uso', () => {
    const admin = { id: 1, empresa_id: 7, role: 'admin', nivel: 90, capacidades: [] };

    beforeEach(() => {
        jest.clearAllMocks();
        cargosRepository.buscar.mockResolvedValue({ nivel: 70, ativo: true, capacidades: [] });
        cargosRepository.salvarComTravaDeUso.mockResolvedValue({});
    });

    test('desligar um cargo ligado pede a checagem de uso SOB a trava, na mesma gravação', async () => {
        await cargosService.atualizar(7, 'gerente', { ativo: false }, admin);

        expect(cargosRepository.salvarComTravaDeUso).toHaveBeenCalledTimes(1);
        expect(cargosRepository.salvarComTravaDeUso.mock.calls[0][1]).toEqual({ bloquearSeEmUso: true });
        expect(cargosRepository.contarUsuariosAtivos).not.toHaveBeenCalled();
    });

    test('editar sem desligar não pede a checagem de uso', async () => {
        await cargosService.atualizar(7, 'gerente', { nivel: 65 }, admin);

        expect(cargosRepository.salvarComTravaDeUso.mock.calls[0][1]).toEqual({ bloquearSeEmUso: false });
    });

    test('uso no banco vira 409 vindo da gravação (o service repassa o erro)', async () => {
        cargosRepository.salvarComTravaDeUso.mockRejectedValue(Object.assign(new Error('Há 2 usuário(s)'), { statusCode: 409 }));

        await expect(cargosService.atualizar(7, 'gerente', { ativo: false }, admin)).rejects.toMatchObject({ statusCode: 409 });
    });
});

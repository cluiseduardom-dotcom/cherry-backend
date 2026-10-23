jest.mock('../../src/repositories/vendasRepository');
jest.mock('../../src/repositories/cancelamentosRepository');
jest.mock('../../src/repositories/cargosRepository');

const bcrypt = require('bcrypt');
const vendasRepository = require('../../src/repositories/vendasRepository');
const cancelamentosRepository = require('../../src/repositories/cancelamentosRepository');
const cargosRepository = require('../../src/repositories/cargosRepository');
const cancelamentosService = require('../../src/services/cancelamentosService');
const { faixaPorDias } = require('../../src/constants/cancelamento');
const { CATALOGO } = require('../../src/constants/cargos');

const SENHA = 'senha-de-teste-do-autorizador';
const HASH = bcrypt.hashSync(SENHA, 4);

const EMPRESA = 5;
const vendedor = { id: 9, email: 'vendedor@teste.invalid', role: 'vendedor', cargo: 'vendedor', capacidades: ['cancelar_venda'], empresa_id: EMPRESA };
const gerenteLogado = { id: 20, email: 'gerente@teste.invalid', role: 'vendedor', cargo: 'gerente', capacidades: ['ver_vendas_de_todos', 'cancelar_venda'], empresa_id: EMPRESA };

const autorizacao = (email) => ({ email, senha: SENHA });

// Candidato a autorizador como o repositório devolve: cargo LIGADO no comércio, no nível padrão do
// catálogo (um cargo opcional sem linha em cargos_empresa está desligado, então precisa de linha).
const candidato = (papel, extra = {}) => ({
    id: 77, email: `${papel}@teste.invalid`, senha: HASH, ativo: true, papel,
    cargo_configurado: true, cargo_nivel: CATALOGO[papel].nivel, cargo_ativo: true, cargo_capacidades: [],
    administrador_concedido: false, ...extra
});

function venda(dias, extra = {}) {
    cancelamentosRepository.buscarIdadeDaVenda.mockResolvedValue({ usuario_id: vendedor.id, status: 'finalizada', dias, ...extra });
}

beforeEach(() => {
    jest.resetAllMocks();
    cargosRepository.buscar.mockResolvedValue(null);
    vendasRepository.cancelar.mockImplementation(async (id) => ({ id, status: 'cancelada' }));
});

describe('faixaPorDias (limites)', () => {
    test.each([
        [0, 'ate_7_dias'], [7, 'ate_7_dias'], [8, '8_a_30_dias'], [30, '8_a_30_dias'], [31, 'acima_30_dias'], [400, 'acima_30_dias']
    ])('%i dia(s) => %s', (dias, faixa) => {
        expect(faixaPorDias(dias).codigo).toBe(faixa);
    });

    test.each([[-1], [NaN], [undefined]])('idade inválida (%p) é erro, nunca "livre"', (dias) => {
        expect(() => faixaPorDias(dias)).toThrow();
    });
});

describe('cancelar — faixa livre (até 7 dias)', () => {
    test('só o motivo; não consulta autorizador e repassa a política ao repositório', async () => {
        venda(3);

        const resultado = await cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu da compra' });

        expect(resultado).toEqual({ id: 1, status: 'cancelada' });
        expect(cancelamentosRepository.buscarAutorizador).not.toHaveBeenCalled();
        expect(vendasRepository.cancelar).toHaveBeenCalledWith(1, vendedor.id, EMPRESA, {
            motivo: 'Cliente desistiu da compra',
            login: vendedor.email,
            faixaAutorizada: 'ate_7_dias',
            autorizador: null,
            restringirAoUsuarioId: vendedor.id
        });
    });

    test('credencial enviada sem necessidade é ignorada (não é validada nem gravada)', async () => {
        venda(7);

        await cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('x@y.z') });

        expect(cancelamentosRepository.buscarAutorizador).not.toHaveBeenCalled();
        expect(vendasRepository.cancelar.mock.calls[0][3].autorizador).toBeNull();
    });
});

describe('cancelar — faixas com autorização', () => {
    test('8–30 dias sem autorização: 403 dizendo quem autoriza, sem gravar nada', async () => {
        venda(10);

        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu' }))
            .rejects.toMatchObject({ statusCode: 403, message: 'Esta venda exige autorização de Supervisor ou superior' });
        expect(vendasRepository.cancelar).not.toHaveBeenCalled();
    });

    test.each([
        ['supervisor', 10, true],
        ['gerente', 10, true],
        ['diretor', 10, true],
        ['coordenador', 10, true],
        ['analista', 10, false],
        ['vendedor', 10, false],
        ['supervisor', 40, false],
        ['coordenador', 40, false],
        ['gerente', 40, true],
        ['diretor', 40, true],
        ['admin', 40, true]
    ])('autorizador %s, venda de %i dias => %s', async (cargo, dias, deveAceitar) => {
        venda(dias);
        cancelamentosRepository.buscarAutorizador.mockResolvedValue(candidato(cargo));

        const chamada = cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') });

        if (deveAceitar) {
            await chamada;
            expect(vendasRepository.cancelar.mock.calls[0][3]).toMatchObject({
                faixaAutorizada: dias > 30 ? 'acima_30_dias' : '8_a_30_dias',
                autorizador: { id: 77, login: `${cargo}@teste.invalid` }
            });
        } else {
            await expect(chamada).rejects.toMatchObject({ statusCode: 403, message: 'Autorização inválida' });
            expect(vendasRepository.cancelar).not.toHaveBeenCalled();
        }
    });

    test('senha errada, e-mail inexistente, usuário inativo: a MESMA resposta genérica', async () => {
        venda(10);
        const pedir = () => cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') });

        cancelamentosRepository.buscarAutorizador.mockResolvedValueOnce(candidato('gerente', { senha: bcrypt.hashSync('outra-senha', 4) }));
        const senhaErrada = await pedir().catch((e) => e);
        cancelamentosRepository.buscarAutorizador.mockResolvedValueOnce(null);
        const inexistente = await pedir().catch((e) => e);
        cancelamentosRepository.buscarAutorizador.mockResolvedValueOnce(candidato('gerente', { ativo: false }));
        const inativo = await pedir().catch((e) => e);

        for (const erro of [senhaErrada, inexistente, inativo]) {
            expect(erro).toMatchObject({ statusCode: 403, message: 'Autorização inválida' });
        }
        expect(vendasRepository.cancelar).not.toHaveBeenCalled();
    });

    test('o autorizador é procurado só na empresa do token (nunca em outra)', async () => {
        venda(10);
        cancelamentosRepository.buscarAutorizador.mockResolvedValue(null);

        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('de-outra-empresa@x.com') }))
            .rejects.toMatchObject({ statusCode: 403 });

        expect(cancelamentosRepository.buscarAutorizador).toHaveBeenCalledWith(EMPRESA, 'de-outra-empresa@x.com');
    });

    test('Admin concedido individualmente (cargo comum) qualifica em qualquer faixa', async () => {
        venda(60);
        cancelamentosRepository.buscarAutorizador.mockResolvedValue(candidato('analista', { administrador_concedido: true }));

        await cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') });

        expect(vendasRepository.cancelar).toHaveBeenCalled();
    });

    test('cargo opcional que o comércio nunca ligou (sem linha) não autoriza', async () => {
        venda(10);
        cancelamentosRepository.buscarAutorizador.mockResolvedValue(candidato('gerente', {
            cargo_configurado: false, cargo_nivel: null, cargo_ativo: null, cargo_capacidades: null
        }));

        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') }))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    test('cargo do autorizador desligado no comércio: não autoriza', async () => {
        venda(10);
        cancelamentosRepository.buscarAutorizador.mockResolvedValue(candidato('gerente', {
            cargo_configurado: true, cargo_nivel: 70, cargo_ativo: false, cargo_capacidades: []
        }));

        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') }))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    test('a hierarquia é do comércio: o piso é o nível do Supervisor DAQUELE comércio', async () => {
        venda(10);
        // Neste comércio o Supervisor está em 55 (padrão 50) e o Coordenador em 45 (padrão 60).
        cargosRepository.buscar.mockImplementation(async (empresa, cargo) =>
            cargo === 'supervisor' ? { cargo, nivel: 55, ativo: true, capacidades: [] } : null);

        cancelamentosRepository.buscarAutorizador.mockResolvedValueOnce(candidato('coordenador', {
            cargo_nivel: 45, cargo_capacidades: ['cancelar_venda']
        }));
        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') }))
            .rejects.toMatchObject({ statusCode: 403 });

        cancelamentosRepository.buscarAutorizador.mockResolvedValueOnce(candidato('analista', {
            cargo_nivel: 60, cargo_capacidades: ['cancelar_venda']
        }));
        await cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') });
        expect(vendasRepository.cancelar).toHaveBeenCalledTimes(1);
    });

    test('o piso da faixa vem do nível configurado do cargo de referência, mesmo desligado', async () => {
        venda(10);
        // Supervisor (referência da faixa 8–30) configurado em nível 65 e desligado: o piso passa a 65.
        cargosRepository.buscar.mockImplementation(async (empresa, cargo) =>
            cargo === 'supervisor' ? { cargo, nivel: 65, ativo: false, capacidades: [] } : null);

        cancelamentosRepository.buscarAutorizador.mockResolvedValueOnce(candidato('coordenador')); // 60 < 65
        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') }))
            .rejects.toMatchObject({ statusCode: 403 });

        cancelamentosRepository.buscarAutorizador.mockResolvedValueOnce(candidato('gerente')); // 70 >= 65
        await cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu', autorizacao: autorizacao('a@b.c') });
        expect(vendasRepository.cancelar).toHaveBeenCalledTimes(1);
    });

    test('quem já tem o nível exigido autoriza com a própria senha', async () => {
        venda(40);
        cancelamentosRepository.buscarAutorizador.mockResolvedValue(candidato('gerente', { id: gerenteLogado.id, email: gerenteLogado.email }));

        await cancelamentosService.cancelar(1, gerenteLogado, { motivo: 'Cliente desistiu', autorizacao: autorizacao(gerenteLogado.email) });

        expect(vendasRepository.cancelar.mock.calls[0][3].autorizador).toEqual({ id: gerenteLogado.id, login: gerenteLogado.email });
    });
});

describe('cancelar — venda inexistente, alheia ou já cancelada', () => {
    test('venda de outro usuário para quem só vê as próprias: 404', async () => {
        venda(3, { usuario_id: 999 });

        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu' }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(vendasRepository.cancelar).not.toHaveBeenCalled();
    });

    test('quem vê as vendas de todos cancela a de outro usuário (sem restringir)', async () => {
        venda(3, { usuario_id: 999 });

        await cancelamentosService.cancelar(1, gerenteLogado, { motivo: 'Cliente desistiu' });

        expect(vendasRepository.cancelar.mock.calls[0][3].restringirAoUsuarioId).toBeNull();
    });

    test('inexistente: 404; já cancelada: 409', async () => {
        cancelamentosRepository.buscarIdadeDaVenda.mockResolvedValueOnce(null);
        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu' })).rejects.toMatchObject({ statusCode: 404 });

        venda(3, { status: 'cancelada' });
        await expect(cancelamentosService.cancelar(1, vendedor, { motivo: 'Cliente desistiu' })).rejects.toMatchObject({ statusCode: 409 });
        expect(vendasRepository.cancelar).not.toHaveBeenCalled();
    });
});

describe('previa', () => {
    test('faixa livre: não pede autorização', async () => {
        venda(2);

        expect(await cancelamentosService.previa(1, vendedor)).toEqual({
            venda_id: 1, status: 'finalizada', dias_da_venda: 2, faixa: 'ate_7_dias',
            exige_autorizacao: false, autorizador_minimo: null, pode_cancelar: true
        });
    });

    test('faixa com autorização: devolve o cargo e o nível mínimos DO COMÉRCIO', async () => {
        venda(45);
        cargosRepository.buscar.mockImplementation(async (empresa, cargo) =>
            cargo === 'gerente' ? { cargo, nivel: 66, ativo: true, capacidades: [] } : null);

        const resposta = await cancelamentosService.previa(1, vendedor);

        expect(resposta).toMatchObject({
            faixa: 'acima_30_dias', exige_autorizacao: true, pode_cancelar: true,
            autorizador_minimo: { cargo: 'gerente', rotulo: 'Gerente', nivel: 66 }
        });
    });

    test('venda já cancelada: pode_cancelar=false com o motivo; alheia: 404', async () => {
        venda(2, { status: 'cancelada' });
        expect(await cancelamentosService.previa(1, vendedor)).toMatchObject({ pode_cancelar: false, motivo_bloqueio: expect.any(String) });

        venda(2, { usuario_id: 999 });
        await expect(cancelamentosService.previa(1, vendedor)).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('listar', () => {
    test('filtra pela empresa do token e pagina', async () => {
        cancelamentosRepository.listarPaginado.mockResolvedValue({ items: [{ id: 1 }], total: 41 });

        const resultado = await cancelamentosService.listar({ page: 3, pageSize: 20, faixa: '8_a_30_dias' }, gerenteLogado);

        expect(cancelamentosRepository.listarPaginado).toHaveBeenCalledWith(EMPRESA, { faixa: '8_a_30_dias', limit: 20, offset: 40 });
        expect(resultado).toEqual({ items: [{ id: 1 }], page: 3, pageSize: 20, total: 41, totalPages: 3 });
    });
});

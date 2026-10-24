jest.mock('../../src/repositories/usuariosRepository');
jest.mock('../../src/repositories/usuarioRepository');
jest.mock('../../src/repositories/cargosRepository');
jest.mock('../../src/services/cargosService');

const usuariosRepository = require('../../src/repositories/usuariosRepository');
const usuarioRepository = require('../../src/repositories/usuarioRepository');
const cargosRepository = require('../../src/repositories/cargosRepository');
const cargosService = require('../../src/services/cargosService');
const service = require('../../src/services/usuariosService');

const gerente = { id: 10, empresa_id: 7, role: 'vendedor', cargo: 'gerente', nivel: 70 };
const admin = { id: 1, empresa_id: 7, role: 'admin', cargo: 'admin', nivel: 90 };
const alvo = (papel, extra = {}) => ({
    id: 20, papel, ativo: true, cargo_configurado: false, administrador_concedido: false, ...extra
});

describe('usuariosService.avaliarAlvo', () => {
    test('ninguém gerencia a si mesmo', () => {
        expect(service.avaliarAlvo(gerente, alvo('vendedor', { id: 10 })).pode).toBe(false);
        expect(service.avaliarAlvo(admin, alvo('vendedor', { id: 1 })).pode).toBe(false);
    });

    test('nunca gerencia Admin (cargo admin ou admin concedido), nem sendo Admin', () => {
        expect(service.avaliarAlvo(gerente, alvo('admin')).pode).toBe(false);
        expect(service.avaliarAlvo(admin, alvo('admin')).pode).toBe(false);
        expect(service.avaliarAlvo(gerente, alvo('vendedor', { administrador_concedido: true })).pode).toBe(false);
    });

    test('gerente (70) gerencia nível menor, não igual nem maior', () => {
        expect(service.avaliarAlvo(gerente, alvo('supervisor')).pode).toBe(true);
        expect(service.avaliarAlvo(gerente, alvo('vendedor')).pode).toBe(true);
        expect(service.avaliarAlvo(gerente, alvo('gerente')).pode).toBe(false);
        expect(service.avaliarAlvo(gerente, alvo('diretor')).pode).toBe(false);
    });

    test('cargos fora da escada contam como nível 0', () => {
        expect(service.avaliarAlvo(gerente, alvo('estoquista')).pode).toBe(true);
    });

    test('usa o nível sobrescrito em cargos_empresa', () => {
        const promovido = alvo('vendedor', { cargo_configurado: true, cargo_nivel: 75, cargo_ativo: true, cargo_capacidades: [] });
        expect(service.avaliarAlvo(gerente, promovido).pode).toBe(false);
    });

    test('Admin gerencia qualquer não-Admin', () => {
        expect(service.avaliarAlvo(admin, alvo('diretor')).pode).toBe(true);
    });

    test('cargo desconhecido não é gerenciável', () => {
        expect(service.avaliarAlvo(admin, alvo('xpto')).pode).toBe(false);
    });
});

describe('usuariosService.criar', () => {
    const dados = { nome: 'Ana', email: 'ana@x.com', senha: 'segredo1', papel: 'vendedor' };

    beforeEach(() => {
        jest.clearAllMocks();
        cargosService.garantirCargoAtivo.mockResolvedValue();
        cargosRepository.buscar.mockResolvedValue(null);
        usuarioRepository.buscarPorEmail.mockResolvedValue(null);
        usuariosRepository.criarComAuditoria.mockImplementation(async (d) => ({ id: 99, nome: d.nome, email: d.email, papel: d.papel, ativo: true }));
    });

    test('cria cargo abaixo do ator, com empresa e autor do JWT e senha com hash', async () => {
        const r = await service.criar(dados, gerente);
        const arg = usuariosRepository.criarComAuditoria.mock.calls[0][0];

        expect(r.usuario.id).toBe(99);
        expect(arg.empresa_id).toBe(7);
        expect(arg.executado_por).toBe(10);
        expect(arg.senhaHash).toMatch(/^\$2[aby]\$/);
        expect(arg.senhaHash).not.toBe(dados.senha);
    });

    test('recusa criar cargo de nível igual ou maior', async () => {
        await expect(service.criar({ ...dados, papel: 'gerente' }, gerente)).rejects.toMatchObject({ statusCode: 403 });
        await expect(service.criar({ ...dados, papel: 'diretor' }, gerente)).rejects.toMatchObject({ statusCode: 403 });
        expect(usuariosRepository.criarComAuditoria).not.toHaveBeenCalled();
    });

    test('recusa criar Admin, até para Admin', async () => {
        await expect(service.criar({ ...dados, papel: 'admin' }, admin)).rejects.toMatchObject({ statusCode: 403 });
    });

    test('recusa cargo desligado na empresa', async () => {
        cargosService.garantirCargoAtivo.mockRejectedValue(Object.assign(new Error('off'), { statusCode: 400 }));
        await expect(service.criar(dados, gerente)).rejects.toMatchObject({ statusCode: 400 });
        expect(usuariosRepository.criarComAuditoria).not.toHaveBeenCalled();
    });

    test('e-mail já cadastrado é 409', async () => {
        usuarioRepository.buscarPorEmail.mockResolvedValue({ id: 5 });
        await expect(service.criar(dados, gerente)).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('usuariosService.definirBloqueio', () => {
    test('repassa empresa/autor do JWT e autoriza pelo cargo efetivo', async () => {
        usuariosRepository.alterarBloqueio.mockImplementation(async ({ autorizar }) => {
            autorizar(alvo('vendedor'));
            return { id: 20, ativo: false, alterado: true };
        });

        await service.definirBloqueio(20, { bloqueado: true, motivo: 'Desligado' }, gerente);
        const arg = usuariosRepository.alterarBloqueio.mock.calls[0][0];

        expect(arg).toMatchObject({ empresa_id: 7, usuario_id: 20, executado_por: 10, bloqueado: true });
    });

    test('autorizar lança 403 para alvo de nível igual', async () => {
        usuariosRepository.alterarBloqueio.mockImplementation(async ({ autorizar }) => autorizar(alvo('gerente')));
        await expect(service.definirBloqueio(20, { bloqueado: true, motivo: 'abc' }, gerente)).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe('usuariosService.listar', () => {
    test('marca pode_gerenciar e nunca expõe senha', async () => {
        usuariosRepository.listarPorEmpresa.mockResolvedValue([
            { ...alvo('vendedor'), id: 20, nome: 'A', email: 'a@x', senha: 'hash', criado_em: 'd' },
            { ...alvo('diretor'), id: 21, nome: 'B', email: 'b@x', criado_em: 'd' }
        ]);

        const r = await service.listar(gerente);

        expect(r[0]).toMatchObject({ id: 20, cargo: 'vendedor', pode_gerenciar: true, motivo_bloqueio_gestao: null });
        expect(r[1].pode_gerenciar).toBe(false);
        expect(r[1].motivo_bloqueio_gestao).toBeTruthy();
        expect(JSON.stringify(r)).not.toMatch(/senha|hash/);
    });
});

describe('usuariosService.listarCargosAtribuiveis', () => {
    const cargo = (nome, nivel, extra = {}) => ({ cargo: nome, rotulo: nome, nivel, ativo: true, administrador: false, em_escada: true, ...extra });
    const catalogo = [
        cargo('admin', 90, { administrador: true }),
        cargo('diretor', 80),
        cargo('gerente', 70),
        cargo('supervisor', 50, { ativo: false }),
        cargo('vendedor', 30),
        cargo('estoquista', 0, { em_escada: false })
    ];

    beforeEach(() => cargosService.listar.mockResolvedValue(catalogo));

    test('gerente: só cargos ativos de nível menor; sem Admin, sem desligados, sem igual/acima', async () => {
        const r = await service.listarCargosAtribuiveis(gerente);

        expect(r.map((c) => c.cargo)).toEqual(['vendedor', 'estoquista']);
        expect(cargosService.listar).toHaveBeenCalledWith(7);
    });

    test('cargo fora da escada não traz nível', async () => {
        const r = await service.listarCargosAtribuiveis(gerente);

        expect(r.find((c) => c.cargo === 'estoquista')).toMatchObject({ nivel: null, em_escada: false });
    });

    test('Admin: todos os ativos, menos Admin', async () => {
        const r = await service.listarCargosAtribuiveis(admin);

        expect(r.map((c) => c.cargo)).toEqual(['diretor', 'gerente', 'vendedor', 'estoquista']);
    });

    test('cargo com a capacidade administrador nunca é oferecido', async () => {
        cargosService.listar.mockResolvedValue([cargo('diretor', 80, { administrador: true }), cargo('vendedor', 30)]);

        const r = await service.listarCargosAtribuiveis(admin);

        expect(r.map((c) => c.cargo)).toEqual(['vendedor']);
    });
});

describe('usuariosService.detalhar e editarDados', () => {
    const usuario = (papel, extra = {}) => ({
        ...alvo(papel), id: 20, nome: 'N', email: 'n@x.com', criado_em: 'd', cpf: '52998224725', telefone: '11912345678', ...extra
    });

    test('detalhe devolve os dados cadastrais a quem pode gerenciar o usuário', async () => {
        usuariosRepository.obterDetalhe.mockResolvedValue(usuario('vendedor'));

        const r = await service.detalhar(20, gerente);

        expect(r.dados).toMatchObject({ telefone: '11912345678', cpf: '52998224725', uf: null });
        expect(usuariosRepository.obterDetalhe).toHaveBeenCalledWith(7, 20);
    });

    test('detalhe: 404 se não existe na empresa; 403 para cargo igual/acima; o próprio usuário sempre vê', async () => {
        usuariosRepository.obterDetalhe.mockResolvedValue(null);
        await expect(service.detalhar(20, gerente)).rejects.toMatchObject({ statusCode: 404 });

        usuariosRepository.obterDetalhe.mockResolvedValue(usuario('diretor'));
        await expect(service.detalhar(20, gerente)).rejects.toMatchObject({ statusCode: 403 });

        usuariosRepository.obterDetalhe.mockResolvedValue(usuario('gerente', { id: 10 }));
        await expect(service.detalhar(20, gerente)).resolves.toMatchObject({ id: 10 });
    });

    test('editar delega ao repository com empresa e autor do JWT e autoriza pela hierarquia', async () => {
        usuariosRepository.editarDados.mockImplementation(async ({ autorizar }) => {
            autorizar(usuario('vendedor'));
            return { alterado: true, campos: ['cpf'] };
        });

        const r = await service.editarDados(20, { cpf: '52998224725' }, gerente);
        const arg = usuariosRepository.editarDados.mock.calls[0][0];

        expect(r).toEqual({ alterado: true, campos: ['cpf'] });
        expect(arg).toMatchObject({ empresa_id: 7, usuario_id: 20, executado_por: 10, dados: { cpf: '52998224725' } });

        usuariosRepository.editarDados.mockImplementation(async ({ autorizar }) => autorizar(usuario('admin')));
        await expect(service.editarDados(20, { cpf: null }, gerente)).rejects.toMatchObject({ statusCode: 403 });
    });

    test('criar repassa os dados cadastrais ao repository', async () => {
        cargosService.garantirCargoAtivo.mockResolvedValue();
        cargosRepository.buscar.mockResolvedValue(null);
        usuarioRepository.buscarPorEmail.mockResolvedValue(null);
        usuariosRepository.criarComAuditoria.mockResolvedValue({ id: 99 });

        await service.criar({ nome: 'Ana', email: 'a@x.com', senha: 'segredo1', papel: 'vendedor', telefone: '11912345678', cpf: null }, gerente);

        expect(usuariosRepository.criarComAuditoria.mock.calls[0][0].dados).toEqual({ telefone: '11912345678', cpf: null });
    });
});

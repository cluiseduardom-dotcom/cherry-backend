jest.mock('../../src/config/db', () => ({ connect: jest.fn() }));
jest.mock('../../src/repositories/privilegiosRepository');
jest.mock('../../src/repositories/cargosRepository');
jest.mock('bcrypt', () => ({ compare: jest.fn(), hashSync: jest.fn(() => 'hash-descartavel') }));

const bcrypt = require('bcrypt');
const db = require('../../src/config/db');
const repo = require('../../src/repositories/privilegiosRepository');
const cargosRepository = require('../../src/repositories/cargosRepository');
const service = require('../../src/services/privilegiosService');

const ator = { id: 1, empresa_id: 7, role: 'admin', cargo: 'admin', nivel: 90, capacidades: [] };
const gerenteDelegado = { id: 2, empresa_id: 7, role: 'vendedor', cargo: 'gerente', nivel: 70, capacidades: ['conceder_admin'] };
const confirmacao = { senha: 'senha-do-ator', motivo: 'Cobertura de férias' };

let client;

beforeEach(() => {
    jest.clearAllMocks();
    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    db.connect.mockResolvedValue(client);

    bcrypt.compare.mockResolvedValue(true);
    repo.buscarSenhaHash.mockResolvedValue('hash-real');
    repo.buscarUsuario.mockResolvedValue({ id: 5, nome: 'Bia', email: 'bia@x.com', papel: 'vendedor', ativo: true });
    repo.concessaoAtiva.mockResolvedValue(null);
    repo.inserirConcessao.mockResolvedValue({ id: 10, concedido_em: '2026-10-21T00:00:00Z' });
    repo.registrarEvento.mockResolvedValue({ id: 99, criado_em: 'x' });
    repo.contarAdministradoresEfetivos.mockResolvedValue(2);
    repo.contarUsuariosAtivosDoCargo.mockResolvedValue(3);
    repo.revogarConcessao.mockResolvedValue(1);
    cargosRepository.buscar.mockResolvedValue(null);
    cargosRepository.salvar.mockResolvedValue({});
});

const sqls = () => client.query.mock.calls.map(([texto]) => texto);

describe('concederAUsuario', () => {
    test('concede: grava concessão e evento na MESMA transação, com a empresa travada', async () => {
        const r = await service.concederAUsuario(ator, 5, confirmacao);

        expect(r).toMatchObject({ usuario_id: 5, nome: 'Bia', administrador_concedido: true, evento_id: 99 });
        expect(sqls()).toEqual(['BEGIN', 'COMMIT']);
        expect(repo.travarEmpresa).toHaveBeenCalledWith(client, 7);
        expect(repo.inserirConcessao).toHaveBeenCalledWith({ empresa_id: 7, usuario_id: 5, concedido_por: 1, motivo: 'Cobertura de férias' }, client);
        expect(repo.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({
            empresa_id: 7, escopo: 'usuario', acao: 'conceder', alvo_usuario_id: 5, executado_por: 1, motivo: 'Cobertura de férias'
        }), client);
        expect(client.release).toHaveBeenCalled();
    });

    test('não concede a si mesmo, nem consulta senha ou banco', async () => {
        await expect(service.concederAUsuario(ator, 1, confirmacao)).rejects.toMatchObject({ statusCode: 403 });
        await expect(service.concederAUsuario(gerenteDelegado, 2, confirmacao)).rejects.toMatchObject({ statusCode: 403 });

        expect(repo.buscarSenhaHash).not.toHaveBeenCalled();
        expect(db.connect).not.toHaveBeenCalled();
    });

    test('senha errada: 403 e NADA é gravado nem aberto em transação', async () => {
        bcrypt.compare.mockResolvedValue(false);

        await expect(service.concederAUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 403, message: 'Senha de confirmação inválida' });

        expect(db.connect).not.toHaveBeenCalled();
        expect(repo.inserirConcessao).not.toHaveBeenCalled();
    });

    test('usuário do ator inexistente/inativo (sem hash) também é 403, e ainda paga o bcrypt', async () => {
        repo.buscarSenhaHash.mockResolvedValue(null);
        bcrypt.compare.mockResolvedValue(true);

        await expect(service.concederAUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 403 });

        expect(bcrypt.compare).toHaveBeenCalledWith('senha-do-ator', 'hash-descartavel');
    });

    test('alvo de outra empresa (ou inexistente): 404, rollback', async () => {
        repo.buscarUsuario.mockResolvedValue(null);

        await expect(service.concederAUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 404 });

        expect(repo.buscarUsuario).toHaveBeenCalledWith(7, 5, client);
        expect(sqls()).toEqual(['BEGIN', 'ROLLBACK']);
        expect(repo.inserirConcessao).not.toHaveBeenCalled();
    });

    test.each([
        ['usuário inativo', { papel: 'vendedor', ativo: false }, null, 'Usuário inativo'],
        ['já é Admin pelo cargo base', { papel: 'admin', ativo: true }, null, 'Este usuário já é Admin pelo cargo'],
        ['já é Admin pela capacidade do cargo', { papel: 'gerente', ativo: true }, { nivel: 70, ativo: true, capacidades: ['administrador'] }, 'Este usuário já é Admin pelo cargo'],
        ['cargo do usuário desligado', { papel: 'gerente', ativo: true }, { nivel: 70, ativo: false, capacidades: [] }, 'O cargo deste usuário está desabilitado neste comércio']
    ])('409: %s', async (_nome, alvo, linhaDoCargo, mensagem) => {
        repo.buscarUsuario.mockResolvedValue({ id: 5, nome: 'Bia', ...alvo });
        cargosRepository.buscar.mockResolvedValue(linhaDoCargo);

        await expect(service.concederAUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 409, message: mensagem });

        expect(repo.inserirConcessao).not.toHaveBeenCalled();
        expect(sqls()).toContain('ROLLBACK');
    });

    test('já tem concessão ativa: 409 (sem duplicar)', async () => {
        repo.concessaoAtiva.mockResolvedValue({ id: 3 });

        await expect(service.concederAUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 409 });
        expect(repo.inserirConcessao).not.toHaveBeenCalled();
    });

    test('falha ao gravar o evento desfaz a concessão (rollback)', async () => {
        repo.registrarEvento.mockRejectedValue(new Error('falha de banco'));

        await expect(service.concederAUsuario(ator, 5, confirmacao)).rejects.toThrow('falha de banco');

        expect(sqls()).toEqual(['BEGIN', 'ROLLBACK']);
        expect(client.release).toHaveBeenCalled();
    });

    test('Admin delegado (que não é admin de cargo) pode conceder a outra pessoa', async () => {
        await expect(service.concederAUsuario(gerenteDelegado, 5, confirmacao)).resolves.toMatchObject({ administrador_concedido: true });
    });
});

describe('revogarDeUsuario', () => {
    beforeEach(() => repo.concessaoAtiva.mockResolvedValue({ id: 10 }));

    test('revoga, derruba as sessões do usuário e registra o evento', async () => {
        const r = await service.revogarDeUsuario(ator, 5, confirmacao);

        expect(r).toMatchObject({ usuario_id: 5, administrador_concedido: false, evento_id: 99 });
        expect(repo.revogarConcessao).toHaveBeenCalledWith({ id: 10, empresa_id: 7, revogado_por: 1 }, client);
        expect(repo.incrementarTokenDoUsuario).toHaveBeenCalledWith(7, 5, client);
        expect(repo.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({ acao: 'revogar', alvo_usuario_id: 5 }), client);
        expect(sqls()).toEqual(['BEGIN', 'COMMIT']);
    });

    test('último Admin: 409, rollback, sem derrubar sessão nem registrar evento', async () => {
        repo.contarAdministradoresEfetivos.mockResolvedValue(0);

        await expect(service.revogarDeUsuario(ator, 5, confirmacao)).rejects.toMatchObject({
            statusCode: 409, message: 'O comércio precisa manter ao menos um Admin ativo'
        });

        expect(sqls()).toEqual(['BEGIN', 'ROLLBACK']);
        expect(repo.incrementarTokenDoUsuario).not.toHaveBeenCalled();
        expect(repo.registrarEvento).not.toHaveBeenCalled();
    });

    test('a contagem do último Admin acontece DEPOIS da revogação e dentro da transação', async () => {
        const ordem = [];
        repo.revogarConcessao.mockImplementation(async () => { ordem.push('revogar'); return 1; });
        repo.contarAdministradoresEfetivos.mockImplementation(async (empresa, c) => { ordem.push(`contar:${c === client}`); return 1; });

        await service.revogarDeUsuario(ator, 5, confirmacao);

        expect(ordem).toEqual(['revogar', 'contar:true']);
    });

    test('quem não tem concessão individual: 409 (Admin de cargo não se revoga por aqui)', async () => {
        repo.concessaoAtiva.mockResolvedValue(null);

        await expect(service.revogarDeUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 409 });
        expect(repo.revogarConcessao).not.toHaveBeenCalled();
    });

    test('senha errada e alvo de outra empresa seguem as mesmas regras', async () => {
        bcrypt.compare.mockResolvedValueOnce(false);
        await expect(service.revogarDeUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 403 });

        repo.buscarUsuario.mockResolvedValue(null);
        await expect(service.revogarDeUsuario(ator, 5, confirmacao)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('revogar a própria concessão é permitido (desde que reste outro Admin)', async () => {
        await expect(service.revogarDeUsuario({ ...ator, id: 5 }, 5, confirmacao)).resolves.toMatchObject({ administrador_concedido: false });
    });
});

describe('concederACargo', () => {
    test('anexa `administrador` à linha do cargo preservando nível, ativo e demais capacidades', async () => {
        cargosRepository.buscar.mockResolvedValue({ nivel: 60, ativo: true, capacidades: ['ver_custos'] });

        const r = await service.concederACargo(ator, 'coordenador', confirmacao);

        expect(r).toMatchObject({ cargo: 'coordenador', administrador: true, usuarios_afetados: 3, evento_id: 99 });
        expect(cargosRepository.salvar).toHaveBeenCalledWith({
            empresa_id: 7, cargo: 'coordenador', nivel: 60, ativo: true, capacidades: ['ver_custos', 'administrador'], usuario_id: 1
        }, client);
        expect(repo.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({
            escopo: 'cargo', acao: 'conceder', alvo_cargo: 'coordenador', usuarios_afetados: 3
        }), client);
    });

    test('cargo sem linha usa o padrão do catálogo como base (cargo desligado por padrão → 409)', async () => {
        await expect(service.concederACargo(ator, 'gerente', confirmacao)).rejects.toMatchObject({
            statusCode: 409, message: 'Cargo desabilitado neste comércio'
        });
    });

    test('cargo básico sem linha (vendedor) parte do padrão do catálogo', async () => {
        await service.concederACargo(ator, 'vendedor', confirmacao);

        expect(cargosRepository.salvar).toHaveBeenCalledWith(expect.objectContaining({ cargo: 'vendedor', nivel: 30, capacidades: ['cancelar_venda', 'administrador'] }), client);
    });

    test('Admin (cargo imutável) e cargo inexistente são recusados antes de pedir senha', async () => {
        await expect(service.concederACargo(ator, 'admin', confirmacao)).rejects.toMatchObject({ statusCode: 409 });
        await expect(service.concederACargo(ator, 'presidente', confirmacao)).rejects.toMatchObject({ statusCode: 400 });

        expect(repo.buscarSenhaHash).not.toHaveBeenCalled();
    });

    test('quem não é Admin não concede ao próprio cargo; Admin delegado pode', async () => {
        await expect(service.concederACargo(gerenteDelegado, 'gerente', confirmacao)).rejects.toMatchObject({ statusCode: 403 });

        cargosRepository.buscar.mockResolvedValue({ nivel: 70, ativo: true, capacidades: [] });
        await expect(service.concederACargo({ ...gerenteDelegado, role: 'admin' }, 'gerente', confirmacao)).resolves.toMatchObject({ administrador: true });
    });

    test('cargo que já é administrador: 409', async () => {
        cargosRepository.buscar.mockResolvedValue({ nivel: 60, ativo: true, capacidades: ['administrador'] });

        await expect(service.concederACargo(ator, 'coordenador', confirmacao)).rejects.toMatchObject({ statusCode: 409 });
        expect(cargosRepository.salvar).not.toHaveBeenCalled();
    });

    test('senha errada: nada é gravado', async () => {
        bcrypt.compare.mockResolvedValue(false);

        await expect(service.concederACargo(ator, 'coordenador', confirmacao)).rejects.toMatchObject({ statusCode: 403 });
        expect(db.connect).not.toHaveBeenCalled();
    });
});

describe('revogarDeCargo', () => {
    beforeEach(() => cargosRepository.buscar.mockResolvedValue({ nivel: 60, ativo: true, capacidades: ['ver_custos', 'administrador'] }));

    test('remove só `administrador`, derruba as sessões do cargo e registra quantos foram afetados', async () => {
        const r = await service.revogarDeCargo(ator, 'coordenador', confirmacao);

        expect(r).toMatchObject({ cargo: 'coordenador', administrador: false, usuarios_afetados: 3 });
        expect(cargosRepository.salvar).toHaveBeenCalledWith(expect.objectContaining({ capacidades: ['ver_custos'], nivel: 60, ativo: true }), client);
        expect(repo.incrementarTokenDoCargo).toHaveBeenCalledWith(7, 'coordenador', client);
    });

    test('último Admin: 409 e rollback', async () => {
        repo.contarAdministradoresEfetivos.mockResolvedValue(0);

        await expect(service.revogarDeCargo(ator, 'coordenador', confirmacao)).rejects.toMatchObject({ statusCode: 409 });

        expect(sqls()).toEqual(['BEGIN', 'ROLLBACK']);
        expect(repo.incrementarTokenDoCargo).not.toHaveBeenCalled();
    });

    test('cargo sem o privilégio: 409', async () => {
        cargosRepository.buscar.mockResolvedValue({ nivel: 60, ativo: true, capacidades: ['ver_custos'] });

        await expect(service.revogarDeCargo(ator, 'coordenador', confirmacao)).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('listagens', () => {
    test('histórico pagina e devolve totais', async () => {
        repo.listarEventos.mockResolvedValue({ items: [{ id: 1 }], total: 45 });

        const r = await service.historico(7, { page: 3, pageSize: 20, escopo: 'cargo' });

        expect(repo.listarEventos).toHaveBeenCalledWith(7, { limit: 20, offset: 40, escopo: 'cargo' });
        expect(r).toEqual({ items: [{ id: 1 }], page: 3, pageSize: 20, total: 45, totalPages: 3 });
    });

    test('listagens recebem a empresa do ator', async () => {
        repo.listarAdministradores.mockResolvedValue([]);
        repo.listarUsuarios.mockResolvedValue([]);

        await service.listarAdministradores(7);
        await service.listarUsuarios(7);

        expect(repo.listarAdministradores).toHaveBeenCalledWith(7);
        expect(repo.listarUsuarios).toHaveBeenCalledWith(7);
    });
});

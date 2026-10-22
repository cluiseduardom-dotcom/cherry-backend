const bcrypt = require('bcrypt');
const db = require('../config/db');
const AppError = require('../errors/AppError');
const privilegiosRepository = require('../repositories/privilegiosRepository');
const cargosRepository = require('../repositories/cargosRepository');
const { CATALOGO, CAPACIDADES, PERFIL_ADMIN } = require('../constants/cargos');
const { resolverCargo } = require('./permissoesService');

// Concessão e revogação do privilégio de Admin (individual e por cargo). Regras (SPEC, §2 e §4):
//  - exige a SENHA de quem executa (digitada na hora) e um MOTIVO; ambos vão para a auditoria;
//  - ninguém concede Admin a si mesmo; quem não é Admin também não concede ao próprio cargo;
//  - o comércio nunca fica sem ao menos um Admin ativo (checado na mesma transação, com o
//    comércio travado, para duas revogações simultâneas não passarem juntas);
//  - revogar derruba as sessões já emitidas de quem perdeu o acesso (token_version).

const HASH_DESCARTAVEL = bcrypt.hashSync('hash-descartavel-sem-usuario', 10);

const MENSAGEM_ULTIMO_ADMIN = 'O comércio precisa manter ao menos um Admin ativo';

async function confirmarSenha(ator, senha) {
    const hash = await privilegiosRepository.buscarSenhaHash(ator.empresa_id, ator.id);

    // Sempre paga um bcrypt.compare (sem diferença de tempo observável).
    const valida = await bcrypt.compare(senha, hash ?? HASH_DESCARTAVEL);

    if (!hash || !valida) {
        throw new AppError('Senha de confirmação inválida', 403);
    }
}

async function emTransacao(operacao) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const resultado = await operacao(client);
        await client.query('COMMIT');

        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function garantirAoMenosUmAdmin(empresaId, client) {
    if (await privilegiosRepository.contarAdministradoresEfetivos(empresaId, client) < 1) {
        throw new AppError(MENSAGEM_ULTIMO_ADMIN, 409);
    }
}

async function carregarAlvo(empresaId, usuarioId, client) {
    // Usuário de outra empresa é tratado como inexistente (não confirma o id).
    const alvo = await privilegiosRepository.buscarUsuario(empresaId, usuarioId, client);

    if (!alvo) {
        throw new AppError('Usuário não encontrado', 404);
    }

    return alvo;
}

async function concederAUsuario(ator, usuarioId, { senha, motivo }) {
    if (usuarioId === ator.id) {
        throw new AppError('Você não pode conceder o privilégio de Admin a si mesmo', 403);
    }

    await confirmarSenha(ator, senha);

    return emTransacao(async (client) => {
        await privilegiosRepository.travarEmpresa(client, ator.empresa_id);

        const alvo = await carregarAlvo(ator.empresa_id, usuarioId, client);

        if (!alvo.ativo) {
            throw new AppError('Usuário inativo', 409);
        }

        const cargo = resolverCargo(alvo.papel, await cargosRepository.buscar(ator.empresa_id, alvo.papel, client));

        if (!cargo || !cargo.ativo) {
            throw new AppError('O cargo deste usuário está desabilitado neste comércio', 409);
        }

        if (cargo.administrador) {
            throw new AppError('Este usuário já é Admin pelo cargo', 409);
        }

        if (await privilegiosRepository.concessaoAtiva(ator.empresa_id, usuarioId, client)) {
            throw new AppError('Este usuário já tem o privilégio de Admin', 409);
        }

        const concessao = await privilegiosRepository.inserirConcessao(
            { empresa_id: ator.empresa_id, usuario_id: usuarioId, concedido_por: ator.id, motivo }, client
        );
        const evento = await privilegiosRepository.registrarEvento({
            empresa_id: ator.empresa_id, escopo: 'usuario', acao: 'conceder', alvo_usuario_id: usuarioId,
            executado_por: ator.id, motivo, usuarios_afetados: 1
        }, client);

        return { usuario_id: usuarioId, nome: alvo.nome, administrador_concedido: true, concedido_em: concessao.concedido_em, evento_id: evento.id };
    });
}

async function revogarDeUsuario(ator, usuarioId, { senha, motivo }) {
    await confirmarSenha(ator, senha);

    return emTransacao(async (client) => {
        await privilegiosRepository.travarEmpresa(client, ator.empresa_id);

        const alvo = await carregarAlvo(ator.empresa_id, usuarioId, client);
        const concessao = await privilegiosRepository.concessaoAtiva(ator.empresa_id, usuarioId, client);

        // Admin pelo cargo (base ou capacidade do cargo) não se revoga por aqui.
        if (!concessao) {
            throw new AppError('Este usuário não tem Admin concedido individualmente', 409);
        }

        await privilegiosRepository.revogarConcessao({ id: concessao.id, empresa_id: ator.empresa_id, revogado_por: ator.id }, client);
        await garantirAoMenosUmAdmin(ator.empresa_id, client);
        await privilegiosRepository.incrementarTokenDoUsuario(ator.empresa_id, usuarioId, client);

        const evento = await privilegiosRepository.registrarEvento({
            empresa_id: ator.empresa_id, escopo: 'usuario', acao: 'revogar', alvo_usuario_id: usuarioId,
            executado_por: ator.id, motivo, usuarios_afetados: 1
        }, client);

        return { usuario_id: usuarioId, nome: alvo.nome, administrador_concedido: false, evento_id: evento.id };
    });
}

function validarCargoAlvo(cargo) {
    if (!CATALOGO[cargo]) {
        throw new AppError('Cargo inválido', 400);
    }

    if (CATALOGO[cargo].imutavel) {
        throw new AppError('O cargo Admin já é administrador e não se altera', 409);
    }
}

async function concederACargo(ator, cargo, { senha, motivo }) {
    validarCargoAlvo(cargo);

    // Sem isto, quem tem `conceder_admin` sem ser Admin se promoveria pelo próprio cargo.
    if (ator.role !== PERFIL_ADMIN && ator.cargo === cargo) {
        throw new AppError('Você não pode conceder o privilégio de Admin ao seu próprio cargo', 403);
    }

    await confirmarSenha(ator, senha);

    return emTransacao(async (client) => {
        await privilegiosRepository.travarEmpresa(client, ator.empresa_id);

        const efetivo = resolverCargo(cargo, await cargosRepository.buscar(ator.empresa_id, cargo, client));

        if (!efetivo.ativo) {
            throw new AppError('Cargo desabilitado neste comércio', 409);
        }

        if (efetivo.administrador) {
            throw new AppError('Este cargo já tem o privilégio de Admin', 409);
        }

        await cargosRepository.salvar({
            empresa_id: ator.empresa_id, cargo, nivel: efetivo.nivel, ativo: efetivo.ativo,
            capacidades: [...efetivo.capacidades, CAPACIDADES.ADMINISTRADOR], usuario_id: ator.id
        }, client);

        const afetados = await privilegiosRepository.contarUsuariosAtivosDoCargo(ator.empresa_id, cargo, client);
        const evento = await privilegiosRepository.registrarEvento({
            empresa_id: ator.empresa_id, escopo: 'cargo', acao: 'conceder', alvo_cargo: cargo,
            executado_por: ator.id, motivo, usuarios_afetados: afetados
        }, client);

        return { cargo, administrador: true, usuarios_afetados: afetados, evento_id: evento.id };
    });
}

async function revogarDeCargo(ator, cargo, { senha, motivo }) {
    validarCargoAlvo(cargo);

    await confirmarSenha(ator, senha);

    return emTransacao(async (client) => {
        await privilegiosRepository.travarEmpresa(client, ator.empresa_id);

        const efetivo = resolverCargo(cargo, await cargosRepository.buscar(ator.empresa_id, cargo, client));

        if (!efetivo.administrador) {
            throw new AppError('Este cargo não tem o privilégio de Admin', 409);
        }

        await cargosRepository.salvar({
            empresa_id: ator.empresa_id, cargo, nivel: efetivo.nivel, ativo: efetivo.ativo,
            capacidades: efetivo.capacidades.filter((capacidade) => capacidade !== CAPACIDADES.ADMINISTRADOR),
            usuario_id: ator.id
        }, client);

        await garantirAoMenosUmAdmin(ator.empresa_id, client);
        await privilegiosRepository.incrementarTokenDoCargo(ator.empresa_id, cargo, client);

        const afetados = await privilegiosRepository.contarUsuariosAtivosDoCargo(ator.empresa_id, cargo, client);
        const evento = await privilegiosRepository.registrarEvento({
            empresa_id: ator.empresa_id, escopo: 'cargo', acao: 'revogar', alvo_cargo: cargo,
            executado_por: ator.id, motivo, usuarios_afetados: afetados
        }, client);

        return { cargo, administrador: false, usuarios_afetados: afetados, evento_id: evento.id };
    });
}

const listarAdministradores = (empresaId) => privilegiosRepository.listarAdministradores(empresaId);

const listarUsuarios = (empresaId) => privilegiosRepository.listarUsuarios(empresaId);

async function historico(empresaId, { page, pageSize, ...filtros }) {
    const { items, total } = await privilegiosRepository.listarEventos(empresaId, {
        limit: pageSize, offset: (page - 1) * pageSize, ...filtros
    });

    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

module.exports = {
    concederAUsuario,
    revogarDeUsuario,
    concederACargo,
    revogarDeCargo,
    listarAdministradores,
    listarUsuarios,
    historico
};

const bcrypt = require('bcrypt');
const AppError = require('../errors/AppError');
const usuariosRepository = require('../repositories/usuariosRepository');
const usuarioRepository = require('../repositories/usuarioRepository');
const cargosRepository = require('../repositories/cargosRepository');
const cargosService = require('./cargosService');
const { resolverCargo, aplicarConcessoes } = require('./permissoesService');
const { PERFIL_ADMIN } = require('../constants/cargos');

// Gestão de usuários delegada a quem tem `gerir_usuarios` (diretor a supervisor por padrão;
// o Admin da empresa ajusta pelos cargos). empresa_id e ator vêm sempre do JWT.
//
// Regra única de hierarquia (a mesma de cargosService.garantirSemEscalada):
//   - ninguém gerencia a si mesmo;
//   - ninguém gerencia Admin (cargo admin, cargo com `administrador` ou admin concedido):
//     isso fica nos fluxos próprios, com senha e auditoria (/privilegios);
//   - quem não é Admin só gerencia cargo de nível ESTRITAMENTE menor que o seu. Cargos fora
//     da escada (estoquista, faturista) contam como nível 0: ficam abaixo de todos.

const MENSAGEM_ESCALADA = 'Você só pode gerenciar usuários de cargo abaixo do seu nível';

function nivelDoCargo(permissoes) {
    return permissoes.escada ? permissoes.nivel : 0;
}

// Cargo efetivo (catálogo + cargos_empresa + admin concedido) a partir de uma linha de usuário.
function permissoesDoUsuario(usuario) {
    const linha = usuario.cargo_configurado
        ? { nivel: usuario.cargo_nivel, ativo: usuario.cargo_ativo, capacidades: usuario.cargo_capacidades }
        : null;

    const base = resolverCargo(usuario.papel, linha);

    if (!base) return null;

    return aplicarConcessoes(base, { administrador_concedido: usuario.administrador_concedido === true });
}

// Devolve { pode, motivo }: usado tanto para listar (pode_gerenciar) quanto para autorizar.
function avaliarAlvo(ator, alvo) {
    if (alvo.id === ator.id) {
        return { pode: false, motivo: 'Você não pode gerenciar o seu próprio usuário' };
    }

    const permissoes = permissoesDoUsuario(alvo);

    if (!permissoes) {
        return { pode: false, motivo: 'Cargo do usuário desconhecido' };
    }

    if (permissoes.role === PERFIL_ADMIN) {
        return { pode: false, motivo: 'Usuários Admin não são gerenciados por aqui' };
    }

    if (ator.role === PERFIL_ADMIN) {
        return { pode: true };
    }

    if (nivelDoCargo(permissoes) >= (ator.nivel ?? 0)) {
        return { pode: false, motivo: MENSAGEM_ESCALADA };
    }

    return { pode: true };
}

function garantirPodeGerenciar(ator, alvo) {
    const { pode, motivo } = avaliarAlvo(ator, alvo);

    if (!pode) {
        throw new AppError(motivo, 403);
    }
}

async function listar(ator) {
    const usuarios = await usuariosRepository.listarPorEmpresa(ator.empresa_id);

    return usuarios.map((usuario) => {
        const { pode, motivo } = avaliarAlvo(ator, usuario);

        return {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            cargo: usuario.papel,
            ativo: usuario.ativo,
            criado_em: usuario.criado_em,
            pode_gerenciar: pode,
            motivo_bloqueio_gestao: pode ? null : motivo
        };
    });
}

async function criar({ nome, email, senha, papel }, ator) {
    const empresaId = ator.empresa_id;

    // Só cargos ligados no comércio.
    await cargosService.garantirCargoAtivo(empresaId, papel);

    const linha = await cargosRepository.buscar(empresaId, papel);
    const permissoes = resolverCargo(papel, linha);

    if (permissoes.role === PERFIL_ADMIN) {
        throw new AppError('Usuários Admin não são criados por aqui', 403);
    }

    if (ator.role !== PERFIL_ADMIN && nivelDoCargo(permissoes) >= (ator.nivel ?? 0)) {
        throw new AppError(MENSAGEM_ESCALADA, 403);
    }

    const existente = await usuarioRepository.buscarPorEmail(email);

    if (existente) {
        throw new AppError('Email já cadastrado', 409);
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const usuario = await usuariosRepository.criarComAuditoria({
        nome,
        email,
        senhaHash,
        papel,
        empresa_id: empresaId,
        executado_por: ator.id,
        motivo: null
    });

    return { usuario };
}

async function definirBloqueio(usuarioId, { bloqueado, motivo }, ator) {
    return usuariosRepository.alterarBloqueio({
        empresa_id: ator.empresa_id,
        usuario_id: usuarioId,
        bloqueado,
        motivo,
        executado_por: ator.id,
        autorizar: (alvo) => garantirPodeGerenciar(ator, alvo)
    });
}

async function listarEventos({ page, pageSize }, empresaId) {
    const { items, total } = await usuariosRepository.listarEventos({
        empresa_id: empresaId,
        limit: pageSize,
        offset: (page - 1) * pageSize
    });

    return {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

module.exports = {
    avaliarAlvo,
    permissoesDoUsuario,
    listar,
    criar,
    definirBloqueio,
    listarEventos
};

const bcrypt = require('bcrypt');
const AppError = require('../errors/AppError');
const usuariosRepository = require('../repositories/usuariosRepository');
const usuarioRepository = require('../repositories/usuarioRepository');
const cargosRepository = require('../repositories/cargosRepository');
const cargosService = require('./cargosService');
const { resolverCargo, aplicarConcessoes } = require('./permissoesService');
const { PERFIL_ADMIN } = require('../constants/cargos');
const { gerarSenhaTemporaria } = require('../utils/senhaTemporaria');

const HASH_DESCARTAVEL = bcrypt.hashSync('hash-descartavel-sem-usuario', 10);
const { CAMPOS_DADOS } = require('../validations/usuariosValidation');
const storage = require('./storage/imagensStorage');

function urlDaFoto(chave) {
    return chave ? storage.urlPublica(chave) : null;
}

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
            telefone: usuario.telefone ?? null,
            foto_url: urlDaFoto(usuario.foto_chave),
            pode_gerenciar: pode,
            motivo_bloqueio_gestao: pode ? null : motivo
        };
    });
}

// Cargos que o ator pode atribuir ao criar um usuário: só os ATIVOS na empresa, nunca Admin
// (cargo admin ou com `administrador`) e, para quem não é Admin, só de nível estritamente menor
// que o seu. É a mesma regra de `criar`: a tela lista isto em vez de adivinhar e levar 409/403.
async function listarCargosAtribuiveis(ator) {
    const cargos = await cargosService.listar(ator.empresa_id);

    return cargos
        .filter((cargo) => cargo.ativo && cargo.cargo !== PERFIL_ADMIN && !cargo.administrador)
        .filter((cargo) => ator.role === PERFIL_ADMIN || (cargo.em_escada ? cargo.nivel : 0) < (ator.nivel ?? 0))
        .map(({ cargo, rotulo, nivel, em_escada }) => ({ cargo, rotulo, nivel: em_escada ? nivel : null, em_escada }));
}

async function criar({ nome, email, senha, papel, ...dados }, ator) {
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
        motivo: null,
        dados
    });

    return { usuario };
}

// Os próprios dados o usuário sempre pode ver/editar; os de outro, só quem pode gerenciá-lo
// (mesma hierarquia do bloqueio). Dados cadastrais não mudam cargo nem acesso: sem escalada.
function garantirPodeVerOuEditar(ator, alvo) {
    if (alvo.id === ator.id) return;

    garantirPodeGerenciar(ator, alvo);
}

function apresentarDetalhe(usuario) {
    return {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        cargo: usuario.papel,
        ativo: usuario.ativo,
        criado_em: usuario.criado_em,
        foto_url: urlDaFoto(usuario.foto_chave),
        dados: Object.fromEntries(CAMPOS_DADOS.map((campo) => [campo, usuario[campo] ?? null]))
    };
}

async function detalhar(usuarioId, ator) {
    const usuario = await usuariosRepository.obterDetalhe(ator.empresa_id, usuarioId);

    if (!usuario) {
        throw new AppError('Usuário não encontrado', 404);
    }

    garantirPodeVerOuEditar(ator, usuario);

    return apresentarDetalhe(usuario);
}

async function editarDados(usuarioId, dados, ator) {
    return usuariosRepository.editarDados({
        empresa_id: ator.empresa_id,
        usuario_id: usuarioId,
        dados,
        executado_por: ator.id,
        autorizar: (alvo) => garantirPodeVerOuEditar(ator, alvo)
    });
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
        items: items.map(({ alvo_foto_chave, executado_por_foto_chave, ...item }) => ({
            ...item,
            alvo_foto_url: urlDaFoto(alvo_foto_chave),
            executado_por_foto_url: urlDaFoto(executado_por_foto_chave)
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

// Redefinição de senha por um admin: confirma a senha DO ADMIN (sessão roubada não redefine),
// gera uma senha aleatória, grava só o hash e devolve a senha em texto UMA vez. O usuário fica
// obrigado a trocá-la no primeiro acesso. A rota já restringe a admin.
async function redefinirSenha(alvoId, senhaConfirmacao, ator) {
    const hash = await usuarioRepository.buscarSenhaHash(ator.empresa_id, ator.id);
    const valida = await bcrypt.compare(senhaConfirmacao, hash ?? HASH_DESCARTAVEL);

    if (!hash || !valida) {
        throw new AppError('Senha de confirmação inválida', 403);
    }

    const senhaTemporaria = gerarSenhaTemporaria();
    const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

    const usuario = await usuariosRepository.redefinirSenha({
        alvo_id: alvoId,
        empresa_id: ator.empresa_id,
        senhaHash,
        executado_por: ator.id
    });

    return { usuario, senha_temporaria: senhaTemporaria };
}

module.exports = {
    redefinirSenha,
    avaliarAlvo,
    garantirPodeGerenciar,
    permissoesDoUsuario,
    listar,
    listarCargosAtribuiveis,
    criar,
    detalhar,
    editarDados,
    definirBloqueio,
    listarEventos
};

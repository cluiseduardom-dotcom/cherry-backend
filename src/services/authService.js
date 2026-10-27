const bcrypt = require('bcrypt');
const tokenService = require('./tokenService');
const usuarioRepository = require('../repositories/usuarioRepository');
const AppError = require('../errors/AppError');
const cargosService = require('./cargosService');
const { resolverTemaVisual } = require('../constants/temasVisuais');

// Hash descartável: quando o e-mail não existe, ainda pagamos um bcrypt.compare
// para a resposta não denunciar (pelo tempo) se o usuário existe.
const HASH_DESCARTAVEL = bcrypt.hashSync('hash-descartavel-sem-usuario', 10);

const MENSAGEM_CREDENCIAIS = 'Email ou senha inválidos';

async function login(email, senha) {

    const usuario = await usuarioRepository.buscarPorEmail(email);

    const senhaValida = await bcrypt.compare(senha, usuario ? usuario.senha : HASH_DESCARTAVEL);

    if (!usuario || !senhaValida) {
        throw new AppError(MENSAGEM_CREDENCIAIS, 401);
    }

    // Usuário ou empresa desativados não autenticam. Mesma resposta de senha
    // errada: não confirma a existência/estado da conta para quem não a prova.
    if (usuario.ativo === false || (usuario.empresa_status && usuario.empresa_status !== 'ativa')) {
        throw new AppError(MENSAGEM_CREDENCIAIS, 401);
    }

    const token = tokenService.emitirToken(usuario);

    return {
        token,
        usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            papel: usuario.papel,
            empresa_id: usuario.empresa_id,
            senha_temporaria: usuario.senha_temporaria === true,
            plataforma_admin: usuario.plataforma_admin === true,
            // Identidade visual da empresa do próprio usuário (lida do banco, nunca da requisição).
            empresa: { id: usuario.empresa_id, tema: resolverTemaVisual(usuario.empresa_tema) }
        }
    };
}

async function register(nome, email, senha, papel, empresa_id) {

    // Só cargos ligados no comércio (os básicos — admin, vendedor, estoquista — sempre estão).
    await cargosService.garantirCargoAtivo(empresa_id, papel);

    const usuarioExistente = await usuarioRepository.buscarPorEmail(email);

    if (usuarioExistente) {
        throw new AppError('Email já cadastrado', 409);
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const usuario = await usuarioRepository.criar({ nome, email, senha: senhaHash, papel, empresa_id });

    return { usuario };
}

// Troca da própria senha: exige a senha atual (quem roubou uma sessão não troca), a nova tem de
// diferir da atual e o token_version avança (outras sessões caem). Devolve um token novo para a
// sessão que trocou continuar logada.
async function alterarPropriaSenha(ator, senhaAtual, novaSenha) {

    const hash = await usuarioRepository.buscarSenhaHash(ator.empresa_id, ator.id);

    // Sempre paga um bcrypt.compare (sem diferença de tempo observável).
    const valida = await bcrypt.compare(senhaAtual, hash ?? HASH_DESCARTAVEL);

    if (!hash || !valida) {
        throw new AppError('Senha atual inválida', 403);
    }

    if (await bcrypt.compare(novaSenha, hash)) {
        throw new AppError('A nova senha deve ser diferente da atual', 400);
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);
    const atualizado = await usuarioRepository.trocarPropriaSenha({ id: ator.id, empresa_id: ator.empresa_id, senhaHash });

    if (!atualizado) {
        throw new AppError('Usuário não encontrado', 404);
    }

    return { token: tokenService.emitirToken(atualizado) };
}

module.exports = {
    login,
    register,
    alterarPropriaSenha
};

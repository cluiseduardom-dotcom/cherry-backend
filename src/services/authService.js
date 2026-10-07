const bcrypt = require('bcrypt');
const tokenService = require('./tokenService');
const usuarioRepository = require('../repositories/usuarioRepository');
const AppError = require('../errors/AppError');

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
            empresa_id: usuario.empresa_id
        }
    };
}

async function register(nome, email, senha, papel, empresa_id) {

    const usuarioExistente = await usuarioRepository.buscarPorEmail(email);

    if (usuarioExistente) {
        throw new AppError('Email já cadastrado', 409);
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const usuario = await usuarioRepository.criar({ nome, email, senha: senhaHash, papel, empresa_id });

    return { usuario };
}

module.exports = {
    login,
    register
};

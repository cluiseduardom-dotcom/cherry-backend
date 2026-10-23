const bcrypt = require('bcrypt');
const tokenService = require('./tokenService');
const usuarioRepository = require('../repositories/usuarioRepository');
const AppError = require('../errors/AppError');
const cargosService = require('./cargosService');
const moduloRepository = require('../repositories/moduloRepository');
const { resolverTemaVisual } = require('../constants/temasVisuais');

// Hash descartável: quando o e-mail não existe, ainda pagamos um bcrypt.compare
// para a resposta não denunciar (pelo tempo) se o usuário existe.
const HASH_DESCARTAVEL = bcrypt.hashSync('hash-descartavel-sem-usuario', 10);

const MENSAGEM_CREDENCIAIS = 'Email ou senha inválidos';

// Módulos ativos da empresa do próprio usuário (só códigos), para o frontend esconder menus.
// Não é fronteira de segurança: o backend barra por rota (exigirModulo). Se a consulta falhar,
// o login segue com lista vazia (esconde menus opcionais; nunca libera nada).
async function listarModulosAtivos(empresa_id) {
    try {
        return await moduloRepository.listarAtivos(empresa_id);
    } catch (error) {
        console.error('Falha ao listar módulos ativos da empresa no login');
        return [];
    }
}

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
    const modulos = await listarModulosAtivos(usuario.empresa_id);

    return {
        token,
        usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            papel: usuario.papel,
            empresa_id: usuario.empresa_id,
            // Identidade visual da empresa do próprio usuário (lida do banco, nunca da requisição).
            empresa: { id: usuario.empresa_id, tema: resolverTemaVisual(usuario.empresa_tema), modulos }
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

module.exports = {
    login,
    register
};

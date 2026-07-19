const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const usuarioRepository = require('../repositories/usuarioRepository');
const AppError = require('../errors/AppError');

const JWT_EXPIRES_IN = '8h';

async function login(email, senha) {

    const usuario = await usuarioRepository.buscarPorEmail(email);

    if (!usuario) {
        throw new AppError('Email ou senha inválidos', 401);
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);

    if (!senhaValida) {
        throw new AppError('Email ou senha inválidos', 401);
    }

    const token = jwt.sign(
        { id: usuario.id, role: usuario.papel },
        process.env.JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    return {
        token,
        usuario: {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            papel: usuario.papel
        }
    };
}

module.exports = {
    login
};

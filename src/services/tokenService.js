const jwt = require('jsonwebtoken');

const JWT_EXPIRES_IN = '8h';
const JWT_ALGORITHM = 'HS256';

function emitirToken(usuario) {
    return jwt.sign(
        {
            id: usuario.id,
            role: usuario.papel,
            empresa_id: usuario.empresa_id,
            tv: usuario.token_version ?? 0
        },
        process.env.JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM }
    );
}

function verificarToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
}

module.exports = { emitirToken, verificarToken, JWT_EXPIRES_IN };

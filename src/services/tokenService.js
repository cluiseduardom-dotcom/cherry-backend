const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';

// Política de sessão.
//  - Padrão (sem SESSAO_RENOVAVEL): token de 8 h, como sempre.
//  - SESSAO_RENOVAVEL=true: token CURTO (1 h) que o ERP renova enquanto a pessoa está usando (POST /auth/renovar).
//    Parou de usar por mais de 1 h: o token vence sozinho. Em qualquer caso a sessão tem TETO de 8 h desde o login
//    (claim `sa`, assinada): depois disso é preciso entrar de novo.
const SESSAO_MAXIMA_SEGUNDOS = 8 * 60 * 60;
const VIDA_TOKEN_CURTO_SEGUNDOS = 60 * 60;

const agora = () => Math.floor(Date.now() / 1000);
const renovavel = (env = process.env) => env.SESSAO_RENOVAVEL === 'true';

// Compatibilidade: exportado como antes (rótulo do tempo padrão).
const JWT_EXPIRES_IN = '8h';

// `sa` = início da sessão (epoch, segundos). No login é "agora"; na renovação é o mesmo do token anterior.
function emitirToken(usuario, { sa } = {}) {
    const inicio = sa ?? agora();
    const vida = renovavel() ? VIDA_TOKEN_CURTO_SEGUNDOS : SESSAO_MAXIMA_SEGUNDOS;
    const restante = inicio + SESSAO_MAXIMA_SEGUNDOS - agora();

    return jwt.sign(
        {
            id: usuario.id,
            role: usuario.papel,
            empresa_id: usuario.empresa_id,
            tv: usuario.token_version ?? 0,
            sa: inicio
        },
        process.env.JWT_SECRET,
        { expiresIn: Math.max(1, Math.min(vida, restante)), algorithm: JWT_ALGORITHM }
    );
}

function verificarToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
}

module.exports = { emitirToken, verificarToken, JWT_EXPIRES_IN, SESSAO_MAXIMA_SEGUNDOS, VIDA_TOKEN_CURTO_SEGUNDOS };

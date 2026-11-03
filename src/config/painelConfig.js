// Painel GiroNex: segredos PRÓPRIOS, separados do ERP.
// PAINEL_JWT_SECRET: assina as sessões do painel (mín. 32 caracteres e diferente do JWT_SECRET do ERP: um
//   token de loja nunca vale no painel e vice-versa).
// PAINEL_ENC_KEY: 32 bytes em base64; cifra o segredo TOTP de cada operador no banco.
// Sem qualquer um dos dois (ou inválido), o painel inteiro responde 503: falha fechada.

function lerChave(base64) {
    if (!base64) return null;
    try {
        const buf = Buffer.from(base64, 'base64');
        return buf.length === 32 ? buf : null;
    } catch {
        return null;
    }
}

function obterConfigPainel(env = process.env) {
    const jwtSecret = env.PAINEL_JWT_SECRET;
    const encKey = lerChave(env.PAINEL_ENC_KEY);

    if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === env.JWT_SECRET || !encKey) return null;

    return { jwtSecret, encKey };
}

module.exports = { obterConfigPainel };

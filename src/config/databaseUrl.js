const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Parâmetros de query que o `pg` usa para sobrescrever o destino da URL. Com eles,
// "postgresql://localhost/db?host=servidor-remoto" pareceria local e conectaria fora.
const PARAMETROS_DE_DESTINO = ['host', 'hostaddr', 'port', 'dbname', 'user', 'password', 'service', 'socket'];

// As mensagens nunca incluem a URL, usuário, senha ou host.
function falhar(mensagem) {
    throw new Error(mensagem);
}

function parseUrl(connectionString, nomeVariavel) {
    let url;
    try {
        url = new URL(connectionString);
    } catch {
        falhar(`${nomeVariavel} inválida`);
    }

    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        falhar(`${nomeVariavel} inválida`);
    }

    return url;
}

function ehLocal(url) {
    return HOSTS_LOCAIS.has(url.hostname.toLowerCase());
}

function validarUrlDeBanco(connectionString, nomeVariavel = 'DATABASE_URL') {
    if (!connectionString) return connectionString;

    const url = parseUrl(connectionString, nomeVariavel);

    for (const parametro of PARAMETROS_DE_DESTINO) {
        if (url.searchParams.has(parametro)) {
            falhar(`${nomeVariavel} não pode sobrescrever o destino por parâmetro de query`);
        }
    }

    const sslmodes = url.searchParams.getAll('sslmode');
    const ssls = url.searchParams.getAll('ssl');

    if (sslmodes.length > 1 || ssls.length > 1) {
        falhar(`${nomeVariavel} tem parâmetros TLS duplicados`);
    }

    if (ehLocal(url)) {
        // PostgreSQL local (CI/dev): sem TLS é aceito, mas nunca um modo explicitamente inseguro.
        if (sslmodes[0] === 'no-verify' || ['0', 'false', 'no-verify'].includes(ssls[0])) {
            falhar('sslmode=no-verify não é permitido');
        }
        return connectionString;
    }

    if (ssls.length || sslmodes[0] !== 'verify-full') {
        falhar('Conexão remota exige sslmode=verify-full');
    }

    return connectionString;
}

module.exports = { validarUrlDeBanco };

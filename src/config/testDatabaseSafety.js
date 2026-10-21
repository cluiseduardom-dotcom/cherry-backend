const { validarUrlDeBancoDescartavel } = require('./databaseUrl');

const VARIAVEIS_DE_CONEXAO = [
    'DATABASE_URL', 'DATABASE_MIGRATION_URL', 'TEST_DATABASE_URL', 'PGHOST', 'PGHOSTADDR', 'PGPORT',
    'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY',
    'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSYSCONFDIR'
];

// Comentário que o responsável grava no banco descartável (COMMENT ON DATABASE ...)
// para autorizar explicitamente a integração. Nome de banco e host não bastam.
const MARCADOR_BANCO_DESCARTAVEL = 'giroone:banco-descartavel-de-teste';

const ENDERECOS_LOOPBACK = new Set(['127.0.0.1', '::1']);

function limparVariaveisDeConexao(env = process.env) {
    for (const chave of VARIAVEIS_DE_CONEXAO) {
        delete env[chave];
    }
}

// Variáveis PG* mudam o destino do `pg` sem aparecer na URL.
function variaveisPgPresentes(env = process.env) {
    return VARIAVEIS_DE_CONEXAO.filter((chave) => chave.startsWith('PG') && env[chave] !== undefined);
}

// Prova ativa: conecta no destino já validado como loopback e exige (1) o marcador
// gravado no banco, (2) o nome do banco igual ao da URL e (3) servidor em loopback
// (ou socket), o que descarta um túnel para um servidor remoto.
async function verificarBancoDescartavel(connectionString, ClienteCtor = require('pg').Client) {
    const { banco } = validarUrlDeBancoDescartavel(connectionString);
    const client = new ClienteCtor({ connectionString });

    await client.connect();
    try {
        const { rows } = await client.query(
            `SELECT current_database() AS banco,
                    host(inet_server_addr()) AS endereco,
                    shobj_description(d.oid, 'pg_database') AS comentario
               FROM pg_database d WHERE d.datname = current_database()`
        );
        const linha = rows[0];

        if (!linha || linha.banco !== banco) {
            throw new Error('Integração bloqueada: o banco conectado difere do declarado');
        }
        if (linha.endereco !== null && !ENDERECOS_LOOPBACK.has(linha.endereco)) {
            throw new Error('Integração bloqueada: o servidor não está em loopback');
        }
        if (linha.comentario !== MARCADOR_BANCO_DESCARTAVEL) {
            throw new Error('Integração bloqueada: o banco não tem o marcador de banco descartável');
        }
    } finally {
        await client.end();
    }
}

module.exports = {
    MARCADOR_BANCO_DESCARTAVEL,
    limparVariaveisDeConexao,
    variaveisPgPresentes,
    verificarBancoDescartavel
};

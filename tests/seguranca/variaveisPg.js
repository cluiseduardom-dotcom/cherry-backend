'use strict';

// Variáveis que o `pg`/libpq usa para escolher destino, credenciais ou TLS sem aparecer na URL.
// Nos testes elas são removidas antes de qualquer módulo capaz de abrir conexão ser carregado.
const VARIAVEIS_PG = [
    'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE',
    'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR', 'PGOPTIONS', 'PGSSLMODE', 'PGSSLCERT',
    'PGSSLKEY', 'PGSSLROOTCERT', 'PGSSLCRL', 'PGSSLSNI', 'PGCONNECT_TIMEOUT',
];

function limparVariaveisPg(env = process.env) {
    for (const chave of VARIAVEIS_PG) delete env[chave];
}

module.exports = { VARIAVEIS_PG, limparVariaveisPg };

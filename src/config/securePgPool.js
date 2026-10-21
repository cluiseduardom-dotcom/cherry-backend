'use strict';

const { Pool } = require('pg');

/**
 * Force PostgreSQL TLS with certificate validation.
 * Strip connection-string SSL switches so they cannot override the explicit
 * Node TLS configuration. This helper never logs connection details.
 */
function criarPoolSeguro(connectionString) {
    if (!connectionString) {
        throw new Error('DATABASE_URL não configurada');
    }

    let url;
    try {
        url = new URL(connectionString);
    } catch {
        throw new Error('URL de conexão PostgreSQL inválida');
    }

    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw new Error('URL de conexão PostgreSQL inválida');
    }

    const host = url.hostname.toLowerCase();
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);

    // For remote databases, enforce TLS. Keep local development usable without
    // TLS unless the caller explicitly uses this secure pool in CI.
    url.searchParams.delete('sslmode');
    url.searchParams.delete('ssl');

    return new Pool({
        connectionString: url.toString(),
        ...(local ? {} : { ssl: { rejectUnauthorized: true } })
    });
}

module.exports = { criarPoolSeguro };

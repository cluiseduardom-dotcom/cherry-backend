'use strict';

// Marca, DE PROPÓSITO, o banco apontado por TEST_DATABASE_URL como descartável de testes
// (COMMENT ON DATABASE). Os testes de integração se recusam a rodar sem esta marca.
//
// Uso (uma vez por banco de testes; o CI faz isso no próprio job):
//   TEST_DATABASE_URL=postgresql://.../cherry_test node tests/integration/marcarBancoDescartavel.js
//
// Antes de marcar, aplica o mesmo guard de nome/host e a guarda de conteúdo (empresas):
// um banco com dados reais não é marcado. Só lê e escreve o COMMENT; nada mais.

const { validarBancoDeTeste, lerUrlsCompartilhadas, formatarFalha } = require('../seguranca/validarBancoDeTeste');
const { MARCA_BANCO_DESCARTAVEL, avaliarEmpresas } = require('../seguranca/validarConteudoDoBanco');

async function main() {
    const testUrl = process.env.TEST_DATABASE_URL;

    const resultado = validarBancoDeTeste({
        testUrl,
        env: process.env,
        urlsCompartilhadas: lerUrlsCompartilhadas({ env: process.env }),
    });

    if (!resultado.ok) throw new Error(formatarFalha(resultado));

    const { Client } = require('pg');
    const client = new Client({ connectionString: testUrl, connectionTimeoutMillis: 8000 });

    try {
        await client.connect();

        const { rows } = await client.query('SELECT current_database() AS banco');
        const banco = rows[0].banco;
        if (banco !== resultado.destino.banco) {
            throw new Error(`O servidor respondeu com o banco "${banco}", diferente do esperado.`);
        }

        const existeEmpresas = (await client.query(`SELECT to_regclass('public.empresas') AS t`)).rows[0].t;
        const empresas = existeEmpresas ? (await client.query('SELECT id, nome FROM empresas ORDER BY id')).rows : [];
        const conteudo = avaliarEmpresas(empresas);
        if (!conteudo.ok) throw new Error(formatarFalha({ motivo: conteudo.motivo, destino: resultado.destino }));

        // O nome do banco vem de current_database() já validado; aspas duplas por segurança.
        await client.query(`COMMENT ON DATABASE "${banco.replace(/"/g, '""')}" IS '${MARCA_BANCO_DESCARTAVEL}'`);
        console.log(`Banco ${resultado.destino.host}/${banco} marcado como descartável de testes.`);
    } finally {
        await client.end().catch(() => {});
    }
}

if (require.main === module) {
    main().catch((erro) => {
        console.error(erro.message);
        process.exit(1);
    });
}

module.exports = { main };

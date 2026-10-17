'use strict';

// Roda UMA vez, no processo principal do Jest, ANTES de qualquer suíte de integração.
// Se algo estiver errado, lança erro e o Jest aborta a execução inteira: nenhum worker
// sobe, nenhum pool é criado e nenhuma escrita acontece.
//
// Ordem deliberada:
//   1) validação estática da TEST_DATABASE_URL (sem rede) — pode rejeitar sem conectar;
//   2) só se passar, UMA conexão de identidade (SELECT current_database()) para
//      confirmar que o servidor mesmo é um banco de testes. Sem escrita.

const {
    NOME_DE_BANCO_DE_TESTE,
    validarBancoDeTeste,
    lerUrlsCompartilhadas,
    formatarFalha,
} = require('../seguranca/validarBancoDeTeste');

const { avaliarMarca, validarConteudoDoBanco } = require('../seguranca/validarConteudoDoBanco');

module.exports = async function globalSetup() {
    const testUrl = process.env.TEST_DATABASE_URL;

    const resultado = validarBancoDeTeste({
        testUrl,
        env: process.env,
        urlsCompartilhadas: lerUrlsCompartilhadas({ env: process.env }),
    });

    if (!resultado.ok) {
        throw new Error(formatarFalha(resultado));
    }

    const { Client } = require('pg');
    const client = new Client({ connectionString: testUrl, connectionTimeoutMillis: 8000 });

    try {
        await client.connect();
        const { rows } = await client.query('SELECT current_database() AS banco');
        const bancoReal = rows[0].banco;

        if (!NOME_DE_BANCO_DE_TESTE.test(bancoReal) || bancoReal !== resultado.destino.banco) {
            throw new Error(
                formatarFalha({
                    motivo: `O servidor respondeu com o banco "${bancoReal}", que não é o banco de testes esperado.`,
                    destino: resultado.destino,
                })
            );
        }

        // Camadas A e B: somente SELECT. Nada é escrito antes de o banco provar que é descartável.
        const marca = await client.query(
            `SELECT shobj_description(oid, 'pg_database') AS comentario FROM pg_database WHERE datname = current_database()`
        );
        const semMarca = avaliarMarca(marca.rows[0].comentario);
        if (!semMarca.ok) {
            throw new Error(formatarFalha({ motivo: semMarca.motivo, destino: resultado.destino }));
        }

        // Só depois da marca: lê as empresas (sem a marca o banco nem é inspecionado).
        const existeEmpresas = (await client.query(`SELECT to_regclass('public.empresas') AS t`)).rows[0].t;
        const empresas = existeEmpresas ? (await client.query('SELECT id, nome FROM empresas ORDER BY id')).rows : [];

        const conteudo = validarConteudoDoBanco({ comentario: marca.rows[0].comentario, empresas });
        if (!conteudo.ok) {
            throw new Error(formatarFalha({ motivo: conteudo.motivo, destino: resultado.destino }));
        }
    } finally {
        await client.end().catch(() => {});
    }
};

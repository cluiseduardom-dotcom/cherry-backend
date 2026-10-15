'use strict';

// Roda em cada worker, ANTES de qualquer require de src/config/db.js.
// Defesa em profundidade: revalida a TEST_DATABASE_URL (o globalSetup já o fez) e só
// então aponta o pool da aplicação para ela. O DATABASE_URL habitual nunca é usado,
// e o dotenv é um stub (o .env não é lido).

const { validarBancoDeTeste, lerUrlsCompartilhadas, formatarFalha } = require('../seguranca/validarBancoDeTeste');

const resultado = validarBancoDeTeste({
    testUrl: process.env.TEST_DATABASE_URL,
    env: process.env,
    urlsCompartilhadas: lerUrlsCompartilhadas({ env: process.env }),
});

if (!resultado.ok) {
    throw new Error(formatarFalha(resultado));
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_MIGRATION_URL = '';
process.env.TESTE_DE_INTEGRACAO = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

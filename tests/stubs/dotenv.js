'use strict';

// Substitui o pacote `dotenv` DENTRO do Jest (moduleNameMapper em jest.config.js).
//
// Por que: src/config/db.js e src/database/migrate.js fazem
// `require('dotenv').config()` ao serem importados. Com o dotenv de verdade, qualquer
// teste que os importasse carregaria o .env habitual do desenvolvedor, trazendo o
// DATABASE_URL do banco compartilhado (dev/produção) para dentro do teste.
//
// Aqui o .env NUNCA é lido: `config()` não faz nada. A conexão dos testes vem só do
// que os setups do Jest definem (banco bloqueado nos unitários; TEST_DATABASE_URL
// validada nos de integração).

module.exports = {
    config: () => ({ parsed: {} }),
    parse: () => ({}),
    populate: () => {},
};

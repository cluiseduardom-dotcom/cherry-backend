'use strict';

// Testes UNITÁRIOS não têm banco. Este setup troca a conexão por um destino que
// recusa na hora (127.0.0.1:1, sem nada escutando): se algum teste unitário tentar
// falar com o banco, falha com ECONNREFUSED em vez de gravar num banco compartilhado.
//
// O dotenv é substituído por um stub (jest.config.js), então o .env habitual também
// não consegue repor o DATABASE_URL real depois deste setup.

process.env.DATABASE_URL = 'postgresql://testes_unitarios:sem-banco@127.0.0.1:1/testes_unitarios_sem_banco';
process.env.DATABASE_MIGRATION_URL = '';
delete process.env.TEST_DATABASE_URL;
delete process.env.TESTE_DE_INTEGRACAO;

'use strict';

// Segunda camada de proteção dos testes de integração: depois de a URL ter passado no guard
// de nome/host (validarBancoDeTeste.js), olha o CONTEÚDO do banco antes de qualquer escrita.
// Um nome como "cherry_test" não prova que o banco é descartável; estas duas checagens provam:
//
//  B. Marca de banco descartável: o banco precisa ter sido declarado, de propósito, como de
//     testes (COMMENT ON DATABASE ... 'cherry-test-disposable'). Sem a marca, aborta.
//  A. Guarda de conteúdo: as únicas empresas permitidas são as criadas por testes (nome
//     "Teste…"/"Empresa Teste…", inclusive resíduos de execuções anteriores) e a empresa do seed
//     de CI. Qualquer outra empresa indica dados reais e aborta.
//
// Este módulo é PURO (recebe os dados já lidos). A leitura (somente SELECT) fica no globalSetup.

const MARCA_BANCO_DESCARTAVEL = 'cherry-test-disposable';

// Mesma regra do helper de limpeza: só estes nomes são "empresa de teste".
const NOME_DE_EMPRESA_DE_TESTE = /^(Teste|Empresa Teste)\b/;

// Única empresa não-teste tolerada: a do seed de CI (src/database/seed.js), no máximo uma.
const NOME_EMPRESA_DO_SEED = 'Cherry Semijoias';

function avaliarMarca(comentario) {
    if (comentario === MARCA_BANCO_DESCARTAVEL) return { ok: true };

    return {
        ok: false,
        motivo:
            'O banco não está marcado como descartável de testes. Se ele realmente é um banco só de testes, ' +
            'marque-o uma vez com: node tests/integration/marcarBancoDescartavel.js (usa TEST_DATABASE_URL). ' +
            'Nunca marque um banco compartilhado ou com dados reais.',
    };
}

function avaliarEmpresas(empresas) {
    const estranhas = [];
    let seeds = 0;

    for (const { id, nome } of empresas) {
        const n = typeof nome === 'string' ? nome : '';

        if (NOME_DE_EMPRESA_DE_TESTE.test(n)) continue;

        if (n === NOME_EMPRESA_DO_SEED && seeds === 0) {
            seeds += 1;
            continue;
        }

        estranhas.push(id);
    }

    if (estranhas.length === 0) return { ok: true };

    // Só ids e contagem: nomes de empresas reais não vão para logs.
    return {
        ok: false,
        motivo:
            `O banco contém ${estranhas.length} empresa(s) que não são de teste nem do seed de CI (ids: ${estranhas.slice(0, 10).join(', ')}` +
            `${estranhas.length > 10 ? ', …' : ''}). Isso indica dados reais; os testes de integração não vão escrever aqui.`,
    };
}

/**
 * @param {object} p
 * @param {string|null} p.comentario  COMMENT ON DATABASE do banco (null se não houver)
 * @param {{id:number,nome:string}[]} p.empresas  linhas de "empresas" ([] se a tabela não existe)
 */
function validarConteudoDoBanco({ comentario, empresas = [] } = {}) {
    const marca = avaliarMarca(comentario);
    if (!marca.ok) return marca;

    return avaliarEmpresas(empresas);
}

module.exports = {
    MARCA_BANCO_DESCARTAVEL,
    NOME_DE_EMPRESA_DE_TESTE,
    NOME_EMPRESA_DO_SEED,
    avaliarMarca,
    avaliarEmpresas,
    validarConteudoDoBanco,
};

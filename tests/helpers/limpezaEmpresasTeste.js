'use strict';

// Limpeza segura das empresas criadas pelas suítes de INTEGRAÇÃO.
//
// Problema que isto resolve: várias suítes só guardavam o id da empresa de teste NO
// FIM da preparação (`empresas[rotulo] = {...}`). Se a preparação falhasse no meio
// (login, criação de produto, preço...), o afterAll percorria uma lista vazia e a
// empresa, o usuário e os produtos ficavam para sempre no banco.
//
// Uso:  const registro = criarRegistroDeEmpresas(db);
//       const id = registro.registrar((await db.query('INSERT ... RETURNING id')).rows[0].id); // logo após inserir
//       afterAll: await registro.limpar();   // remove tudo o que foi registrado, mesmo se a preparação falhou

// Só remove empresas com nome de teste. Uma empresa real nunca é apagada por aqui,
// mesmo que um id errado seja registrado por engano.
const NOME_DE_EMPRESA_DE_TESTE = /^(Teste|Empresa Teste)\b/;

const FK_VIOLADA = '23503';

async function removerEmpresaDeTeste(db, empresaId) {
    const id = Number(empresaId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`empresaId inválido para limpeza: ${empresaId}`);
    }

    const cliente = await db.connect();

    try {
        const empresa = await cliente.query('SELECT nome FROM empresas WHERE id = $1', [id]);
        if (empresa.rows.length === 0) return { removida: false };

        if (!NOME_DE_EMPRESA_DE_TESTE.test(empresa.rows[0].nome)) {
            throw new Error(`limpeza recusada: a empresa ${id} não tem nome de empresa de teste`);
        }

        await cliente.query('BEGIN');

        try {
            // Descobre as tabelas de negócio pelo schema (sempre atualizado) em vez de uma
            // lista fixa. A ordem das FKs é resolvida por tentativas: o que falha por FK
            // (23503) volta para a fila e é repetido depois que os filhos saíram.
            const { rows } = await cliente.query(
                `SELECT DISTINCT table_name
                   FROM information_schema.columns
                  WHERE table_schema = 'public' AND column_name = 'empresa_id' AND table_name <> 'empresas'`
            );

            let pendentes = rows.map((r) => r.table_name);

            while (pendentes.length > 0) {
                const restantes = [];

                for (const tabela of pendentes) {
                    await cliente.query('SAVEPOINT limpeza_tabela');
                    try {
                        await cliente.query(`DELETE FROM "${tabela}" WHERE empresa_id = $1`, [id]);
                        await cliente.query('RELEASE SAVEPOINT limpeza_tabela');
                    } catch (erro) {
                        await cliente.query('ROLLBACK TO SAVEPOINT limpeza_tabela');
                        if (erro.code !== FK_VIOLADA) throw erro;
                        restantes.push(tabela);
                    }
                }

                if (restantes.length === pendentes.length) {
                    throw new Error(`limpeza da empresa ${id} travada por chave estrangeira em: ${restantes.join(', ')}`);
                }

                pendentes = restantes;
            }

            await cliente.query('DELETE FROM empresas WHERE id = $1', [id]);
            await cliente.query('COMMIT');
            return { removida: true };
        } catch (erro) {
            await cliente.query('ROLLBACK');
            throw erro;
        }
    } finally {
        cliente.release();
    }
}

// Rede de segurança por nome (ex.: o sufixo aleatório da execução): pega empresas de
// teste que chegaram a ser inseridas mas não foram registradas.
async function removerEmpresasPorNome(db, padraoLike) {
    const { rows } = await db.query(
        `SELECT id FROM empresas WHERE nome LIKE $1 AND (nome LIKE 'Teste%' OR nome LIKE 'Empresa Teste%')`,
        [padraoLike]
    );

    for (const { id } of rows) {
        await removerEmpresaDeTeste(db, id);
    }

    return rows.length;
}

function criarRegistroDeEmpresas(db) {
    const ids = [];

    return {
        registrar(id) {
            ids.push(Number(id));
            return id;
        },

        ids() {
            return [...ids];
        },

        // Tenta limpar TODAS, mesmo que alguma falhe, e só então reporta os erros.
        async limpar() {
            const erros = [];

            for (const id of [...ids].reverse()) {
                try {
                    await removerEmpresaDeTeste(db, id);
                } catch (erro) {
                    erros.push(erro);
                }
            }

            ids.length = 0;

            if (erros.length > 0) {
                throw new AggregateError(erros, `falha ao limpar empresas de teste: ${erros.map((e) => e.message).join(' | ')}`);
            }
        },
    };
}

module.exports = {
    NOME_DE_EMPRESA_DE_TESTE,
    criarRegistroDeEmpresas,
    removerEmpresaDeTeste,
    removerEmpresasPorNome,
};

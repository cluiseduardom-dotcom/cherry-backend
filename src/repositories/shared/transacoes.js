const db = require('../../config/db');
const AppError = require('../../errors/AppError');

// Lock de linha (FOR UPDATE) dentro de uma transação, escondendo a cerimônia
// de BEGIN/COMMIT/ROLLBACK/release atrás de uma callback: quem chama recebe a
// linha travada (ou null, se não existir) e o client já dentro da transação,
// e decide o que fazer com isso — checar status, rodar efeitos colaterais,
// escrever, ou devolver algo sem escrever nada (no-op). Se a callback lança,
// roda ROLLBACK; se resolve (mesmo devolvendo null), roda COMMIT.
//
// clienteExterno permite participar da transação de quem chama (mesmo
// espírito de estoqueRepository.criarMovimentacao e
// contasReceberRepository.criar): quando informado, pula
// BEGIN/COMMIT/ROLLBACK/release — quem abriu a transação é quem fecha.
async function executarComLock(tabela, { coluna, valor }, empresa_id, clienteExterno, callback) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT * FROM ${tabela} WHERE ${coluna} = $1 AND empresa_id = $2 FOR UPDATE`,
            [valor, empresa_id]
        );

        const linha = rows.length ? rows[0] : null;
        const resultado = await callback(linha, client);

        if (gerenciaTransacao) await client.query('COMMIT');

        return resultado;

    } catch (error) {
        if (gerenciaTransacao) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (gerenciaTransacao) client.release();
    }
}

// Wrapper fino sobre executarComLock pro caso uniforme: existe só se `id`
// bater com `statusEsperado`, senão lança 404/409; escreve `sets` (SQL fixo,
// sem placeholders — quem chama monta a string) e devolve a linha atualizada.
// Casos com ramificação irregular (no-op silencioso, efeitos colaterais entre
// o lock e a escrita) não passam por aqui — chamam executarComLock direto.
async function transicionarStatus(tabela, id, empresa_id, { statusEsperado, mensagemNaoEncontrado, mensagemStatusInvalido, sets }, clienteExterno) {
    return executarComLock(tabela, { coluna: 'id', valor: id }, empresa_id, clienteExterno, async (linha, client) => {
        if (!linha) {
            throw new AppError(mensagemNaoEncontrado, 404);
        }

        if (linha.status !== statusEsperado) {
            throw new AppError(mensagemStatusInvalido, 409);
        }

        const { rows } = await client.query(
            `UPDATE ${tabela} SET ${sets}, atualizado_em = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );

        return rows[0];
    });
}

module.exports = {
    executarComLock,
    transicionarStatus
};

const db = require('../config/db');

// A listagem filtra só deletado_em IS NULL (não ativo = true): precisa
// mostrar despesas desligadas pelo toggle também, senão a tela de gestão
// não teria como reativá-las.
async function listar(empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM despesas_fixas
         WHERE empresa_id = $1 AND deletado_em IS NULL
         ORDER BY categoria ASC, descricao ASC`,
        [empresa_id]
    );
    return rows;
}

async function criar({ categoria, descricao, valor, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO despesas_fixas (categoria, descricao, valor, empresa_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [categoria, descricao, valor, empresa_id]
    );
    return rows[0];
}

// UPDATE ... RETURNING é atômico numa única query: dispensa a transação com
// FOR UPDATE usada em contas_pagar, porque aqui não há máquina de estados
// (status pendente/pago) com uma janela de corrida a proteger — só um campo
// sendo sobrescrito de uma vez.
async function atualizar(id, dados, empresa_id) {
    const campos = ['categoria', 'descricao', 'valor'];
    const sets = ['atualizado_em = NOW()'];
    const valores = [];
    let i = 1;

    for (const campo of campos) {
        if (dados[campo] !== undefined) {
            sets.push(`${campo} = $${i}`);
            valores.push(dados[campo]);
            i++;
        }
    }

    valores.push(id, empresa_id);

    const { rows } = await db.query(
        `UPDATE despesas_fixas SET ${sets.join(', ')}
         WHERE id = $${i} AND empresa_id = $${i + 1} AND deletado_em IS NULL
         RETURNING *`,
        valores
    );

    return rows.length ? rows[0] : null;
}

async function deletar(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE despesas_fixas SET deletado_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL
         RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function alternarAtivo(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE despesas_fixas SET ativo = NOT ativo, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL
         RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function somarAtivas(empresa_id) {
    const { rows } = await db.query(
        `SELECT COALESCE(SUM(valor), 0) AS total FROM despesas_fixas
         WHERE empresa_id = $1 AND ativo = true AND deletado_em IS NULL`,
        [empresa_id]
    );
    return rows[0].total;
}

module.exports = {
    listar,
    criar,
    atualizar,
    deletar,
    alternarAtivo,
    somarAtivas
};

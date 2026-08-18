const db = require('../config/db');

async function listarPaginado({ limit, offset, nome, empresa_id }) {
    const condicoes = ['empresa_id = $1'];
    const valores = [empresa_id];

    if (nome !== undefined) {
        valores.push(`%${nome}%`);
        condicoes.push(`nome ILIKE $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT * FROM fornecedores
         ${where}
         ORDER BY nome ASC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM fornecedores ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        'SELECT * FROM fornecedores WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

async function criar({ nome, contato, telefone, email, cnpj_cpf, observacoes, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO fornecedores (nome, contato, telefone, email, cnpj_cpf, observacoes, empresa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
            nome,
            contato ?? null,
            telefone ?? null,
            email ?? null,
            cnpj_cpf ?? null,
            observacoes ?? null,
            empresa_id
        ]
    );

    return rows[0];
}

async function atualizar(id, dados, empresa_id) {
    const campos = ['nome', 'contato', 'telefone', 'email', 'cnpj_cpf', 'observacoes', 'ativo'];

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
        `UPDATE fornecedores SET ${sets.join(', ')} WHERE id = $${i} AND empresa_id = $${i + 1} RETURNING *`,
        valores
    );

    return rows.length ? rows[0] : null;
}

async function desativar(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE fornecedores SET ativo = false, atualizado_em = NOW() WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

module.exports = {
    listarPaginado,
    buscarPorId,
    criar,
    atualizar,
    desativar
};

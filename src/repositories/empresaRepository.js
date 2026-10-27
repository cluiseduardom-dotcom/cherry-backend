const db = require('../config/db');

const CAMPOS = ['nome', 'razao_social', 'cnpj', 'telefone', 'email_contato', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
const SELECT = `SELECT id, ${CAMPOS.join(', ')}, atualizado_em FROM empresas`;

async function obterDados(empresa_id) {
    const { rows } = await db.query(`${SELECT} WHERE id = $1`, [empresa_id]);

    return rows[0] ?? null;
}

// Atualização parcial: só as colunas da lista fechada CAMPOS entram no SQL (nomes nunca vêm do cliente).
async function atualizarDados(empresa_id, dados, usuario_id) {
    const colunas = CAMPOS.filter((c) => dados[c] !== undefined);
    const sets = colunas.map((c, i) => `${c} = $${i + 3}`);

    const { rows } = await db.query(
        `UPDATE empresas SET ${sets.join(', ')}, atualizado_em = NOW(), atualizado_por = $2
         WHERE id = $1
         RETURNING id, ${CAMPOS.join(', ')}, atualizado_em`,
        [empresa_id, usuario_id, ...colunas.map((c) => dados[c])]
    );

    return rows[0] ?? null;
}

module.exports = { obterDados, atualizarDados };

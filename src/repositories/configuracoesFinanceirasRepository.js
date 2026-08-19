const db = require('../config/db');

// Upsert de uma linha só por empresa numa única query atômica (INSERT ...
// ON CONFLICT DO UPDATE ... RETURNING): evita a corrida de um SELECT seguido
// de INSERT quando duas requisições concorrentes pedem a config pela
// primeira vez (ex: dois admins abrindo a tela de despesas fixas ao mesmo
// tempo, antes de qualquer configuração existir).
async function obterOuCriar(empresa_id) {
    const { rows } = await db.query(
        `INSERT INTO configuracoes_financeiras (empresa_id)
         VALUES ($1)
         ON CONFLICT (empresa_id) DO UPDATE SET empresa_id = configuracoes_financeiras.empresa_id
         RETURNING *`,
        [empresa_id]
    );

    return rows[0];
}

async function atualizar(empresa_id, aliquota_imposto) {
    const { rows } = await db.query(
        `INSERT INTO configuracoes_financeiras (empresa_id, aliquota_imposto)
         VALUES ($1, $2)
         ON CONFLICT (empresa_id) DO UPDATE SET aliquota_imposto = $2, atualizado_em = NOW()
         RETURNING *`,
        [empresa_id, aliquota_imposto]
    );

    return rows[0];
}

module.exports = {
    obterOuCriar,
    atualizar
};

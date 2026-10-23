// Operações do painel interno da GiroOne (plataforma, não tenant): por isso não filtram por
// empresa_id do JWT — a empresa alvo é sempre um parâmetro explícito e validado. Estas
// funções só são alcançáveis pelas rotas /interno, protegidas por segredo de servidor.

async function listarEmpresas(db) {
    const { rows } = await db.query(
        `SELECT e.id, e.nome, e.status, e.tema_visual,
                COALESCE(array_agg(m.modulo ORDER BY m.modulo) FILTER (WHERE m.ativo), '{}') AS modulos
         FROM empresas e
         LEFT JOIN empresa_modulos m ON m.empresa_id = e.id
         GROUP BY e.id
         ORDER BY e.id`
    );

    return rows;
}

async function atualizarTema(db, empresa_id, tema) {
    const { rows } = await db.query(
        `UPDATE empresas SET tema_visual = $2
         WHERE id = $1
         RETURNING id, nome, tema_visual`,
        [empresa_id, tema]
    );

    return rows[0] || null;
}

async function empresaExiste(client, empresa_id) {
    const { rows } = await client.query('SELECT 1 FROM empresas WHERE id = $1', [empresa_id]);

    return rows.length > 0;
}

async function gravarModulo(client, { empresa_id, modulo, ativo, justificativa, responsavel }) {
    const { rows } = await client.query(
        `INSERT INTO empresa_modulos (empresa_id, modulo, ativo, justificativa, responsavel)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (empresa_id, modulo) DO UPDATE
            SET ativo = EXCLUDED.ativo,
                justificativa = EXCLUDED.justificativa,
                responsavel = EXCLUDED.responsavel,
                atualizado_em = NOW()
         RETURNING empresa_id, modulo, ativo`,
        [empresa_id, modulo, ativo, justificativa, responsavel]
    );

    return rows[0];
}

async function registrarHistoricoModulo(client, { empresa_id, modulo, ativo, justificativa, responsavel }) {
    await client.query(
        `INSERT INTO empresa_modulos_historico (empresa_id, modulo, ativo, justificativa, responsavel)
         VALUES ($1, $2, $3, $4, $5)`,
        [empresa_id, modulo, ativo, justificativa, responsavel]
    );
}

module.exports = { listarEmpresas, atualizarTema, empresaExiste, gravarModulo, registrarHistoricoModulo };

const AppError = require('../errors/AppError');

const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

// Mesma resolução de plano de sessaoRepository (plano vigente; sem plano vale `sem_mensalidade`).
async function buscarLimite(client, empresa_id) {
    const { rows } = await client.query(
        `SELECT p.codigo AS plano, p.limite_usuarios AS limite_plano,
                COALESCE(l.ilimitado, false) AS ilimitado,
                COALESCE(l.usuarios_extras, 0) AS usuarios_extras
         FROM planos_comerciais p
         LEFT JOIN empresa_limites_usuarios l ON l.empresa_id = $1
         WHERE p.id = COALESCE(
             (SELECT ep.plano_id FROM empresa_planos ep
              WHERE ep.empresa_id = $1 AND ep.ativo = true
                AND ep.vigencia_inicio <= ${HOJE_SQL}
                AND (ep.vigencia_fim IS NULL OR ep.vigencia_fim >= ${HOJE_SQL})
              ORDER BY ep.vigencia_inicio DESC, ep.id DESC LIMIT 1),
             (SELECT id FROM planos_comerciais WHERE codigo = 'sem_mensalidade'))`,
        [empresa_id]
    );

    if (!rows.length) {
        // Sem plano padrão cadastrado é configuração quebrada: nega em vez de liberar sem limite.
        throw new AppError('Plano da empresa não encontrado', 500);
    }

    const { plano, limite_plano, ilimitado, usuarios_extras } = rows[0];
    const limite = ilimitado || limite_plano === null ? null : limite_plano + usuarios_extras;

    return { plano, limite };
}

// Garante vaga para mais um usuário ATIVO. Deve rodar dentro de uma transação: trava a linha da empresa
// (serializa criações e desbloqueios concorrentes da mesma empresa) e conta os ativos sob essa trava.
async function garantirVaga(client, empresa_id) {
    await client.query('SELECT id FROM empresas WHERE id = $1 FOR UPDATE', [empresa_id]);

    const { limite } = await buscarLimite(client, empresa_id);

    if (limite === null) return;

    const { rows } = await client.query(
        'SELECT COUNT(*)::int AS ativos FROM usuarios WHERE empresa_id = $1 AND ativo = true',
        [empresa_id]
    );

    if (rows[0].ativos >= limite) {
        throw new AppError(`Limite de ${limite} usuários ativos do seu plano atingido. Fale com a GiroNex para ampliar.`, 409);
    }
}

module.exports = { buscarLimite, garantirVaga };

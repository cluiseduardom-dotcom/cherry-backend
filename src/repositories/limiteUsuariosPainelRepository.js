const db = require('../config/db');
const AppError = require('../errors/AppError');
const painelRepository = require('./painelRepository');
const limiteUsuariosRepository = require('./limiteUsuariosRepository');

// Limite de usuários por empresa, operado só pelo Painel GiroNex (a empresa-alvo vem da rota). O limite do
// PLANO só muda por migration. Cada mudança grava a trilha (plataforma_eventos) na MESMA transação.

async function exigirEmpresa(client, empresa_id) {
    const { rows } = await client.query('SELECT id FROM empresas WHERE id = $1 FOR UPDATE', [empresa_id]);

    if (!rows.length) throw new AppError('Empresa não encontrada', 404);
}

async function situacao(client, empresa_id) {
    const { plano, limite } = await limiteUsuariosRepository.buscarLimite(client, empresa_id);

    const { rows: planoRows } = await client.query(
        `SELECT limite_usuarios FROM planos_comerciais WHERE codigo = $1`, [plano]
    );
    const { rows: ativos } = await client.query(
        'SELECT COUNT(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND ativo = true', [empresa_id]
    );
    const { rows: conf } = await client.query(
        `SELECT usuarios_extras, ilimitado, justificativa, responsavel, atualizado_em
         FROM empresa_limites_usuarios WHERE empresa_id = $1`, [empresa_id]
    );

    return {
        plano,
        limite_plano: planoRows[0].limite_usuarios,
        limite_efetivo: limite,
        usuarios_ativos: ativos[0].n,
        configuracao: conf[0] ?? null
    };
}

async function obter(empresa_id) {
    const client = await db.connect();

    try {
        const { rows } = await client.query('SELECT id FROM empresas WHERE id = $1', [empresa_id]);

        if (!rows.length) throw new AppError('Empresa não encontrada', 404);

        return await situacao(client, empresa_id);
    } finally {
        client.release();
    }
}

async function emTransacao(empresa_id, fn) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await exigirEmpresa(client, empresa_id);
        const resultado = await fn(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// Uma linha por empresa; a trilha guarda o histórico. Reduzir abaixo dos ativos não derruba ninguém:
// só impede entrada de usuário novo (regra do limite).
async function definir({ empresa_id, usuarios_extras, ilimitado, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const antes = await situacao(client, empresa_id);

        await client.query(
            `INSERT INTO empresa_limites_usuarios (empresa_id, usuarios_extras, ilimitado, justificativa, responsavel)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (empresa_id) DO UPDATE
                SET usuarios_extras = EXCLUDED.usuarios_extras, ilimitado = EXCLUDED.ilimitado,
                    justificativa = EXCLUDED.justificativa, responsavel = EXCLUDED.responsavel, atualizado_em = NOW()`,
            [empresa_id, usuarios_extras, ilimitado, justificativa, responsavel]
        );

        const depois = await situacao(client, empresa_id);

        await painelRepository.registrarEvento({
            operador_id,
            acao: 'limite_usuarios_definido',
            alvo_empresa_id: empresa_id,
            detalhe: {
                usuarios_extras, ilimitado, justificativa, responsavel,
                limite_antes: antes.limite_efetivo, limite_depois: depois.limite_efetivo
            },
            ip
        }, client);

        return depois;
    });
}

async function remover({ empresa_id, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const antes = await situacao(client, empresa_id);

        const { rowCount } = await client.query('DELETE FROM empresa_limites_usuarios WHERE empresa_id = $1', [empresa_id]);

        if (rowCount === 0) throw new AppError('Não há configuração de limite por empresa para remover.', 404);

        const depois = await situacao(client, empresa_id);

        await painelRepository.registrarEvento({
            operador_id,
            acao: 'limite_usuarios_removido',
            alvo_empresa_id: empresa_id,
            detalhe: { justificativa, responsavel, limite_antes: antes.limite_efetivo, limite_depois: depois.limite_efetivo },
            ip
        }, client);

        return depois;
    });
}

module.exports = { obter, definir, remover };

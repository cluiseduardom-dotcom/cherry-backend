const db = require('../config/db');
const AppError = require('../errors/AppError');

// Toda consulta filtra por empresa_id (do token), nunca por um id vindo do cliente.

async function listarPorEmpresa(empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT cargo, nivel, ativo, capacidades
         FROM cargos_empresa
         WHERE empresa_id = $1`,
        [empresa_id]
    );

    return rows;
}

async function buscar(empresa_id, cargo, client = db) {
    const { rows } = await client.query(
        `SELECT cargo, nivel, ativo, capacidades
         FROM cargos_empresa
         WHERE empresa_id = $1 AND cargo = $2`,
        [empresa_id, cargo]
    );

    return rows.length ? rows[0] : null;
}

async function contarUsuariosAtivos(empresa_id, cargo, client = db) {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM usuarios
         WHERE empresa_id = $1 AND papel = $2 AND ativo = true`,
        [empresa_id, cargo]
    );

    return rows[0].total;
}

// A linha gravada é a verdade inteira do cargo no comércio (ver migration 050).
async function salvar({ empresa_id, cargo, nivel, ativo, capacidades, usuario_id }, client = db) {
    const { rows } = await client.query(
        `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades, atualizado_por, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (empresa_id, cargo) DO UPDATE
            SET nivel = EXCLUDED.nivel,
                ativo = EXCLUDED.ativo,
                capacidades = EXCLUDED.capacidades,
                atualizado_por = EXCLUDED.atualizado_por,
                atualizado_em = NOW()
         RETURNING cargo, nivel, ativo, capacidades`,
        [empresa_id, cargo, nivel, ativo, capacidades, usuario_id]
    );

    return rows[0];
}

// Serializa, dentro da transação do chamador, tudo o que decide se um cargo está em uso:
// criar usuário nele e desligar o cargo. Sem isto, as duas operações se cruzam (o desligar conta
// 0 usuários e só grava depois do usuário novo ser criado) e sobra gente ativa em cargo
// desligado, sem conseguir entrar. Trava por (empresa, cargo), existindo ou não linha em
// cargos_empresa (cargo padrão ainda não tem linha). Liberada no COMMIT/ROLLBACK.
async function travarCargo(client, empresa_id, cargo) {
    await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [`cargo:${empresa_id}:${cargo}`]
    );
}

// Grava o cargo; se `bloquearSeEmUso`, recusa (409) quando ainda há usuário ativo nele,
// contando com a trava de cargo e na MESMA transação da gravação.
async function salvarComTravaDeUso(dados, { bloquearSeEmUso = false } = {}) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await travarCargo(client, dados.empresa_id, dados.cargo);

        if (bloquearSeEmUso) {
            const emUso = await contarUsuariosAtivos(dados.empresa_id, dados.cargo, client);

            if (emUso > 0) {
                throw new AppError(`Há ${emUso} usuário(s) ativo(s) neste cargo; mude o cargo deles antes de desativar`, 409);
            }
        }

        const salvo = await salvar(dados, client);

        await client.query('COMMIT');

        return salvo;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { listarPorEmpresa, buscar, contarUsuariosAtivos, salvar, travarCargo, salvarComTravaDeUso };

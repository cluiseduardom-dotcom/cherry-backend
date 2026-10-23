const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

// Colunas que o service precisa para resolver o cargo EFETIVO de cada usuário (cargo do
// catálogo + linha de cargos_empresa + admin concedido), as mesmas que sessaoRepository usa.
// Filtra SEMPRE por empresa_id. Nunca devolve a senha.
const COLUNAS_COM_CARGO = `
    u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em,
    (c.empresa_id IS NOT NULL) AS cargo_configurado,
    c.nivel AS cargo_nivel, c.ativo AS cargo_ativo, c.capacidades AS cargo_capacidades,
    EXISTS (
        SELECT 1 FROM usuario_privilegios p
        WHERE p.empresa_id = u.empresa_id AND p.usuario_id = u.id
          AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
    ) AS administrador_concedido`;

const JOIN_CARGO = `
    LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel`;

async function listarPorEmpresa(empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS_COM_CARGO}
         FROM usuarios u
         ${JOIN_CARGO}
         WHERE u.empresa_id = $1
         ORDER BY u.nome ASC, u.id ASC`,
        [empresa_id]
    );

    return rows;
}

// Cria o usuário e grava o evento na MESMA transação: sem trilha, não há usuário.
// O e-mail é único no banco inteiro; a corrida entre duas criações vira 409, não 500.
async function criarComAuditoria({ nome, email, senhaHash, papel, empresa_id, executado_por, motivo }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO usuarios (nome, email, senha, papel, empresa_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, nome, email, papel, empresa_id, ativo`,
            [nome, email, senhaHash, papel, empresa_id]
        );

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo)
             VALUES ($1, 'criar', $2, $3, $4, $5)`,
            [empresa_id, rows[0].id, papel, executado_por, motivo ?? null]
        );

        await client.query('COMMIT');

        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');

        if (error && error.code === '23505') {
            throw new AppError('Email já cadastrado', 409);
        }

        throw error;
    } finally {
        client.release();
    }
}

// Bloqueia/desbloqueia com a linha do usuário TRAVADA (FOR UPDATE, filtrada por empresa_id):
// a checagem de hierarquia e a escrita acontecem sobre o mesmo estado, sem corrida.
// `autorizar(alvo)` recebe o usuário já com o cargo efetivo e lança erro se o ator não puder.
// Bloqueio sobe token_version: todas as sessões já emitidas caem na próxima requisição.
// Repetir o mesmo estado é no-op (sem novo evento).
async function alterarBloqueio({ empresa_id, usuario_id, bloqueado, motivo, executado_por, autorizar }) {
    return executarComLock('usuarios', { coluna: 'id', valor: usuario_id }, empresa_id, undefined, async (linha, client) => {
        if (!linha) {
            throw new AppError('Usuário não encontrado', 404);
        }

        const { rows } = await client.query(
            `SELECT ${COLUNAS_COM_CARGO}
             FROM usuarios u
             ${JOIN_CARGO}
             WHERE u.id = $1 AND u.empresa_id = $2`,
            [usuario_id, empresa_id]
        );

        const alvo = rows[0];

        autorizar(alvo);

        const ativoDesejado = !bloqueado;

        if (alvo.ativo === ativoDesejado) {
            return { id: alvo.id, nome: alvo.nome, email: alvo.email, papel: alvo.papel, ativo: alvo.ativo, alterado: false };
        }

        const { rows: atualizados } = await client.query(
            bloqueado
                ? `UPDATE usuarios SET ativo = false, token_version = token_version + 1
                   WHERE id = $1 AND empresa_id = $2
                   RETURNING id, nome, email, papel, ativo`
                : `UPDATE usuarios SET ativo = true
                   WHERE id = $1 AND empresa_id = $2
                   RETURNING id, nome, email, papel, ativo`,
            [usuario_id, empresa_id]
        );

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [empresa_id, bloqueado ? 'bloquear' : 'desbloquear', usuario_id, alvo.papel, executado_por, motivo]
        );

        return { ...atualizados[0], alterado: true };
    });
}

async function listarEventos({ empresa_id, limit, offset }) {
    const { rows } = await db.query(
        `SELECT e.id, e.acao, e.alvo_usuario_id, alvo.nome AS alvo_nome, e.cargo_alvo,
                e.executado_por, autor.nome AS executado_por_nome, e.motivo, e.criado_em
         FROM usuarios_eventos e
         JOIN usuarios alvo ON alvo.id = e.alvo_usuario_id AND alvo.empresa_id = e.empresa_id
         JOIN usuarios autor ON autor.id = e.executado_por AND autor.empresa_id = e.empresa_id
         WHERE e.empresa_id = $1
         ORDER BY e.criado_em DESC, e.id DESC
         LIMIT $2 OFFSET $3`,
        [empresa_id, limit, offset]
    );

    const { rows: totalRows } = await db.query(
        `SELECT COUNT(*) AS total FROM usuarios_eventos WHERE empresa_id = $1`,
        [empresa_id]
    );

    return { items: rows, total: Number(totalRows[0].total) };
}

module.exports = {
    listarPorEmpresa,
    criarComAuditoria,
    alterarBloqueio,
    listarEventos
};

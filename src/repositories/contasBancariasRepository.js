const db = require('../config/db');

const TZ = 'America/Sao_Paulo';

// Saldo = saldo inicial + movimentos ATIVOS (não cancelados) já realizados a partir da data do saldo inicial.
// "Realizado" é comparado por DIA de Brasília (dia do movimento <= hoje), não por horário: o lançamento manual
// e o de extrato são gravados ao meio-dia, e comparar o instante faria o lançamento de hoje virar "a liberar"
// até o meio-dia. Movimento de dia futuro (ex.: liberação de cartão do Mercado Pago) não entra no saldo atual:
// aparece em `a_liberar`. Nunca soma movimento cancelado.
const SQL_CONTA_COM_SALDO = `
    SELECT c.*,
           c.saldo_inicial + COALESCE(m.entradas, 0) - COALESCE(m.saidas, 0) AS saldo_atual,
           COALESCE(m.entradas_futuras, 0) - COALESCE(m.saidas_futuras, 0) AS a_liberar,
           COALESCE(m.movimentos, 0)::int AS movimentos
      FROM contas_bancarias c
      LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN mv.tipo = 'ENTRADA' AND (mv.data_movimento AT TIME ZONE '${TZ}')::date <= (NOW() AT TIME ZONE '${TZ}')::date THEN mv.valor END) AS entradas,
                   SUM(CASE WHEN mv.tipo = 'SAIDA'   AND (mv.data_movimento AT TIME ZONE '${TZ}')::date <= (NOW() AT TIME ZONE '${TZ}')::date THEN mv.valor END) AS saidas,
                   SUM(CASE WHEN mv.tipo = 'ENTRADA' AND (mv.data_movimento AT TIME ZONE '${TZ}')::date >  (NOW() AT TIME ZONE '${TZ}')::date THEN mv.valor END) AS entradas_futuras,
                   SUM(CASE WHEN mv.tipo = 'SAIDA'   AND (mv.data_movimento AT TIME ZONE '${TZ}')::date >  (NOW() AT TIME ZONE '${TZ}')::date THEN mv.valor END) AS saidas_futuras,
                   COUNT(*) AS movimentos
              FROM movimentos_bancarios mv
             WHERE mv.empresa_id = c.empresa_id
               AND mv.conta_bancaria_id = c.id
               AND mv.cancelado_em IS NULL
               AND (c.data_saldo_inicial IS NULL
                    OR (mv.data_movimento AT TIME ZONE '${TZ}')::date >= c.data_saldo_inicial)
      ) m ON TRUE`;

async function criar(dados) {
    const { rows } = await db.query(
        `INSERT INTO contas_bancarias
            (empresa_id, filial_id, nome, tipo, origem, banco_codigo,
             instituicao_nome, agencia, conta, digito, moeda, saldo_inicial,
             data_saldo_inicial, principal, status, provedor, conexao_externa_id,
             conta_externa_id, observacao, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [
            dados.empresa_id, dados.filial_id ?? null, dados.nome, dados.tipo,
            dados.origem ?? 'MANUAL', dados.banco_codigo ?? null,
            dados.instituicao_nome ?? null, dados.agencia ?? null,
            dados.conta ?? null, dados.digito ?? null, dados.moeda ?? 'BRL',
            dados.saldo_inicial ?? 0, dados.data_saldo_inicial ?? null,
            dados.principal ?? false, dados.status ?? 'ATIVA',
            dados.provedor ?? null, dados.conexao_externa_id ?? null,
            dados.conta_externa_id ?? null, dados.observacao ?? null,
            dados.usuario_id ?? null
        ]
    );
    return rows[0];
}

async function buscarPorId(id, empresaId) {
    const { rows } = await db.query(
        'SELECT * FROM contas_bancarias WHERE id = $1 AND empresa_id = $2',
        [id, empresaId]
    );
    return rows[0] || null;
}

async function buscarComSaldo(id, empresaId) {
    const { rows } = await db.query(
        `${SQL_CONTA_COM_SALDO} WHERE c.id = $1 AND c.empresa_id = $2`,
        [id, empresaId]
    );
    return rows[0] || null;
}

function montarFiltros(empresaId, filtros) {
    const params = [empresaId];
    const where = ['c.empresa_id = $1'];

    if (filtros.status) {
        params.push(filtros.status);
        where.push(`c.status = $${params.length}`);
    }
    if (filtros.tipo) {
        params.push(filtros.tipo);
        where.push(`c.tipo = $${params.length}`);
    }
    if (filtros.filial_id != null) {
        params.push(filtros.filial_id);
        where.push(`c.filial_id = $${params.length}`);
    }
    return { params, where };
}

async function listar(empresaId, filtros = {}) {
    const { params, where } = montarFiltros(empresaId, filtros);
    const { rows } = await db.query(
        `SELECT c.* FROM contas_bancarias c
         WHERE ${where.join(' AND ')}
         ORDER BY c.principal DESC, c.nome ASC`,
        params
    );
    return rows;
}

async function listarComSaldo(empresaId, filtros = {}) {
    const { params, where } = montarFiltros(empresaId, filtros);
    const { rows } = await db.query(
        `${SQL_CONTA_COM_SALDO}
         WHERE ${where.join(' AND ')}
         ORDER BY c.principal DESC, c.nome ASC`,
        params
    );
    return rows;
}

async function atualizarStatus(id, empresaId, status) {
    const { rows } = await db.query(
        `UPDATE contas_bancarias
            SET status = $1::varchar,
                principal = CASE WHEN $1::varchar = 'INATIVA' THEN FALSE ELSE principal END,
                updated_at = NOW()
          WHERE id = $2 AND empresa_id = $3
          RETURNING *`,
        [status, id, empresaId]
    );
    return rows[0] || null;
}

const CAMPOS_EDITAVEIS = [
    'nome', 'banco_codigo', 'instituicao_nome', 'agencia', 'conta', 'digito',
    'saldo_inicial', 'data_saldo_inicial', 'observacao'
];

// Atualiza só os campos informados. `principal` troca a conta principal numa transação (índice único parcial:
// uma principal por empresa), sem nunca deixar duas nem apagar a anterior às cegas.
async function atualizar(id, empresaId, campos) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows: atual } = await client.query(
            'SELECT id, status FROM contas_bancarias WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [id, empresaId]
        );
        if (!atual[0]) {
            await client.query('ROLLBACK');
            return null;
        }

        if (campos.principal === true) {
            await client.query(
                `UPDATE contas_bancarias SET principal = FALSE, updated_at = NOW()
                  WHERE empresa_id = $1 AND principal = TRUE AND id <> $2`,
                [empresaId, id]
            );
        }

        const sets = [];
        const params = [];
        for (const campo of CAMPOS_EDITAVEIS) {
            if (Object.prototype.hasOwnProperty.call(campos, campo)) {
                params.push(campos[campo]);
                sets.push(`${campo} = $${params.length}`);
            }
        }
        if (Object.prototype.hasOwnProperty.call(campos, 'principal')) {
            params.push(campos.principal);
            sets.push(`principal = $${params.length}`);
        }
        if (sets.length === 0) {
            await client.query('ROLLBACK');
            return buscarPorId(id, empresaId);
        }

        params.push(id, empresaId);
        const { rows } = await client.query(
            `UPDATE contas_bancarias SET ${sets.join(', ')}, updated_at = NOW()
              WHERE id = $${params.length - 1} AND empresa_id = $${params.length}
              RETURNING *`,
            params
        );
        await client.query('COMMIT');
        return rows[0];
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }
}

async function contarMovimentos(id, empresaId) {
    const { rows } = await db.query(
        'SELECT COUNT(*)::int AS total FROM movimentos_bancarios WHERE conta_bancaria_id = $1 AND empresa_id = $2',
        [id, empresaId]
    );
    return rows[0].total;
}

module.exports = { criar, buscarPorId, buscarComSaldo, listar, listarComSaldo, atualizarStatus, atualizar, contarMovimentos };

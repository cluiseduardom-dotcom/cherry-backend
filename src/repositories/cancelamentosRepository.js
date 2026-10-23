const db = require('../config/db');

// Toda consulta filtra por empresa_id (do token). A tabela é imutável: aqui só existe INSERT e leitura.

async function inserir({
    empresa_id, venda_id, motivo, cancelado_por, cancelado_por_login, autorizado_por, autorizado_por_login,
    faixa_aplicada, dias_da_venda, quantidade_devolvida, valor_devolvido
}, client = db) {
    const { rows } = await client.query(
        `INSERT INTO cancelamentos_venda
            (empresa_id, venda_id, motivo, cancelado_por, cancelado_por_login, autorizado_por, autorizado_por_login,
             faixa_aplicada, dias_da_venda, quantidade_devolvida, valor_devolvido)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, venda_id, motivo, cancelado_por, cancelado_por_login, autorizado_por, autorizado_por_login,
                   faixa_aplicada, dias_da_venda, quantidade_devolvida, valor_devolvido, cancelado_em`,
        [
            empresa_id, venda_id, motivo, cancelado_por, cancelado_por_login, autorizado_por ?? null, autorizado_por_login ?? null,
            faixa_aplicada, dias_da_venda, quantidade_devolvida, valor_devolvido
        ]
    );

    return rows[0];
}

// Idade da venda em dias inteiros de 24 h, pelo relógio do banco (NOW() e vendas.data são
// comparados na mesma base, então não depende do fuso do servidor).
async function buscarIdadeDaVenda(venda_id, empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT usuario_id, status,
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - data)) / 86400))::int AS dias
         FROM vendas
         WHERE id = $1 AND empresa_id = $2`,
        [venda_id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

// Candidato a autorizador: procurado por e-mail DENTRO da empresa do token. Traz a senha (hash) e
// o estado de cargo e de Admin concedido, tudo numa consulta. Nunca é exposto fora do serviço.
async function buscarAutorizador(empresa_id, email, client = db) {
    const { rows } = await client.query(
        `SELECT u.id, u.email, u.senha, u.ativo, u.papel,
                (c.empresa_id IS NOT NULL) AS cargo_configurado,
                c.nivel AS cargo_nivel, c.ativo AS cargo_ativo, c.capacidades AS cargo_capacidades,
                EXISTS (
                    SELECT 1 FROM usuario_privilegios p
                    WHERE p.empresa_id = u.empresa_id AND p.usuario_id = u.id
                      AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
                ) AS administrador_concedido
         FROM usuarios u
         LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel
         WHERE u.empresa_id = $1 AND lower(u.email) = lower($2)`,
        [empresa_id, email]
    );

    return rows.length ? rows[0] : null;
}

async function listarPaginado(empresa_id, { limit, offset, data_de, data_ate, cancelado_por, autorizado_por, faixa, venda_id }) {
    const condicoes = ['c.empresa_id = $1'];
    const params = [empresa_id];

    const adicionar = (sql, valor) => {
        params.push(valor);
        condicoes.push(sql.replace('?', `$${params.length}`));
    };

    // Datas no calendário de São Paulo (as telas do produto são em horário de Brasília).
    if (data_de) adicionar(`(c.cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date >= ?::date`, data_de);
    if (data_ate) adicionar(`(c.cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date <= ?::date`, data_ate);
    if (cancelado_por) adicionar('c.cancelado_por = ?', cancelado_por);
    if (autorizado_por) adicionar('c.autorizado_por = ?', autorizado_por);
    if (faixa) adicionar('c.faixa_aplicada = ?', faixa);
    if (venda_id) adicionar('c.venda_id = ?', venda_id);

    const where = condicoes.join(' AND ');

    const { rows: totalRows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM cancelamentos_venda c WHERE ${where}`,
        params
    );

    const { rows } = await db.query(
        `SELECT c.id, c.venda_id, c.motivo, c.faixa_aplicada, c.dias_da_venda,
                c.quantidade_devolvida, c.valor_devolvido, c.cancelado_em,
                c.cancelado_por, c.cancelado_por_login, uc.nome AS cancelado_por_nome,
                c.autorizado_por, c.autorizado_por_login, ua.nome AS autorizado_por_nome,
                v.total AS venda_total, v.data AS venda_data
         FROM cancelamentos_venda c
         JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         LEFT JOIN usuarios uc ON uc.id = c.cancelado_por AND uc.empresa_id = c.empresa_id
         LEFT JOIN usuarios ua ON ua.id = c.autorizado_por AND ua.empresa_id = c.empresa_id
         WHERE ${where}
         ORDER BY c.cancelado_em DESC, c.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );

    return { items: rows, total: totalRows[0].total };
}

module.exports = { inserir, buscarIdadeDaVenda, buscarAutorizador, listarPaginado };

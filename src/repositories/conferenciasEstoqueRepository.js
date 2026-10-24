const db = require('../config/db');
const AppError = require('../errors/AppError');
const estoqueRepository = require('./estoqueRepository');

async function obterLocal(empresa_id, id) {
    const { rows } = await db.query(
        'SELECT id, tipo, nome, usuario_id, cliente_id, ativo FROM locais_estoque WHERE id = $1 AND empresa_id = $2',
        [id, empresa_id]
    );
    return rows[0] ?? null;
}

// Acerto de um local, reconstruído do histórico de movimentações (a mesma fonte de verdade que
// mantém o saldo). O delta de cada movimentação é o saldo do local depois dela menos o saldo
// anterior do mesmo produto (vale para entrada, saída e ajuste). Categorias:
//   recebido : chegou por transferência aceita (o destino é este local)
//   enviado  : saiu por transferência (origem é este local), líquido de recusa/cancelamento
//   vendido  : saídas de venda, líquido de cancelamento (estorno volta ao mesmo local)
//   ajustes  : contagem/ajuste (movimentação do tipo ajuste)
//   outros   : entradas e saídas manuais
// saldo_inicial = saldo_atual − soma dos deltas do período. Sem `desde`, o período é a vida inteira
// do local e o saldo_inicial tem que ser 0: é a prova de que a conta fecha (`confere`).
async function acerto({ empresa_id, local_id, desde }) {
    const { rows } = await db.query(
        `WITH mov AS (
             SELECT m.id, m.produto_id, m.tipo, m.motivo, m.transferencia_id, m.criado_em,
                    m.saldo_local_resultante
                    - COALESCE(LAG(m.saldo_local_resultante) OVER (PARTITION BY m.produto_id ORDER BY m.id), 0) AS delta
             FROM movimentacoes_estoque m
             WHERE m.empresa_id = $1 AND m.local_id = $2
         ), cat AS (
             SELECT mov.produto_id, mov.delta,
                    CASE
                        WHEN t.id IS NOT NULL AND t.destino_local_id = $2 THEN 'recebido'
                        WHEN t.id IS NOT NULL AND t.origem_local_id = $2 THEN 'enviado'
                        WHEN mov.motivo LIKE 'Venda #%' OR mov.motivo = 'cancelamento_venda' THEN 'vendido'
                        WHEN mov.tipo = 'ajuste' THEN 'ajustes'
                        ELSE 'outros'
                    END AS categoria
             FROM mov
             LEFT JOIN transferencias_estoque t ON t.id = mov.transferencia_id AND t.empresa_id = $1
             WHERE $3::date IS NULL OR mov.criado_em >= $3::date
         ), agg AS (
             SELECT produto_id,
                    COALESCE(SUM(delta) FILTER (WHERE categoria = 'recebido'), 0)::int AS recebido,
                    COALESCE(-SUM(delta) FILTER (WHERE categoria = 'enviado'), 0)::int AS enviado,
                    COALESCE(-SUM(delta) FILTER (WHERE categoria = 'vendido'), 0)::int AS vendido,
                    COALESCE(SUM(delta) FILTER (WHERE categoria = 'ajustes'), 0)::int AS ajustes,
                    COALESCE(SUM(delta) FILTER (WHERE categoria = 'outros'), 0)::int AS outros
             FROM cat GROUP BY produto_id
         ), vend AS (
             SELECT iv.produto_id, SUM(iv.quantidade * iv.preco_unitario) AS valor_vendido
             FROM itens_venda iv
             JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = iv.empresa_id
             WHERE iv.empresa_id = $1 AND iv.local_id = $2 AND v.status <> 'cancelada'
               AND ($3::date IS NULL OR v.data >= $3::date)
             GROUP BY iv.produto_id
         )
         SELECT p.id AS produto_id, p.nome, p.sku,
                COALESCE(el.saldo, 0)::int AS saldo_atual,
                COALESCE(agg.recebido, 0) AS recebido, COALESCE(agg.enviado, 0) AS enviado,
                COALESCE(agg.vendido, 0) AS vendido, COALESCE(agg.ajustes, 0) AS ajustes,
                COALESCE(agg.outros, 0) AS outros,
                COALESCE(vend.valor_vendido, 0) AS valor_vendido
         FROM produtos p
         LEFT JOIN estoque_locais el ON el.produto_id = p.id AND el.local_id = $2 AND el.empresa_id = $1
         LEFT JOIN agg ON agg.produto_id = p.id
         LEFT JOIN vend ON vend.produto_id = p.id
         WHERE p.empresa_id = $1 AND (COALESCE(el.saldo, 0) > 0 OR agg.produto_id IS NOT NULL OR vend.produto_id IS NOT NULL)
         ORDER BY p.nome, p.id`,
        [empresa_id, local_id, desde ?? null]
    );

    const itens = rows.map((r) => {
        const saldo_inicial = r.saldo_atual - (r.recebido - r.enviado - r.vendido + r.ajustes + r.outros);
        return {
            ...r,
            valor_vendido: Number(r.valor_vendido),
            saldo_inicial,
            confere: desde ? saldo_inicial >= 0 : saldo_inicial === 0
        };
    });

    const soma = (campo) => itens.reduce((acc, i) => acc + i[campo], 0);

    return {
        itens,
        totais: {
            saldo_inicial: soma('saldo_inicial'), recebido: soma('recebido'), enviado: soma('enviado'),
            vendido: soma('vendido'), ajustes: soma('ajustes'), outros: soma('outros'), saldo_atual: soma('saldo_atual'),
            valor_vendido: Math.round(soma('valor_vendido') * 100) / 100
        },
        confere: itens.every((i) => i.confere)
    };
}

async function criarConferencia({ empresa_id, local_id, usuario_id, itens, observacao, aplicar_ajuste }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // Produtos primeiro, em ordem de id (mesma regra das transferências, contra deadlock).
        const ordenados = [...itens].sort((a, b) => a.produto_id - b.produto_id);
        const { rows: produtos } = await client.query(
            'SELECT id FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE',
            [empresa_id, ordenados.map((i) => i.produto_id)]
        );
        if (produtos.length !== ordenados.length) throw new AppError('Produto não encontrado', 404);

        const { rows: locais } = await client.query(
            'SELECT id, tipo, ativo FROM locais_estoque WHERE id = $1 AND empresa_id = $2 FOR SHARE',
            [local_id, empresa_id]
        );
        if (!locais.length) throw new AppError('Local de estoque não encontrado', 404);
        if (locais[0].tipo === 'transito') throw new AppError('Não é possível conferir o local Em trânsito', 409);
        if (!locais[0].ativo) throw new AppError('Local de estoque inativo', 409);

        const { rows: [conferencia] } = await client.query(
            `INSERT INTO conferencias_estoque (empresa_id, local_id, criado_por, observacao, ajuste_aplicado)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [empresa_id, local_id, usuario_id, observacao ?? null, aplicar_ajuste]
        );

        const itensGravados = [];

        for (const item of ordenados) {
            const { rows: saldoRows } = await client.query(
                'SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2 AND empresa_id = $3 FOR UPDATE',
                [item.produto_id, local_id, empresa_id]
            );
            const saldo_sistema = saldoRows.length ? saldoRows[0].saldo : 0;

            const { rows: [gravado] } = await client.query(
                `INSERT INTO conferencia_itens (conferencia_id, produto_id, empresa_id, saldo_sistema, quantidade_contada)
                 VALUES ($1, $2, $3, $4, $5) RETURNING produto_id, saldo_sistema, quantidade_contada, diferenca`,
                [conferencia.id, item.produto_id, empresa_id, saldo_sistema, item.quantidade_contada]
            );
            itensGravados.push(gravado);

            if (aplicar_ajuste && gravado.diferenca !== 0) {
                const resultado = await estoqueRepository.criarMovimentacao({
                    produto_id: item.produto_id,
                    tipo: 'ajuste',
                    quantidade: item.quantidade_contada,
                    motivo: `Conferência #${conferencia.id}`,
                    usuario_id,
                    empresa_id,
                    local_id
                }, client);

                if (resultado.erro) throw new AppError('Não foi possível aplicar o ajuste da conferência', 409);
            }
        }

        await client.query('COMMIT');
        return { ...conferencia, itens: itensGravados };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listarConferencias({ empresa_id, local_id, limit, offset }) {
    const { rows: [{ total }] } = await db.query(
        'SELECT COUNT(*)::int AS total FROM conferencias_estoque WHERE empresa_id = $1 AND local_id = $2',
        [empresa_id, local_id]
    );

    const { rows } = await db.query(
        `SELECT c.id, c.local_id, c.criado_por, u.nome AS criado_por_nome, c.observacao, c.ajuste_aplicado, c.criado_em,
                COALESCE((SELECT json_agg(json_build_object(
                    'produto_id', i.produto_id, 'nome', p.nome, 'saldo_sistema', i.saldo_sistema,
                    'quantidade_contada', i.quantidade_contada, 'diferenca', i.diferenca) ORDER BY p.nome, i.produto_id)
                  FROM conferencia_itens i JOIN produtos p ON p.id = i.produto_id AND p.empresa_id = i.empresa_id
                  WHERE i.conferencia_id = c.id AND i.empresa_id = c.empresa_id), '[]'::json) AS itens
         FROM conferencias_estoque c
         JOIN usuarios u ON u.id = c.criado_por AND u.empresa_id = c.empresa_id
         WHERE c.empresa_id = $1 AND c.local_id = $2
         ORDER BY c.id DESC LIMIT $3 OFFSET $4`,
        [empresa_id, local_id, limit, offset]
    );

    return { items: rows, total: Number(total) };
}

module.exports = { obterLocal, acerto, criarConferencia, listarConferencias };

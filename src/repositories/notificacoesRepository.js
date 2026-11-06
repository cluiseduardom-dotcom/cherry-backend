const db = require('../config/db');
const vendaConsumosRepository = require('./vendaConsumosRepository');

// Uma linha por produto ativo da empresa, com os números que as regras do sino usam.
// Só vendas finalizadas contam. Tudo filtrado por empresa_id nas próprias consultas.
async function listarBaseDeProdutos(empresa_id) {
    const { rows } = await db.query(
        `WITH vendas_produto AS (
            SELECT iv.produto_id,
                   COALESCE(SUM(iv.quantidade) FILTER (WHERE v.data >= NOW() - INTERVAL '30 days'), 0)::int AS vendido_30d,
                   COALESCE(SUM(iv.quantidade) FILTER (WHERE v.data >= NOW() - INTERVAL '90 days'), 0)::int AS vendido_90d,
                   FLOOR(EXTRACT(EPOCH FROM (NOW() - MAX(v.data))) / 86400)::int AS dias_sem_venda
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = $1 AND v.status = 'finalizada'
            GROUP BY iv.produto_id
        ),
        primeira_movimentacao AS (
            SELECT produto_id,
                   FLOOR(EXTRACT(EPOCH FROM (NOW() - MIN(criado_em))) / 86400)::int AS dias_cadastro
            FROM movimentacoes_estoque
            WHERE empresa_id = $1
            GROUP BY produto_id
        )
        SELECT p.id, p.sku, p.nome, p.tipo, p.estoque_atual, p.estoque_minimo,
               COALESCE(vp.vendido_30d, 0) AS vendido_30d,
               COALESCE(vp.vendido_90d, 0) AS vendido_90d,
               vp.dias_sem_venda,
               COALESCE(pm.dias_cadastro, 0) AS dias_cadastro
        FROM produtos p
        LEFT JOIN vendas_produto vp ON vp.produto_id = p.id
        LEFT JOIN primeira_movimentacao pm ON pm.produto_id = p.id
        WHERE p.ativo = true AND p.empresa_id = $1
        ORDER BY p.id`,
        [empresa_id]
    );

    return rows;
}

// Insumos com consumo pendente (faltou saldo no Central na hora de uma venda). Filtrado por empresa_id.
async function listarPendenciasDeInsumo(empresa_id) {
    return vendaConsumosRepository.listarPendenciasPorInsumo(empresa_id, db);
}

// Uma linha por Maleta ativa da empresa, com idades em dias já calculadas no banco.
// - dias_sem_venda: desde a última venda finalizada da maleta OU o último recebimento aceito (o mais recente).
// - dias_sem_conferencia: desde a última conferência; sem nenhuma, desde o primeiro recebimento aceito.
// - conferencia_divergente_id: só se a ÚLTIMA conferência tem diferença e o ajuste não foi aplicado.
async function listarBaseDeMaletas(empresa_id) {
    const { rows } = await db.query(
        `WITH saldos AS (
            SELECT local_id, SUM(saldo)::int AS saldo_total
            FROM estoque_locais WHERE empresa_id = $1 GROUP BY local_id
        ),
        vendas_local AS (
            SELECT iv.local_id, MAX(v.data) AS ultima_venda
            FROM itens_venda iv
            JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = $1 AND v.status = 'finalizada'
            WHERE iv.empresa_id = $1
            GROUP BY iv.local_id
        ),
        recebimentos AS (
            SELECT destino_local_id AS local_id, MIN(resolvido_em) AS primeiro, MAX(resolvido_em) AS ultimo
            FROM transferencias_estoque WHERE empresa_id = $1 AND status = 'concluida'
            GROUP BY destino_local_id
        ),
        ultima_conferencia AS (
            SELECT DISTINCT ON (local_id) id, local_id, criado_em, ajuste_aplicado
            FROM conferencias_estoque WHERE empresa_id = $1
            ORDER BY local_id, id DESC
        ),
        divergencias AS (
            SELECT c.local_id, c.id AS conferencia_id, COUNT(*)::int AS itens_divergentes
            FROM ultima_conferencia c
            JOIN conferencia_itens ci ON ci.conferencia_id = c.id AND ci.empresa_id = $1 AND ci.diferenca <> 0
            WHERE NOT c.ajuste_aplicado
            GROUP BY c.local_id, c.id
        )
        SELECT l.id AS local_id, l.nome, l.usuario_id,
               COALESCE(s.saldo_total, 0) AS saldo_total,
               FLOOR(EXTRACT(EPOCH FROM (NOW() - GREATEST(vl.ultima_venda, r.ultimo))) / 86400)::int AS dias_sem_venda,
               FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(uc.criado_em, r.primeiro))) / 86400)::int AS dias_sem_conferencia,
               d.conferencia_id AS conferencia_divergente_id,
               d.itens_divergentes
        FROM locais_estoque l
        LEFT JOIN saldos s ON s.local_id = l.id
        LEFT JOIN vendas_local vl ON vl.local_id = l.id
        LEFT JOIN recebimentos r ON r.local_id = l.id
        LEFT JOIN ultima_conferencia uc ON uc.local_id = l.id
        LEFT JOIN divergencias d ON d.local_id = l.id
        WHERE l.empresa_id = $1 AND l.tipo = 'maleta' AND l.ativo = true
        ORDER BY l.id`,
        [empresa_id]
    );

    return rows;
}

// Transferências ainda pendentes (aguardando aceite) com total de peças e idade em dias.
async function listarTransferenciasPendentes(empresa_id) {
    const { rows } = await db.query(
        `SELECT t.id, lo.nome AS origem_nome, ld.nome AS destino_nome, ld.usuario_id AS destino_usuario_id,
                COALESCE(SUM(ti.quantidade), 0)::int AS pecas,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - t.criado_em)) / 86400)::int AS dias
         FROM transferencias_estoque t
         JOIN locais_estoque lo ON lo.id = t.origem_local_id AND lo.empresa_id = t.empresa_id
         JOIN locais_estoque ld ON ld.id = t.destino_local_id AND ld.empresa_id = t.empresa_id
         LEFT JOIN transferencia_itens ti ON ti.transferencia_id = t.id AND ti.empresa_id = t.empresa_id
         WHERE t.empresa_id = $1 AND t.status = 'pendente'
         GROUP BY t.id, lo.nome, ld.nome, ld.usuario_id
         ORDER BY t.id`,
        [empresa_id]
    );

    return rows;
}

module.exports = { listarBaseDeProdutos, listarPendenciasDeInsumo, listarBaseDeMaletas, listarTransferenciasPendentes };

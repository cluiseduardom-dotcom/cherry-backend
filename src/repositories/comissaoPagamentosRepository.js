const db = require('../config/db');
const AppError = require('../errors/AppError');
const { reaisParaCentavos, centavosParaReais } = require('../utils/comissao');

// Pagamento de comissão ao vendedor. empresa_id vem sempre do JWT.
// A pagar de uma comissão = valor_liberado - já pago (soma dos itens de pagamento). Positivo = falta
// pagar; negativo = a comissão foi paga e depois estornada (desconto no próximo pagamento).

const SQL_PAGO = `(SELECT COALESCE(SUM(i.valor), 0) FROM comissao_pagamento_itens i
                    WHERE i.comissao_id = c.id AND i.empresa_id = c.empresa_id)`;

const MODO_PADRAO = 'liberada';

// 1º instante do mês corrente em America/Sao_Paulo, no mesmo tipo de comissoes_venda.criado_em
// (TIMESTAMP gravado por NOW() na hora do servidor): vendas até 23:59:59 do último dia do mês
// anterior (horário de Brasília) são de mês fechado.
const SQL_INICIO_DO_MES = `((date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo')::timestamp`;

// Modo de pagamento da empresa; sem linha = padrão ('liberada'). `executor` = pool ou client da transação.
async function obterModoPagamento(empresa_id, executor = db) {
    const { rows } = await executor.query(
        'SELECT modo_pagamento FROM comissao_configuracoes WHERE empresa_id = $1',
        [empresa_id]
    );

    return rows[0] ? rows[0].modo_pagamento : MODO_PADRAO;
}

async function obterConfiguracao(empresa_id) {
    const { rows } = await db.query(
        `SELECT cc.modo_pagamento, cc.atualizado_em, u.nome AS atualizado_por_nome
         FROM comissao_configuracoes cc
         JOIN usuarios u ON u.id = cc.atualizado_por AND u.empresa_id = cc.empresa_id
         WHERE cc.empresa_id = $1`,
        [empresa_id]
    );

    return rows[0]
        ? { ...rows[0], padrao: false }
        : { modo_pagamento: MODO_PADRAO, atualizado_em: null, atualizado_por_nome: null, padrao: true };
}

async function definirModoPagamento({ empresa_id, modo_pagamento, atualizado_por }) {
    await db.query(
        `INSERT INTO comissao_configuracoes (empresa_id, modo_pagamento, atualizado_por)
         VALUES ($1, $2, $3)
         ON CONFLICT (empresa_id) DO UPDATE
            SET modo_pagamento = EXCLUDED.modo_pagamento,
                atualizado_por = EXCLUDED.atualizado_por,
                atualizado_em = NOW()`,
        [empresa_id, modo_pagamento, atualizado_por]
    );

    return obterConfiguracao(empresa_id);
}

// Vendedores com saldo (a pagar ou desconto pendente), com o líquido a pagar. Só leitura.
// No modo 'fim_do_mes', comissão de venda do mês corrente SEM pagamento/desconto registrado não conta
// em a_pagar: vira `aguardando_fechamento`. Comissão que já tem pagamento (ou desconto de estorno)
// entra sempre, para o desconto ser abatido.
async function resumoAPagar(empresa_id) {
    const modo = await obterModoPagamento(empresa_id);

    const { rows } = await db.query(
        `WITH saldos AS (
             SELECT c.usuario_id, c.empresa_id,
                    c.valor_liberado - ${SQL_PAGO} AS saldo,
                    ($2 = 'liberada' OR c.criado_em < ${SQL_INICIO_DO_MES} OR ${SQL_PAGO} <> 0) AS elegivel
             FROM comissoes_venda c
             WHERE c.empresa_id = $1 AND c.valor_liberado - ${SQL_PAGO} <> 0
         )
         SELECT u.id AS vendedor_id, u.nome AS vendedor_nome, uf.chave AS vendedor_foto_chave, u.ativo,
                (COUNT(*) FILTER (WHERE s.elegivel))::int AS quantidade_comissoes,
                COALESCE(SUM(GREATEST(s.saldo, 0)) FILTER (WHERE s.elegivel), 0)::numeric(15,2) AS bruto_a_pagar,
                COALESCE(SUM(LEAST(s.saldo, 0)) FILTER (WHERE s.elegivel), 0)::numeric(15,2) AS descontos,
                COALESCE(SUM(s.saldo) FILTER (WHERE s.elegivel), 0)::numeric(15,2) AS a_pagar,
                COALESCE(SUM(s.saldo) FILTER (WHERE NOT s.elegivel), 0)::numeric(15,2) AS aguardando_fechamento
         FROM saldos s
         JOIN usuarios u ON u.id = s.usuario_id AND u.empresa_id = s.empresa_id
         LEFT JOIN usuarios_fotos uf ON uf.usuario_id = u.id AND uf.empresa_id = u.empresa_id
         GROUP BY u.id, u.nome, uf.chave, u.ativo
         ORDER BY a_pagar DESC, u.nome ASC`,
        [empresa_id, modo]
    );

    return { modo_pagamento: modo, items: rows };
}

// Registra o pagamento DENTRO de uma transação. Trava as comissões do vendedor (ORDER BY id, mesma
// ordem de qualquer outra rotina que as trave) e confere, sob a trava, que `valor_esperado` — o valor
// que a tela mostrou — ainda é o líquido a pagar. Se mudou (estorno, nova liberação, outro pagamento
// simultâneo) recusa com 409 e nada é gravado.
async function registrarPagamento({ empresa_id, vendedor_id, criado_por, valor_esperado, forma, pago_em, observacao }) {
    if (vendedor_id === criado_por) {
        throw new AppError('Ninguém registra o pagamento da própria comissão', 403);
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: vendedores } = await client.query(
            'SELECT id, nome FROM usuarios WHERE id = $1 AND empresa_id = $2',
            [vendedor_id, empresa_id]
        );

        if (!vendedores.length) throw new AppError('Vendedor não encontrado', 404);

        // 1) Trava as comissões do vendedor. 2) Só DEPOIS lê o já pago, numa consulta nova: em READ
        // COMMITTED a de cima tira o snapshot antes de esperar a trava, então quem esperou enxergaria o
        // "pago" de antes do pagamento concorrente (a linha de comissão não muda, o EvalPlanQual não
        // reavalia a subconsulta) e pagaria em dobro.
        await client.query(
            `SELECT c.id FROM comissoes_venda c
             WHERE c.empresa_id = $1 AND c.usuario_id = $2
             ORDER BY c.id
             FOR UPDATE OF c`,
            [empresa_id, vendedor_id]
        );

        const modo = await obterModoPagamento(empresa_id, client);

        const { rows: comissoes } = await client.query(
            `SELECT c.id, c.venda_id, c.valor_liberado, ${SQL_PAGO} AS pago,
                    (c.criado_em < ${SQL_INICIO_DO_MES}) AS mes_fechado
             FROM comissoes_venda c
             WHERE c.empresa_id = $1 AND c.usuario_id = $2
             ORDER BY c.id`,
            [empresa_id, vendedor_id]
        );

        const todos = comissoes
            .map((c) => ({
                comissao_id: c.id,
                centavos: reaisParaCentavos(c.valor_liberado) - reaisParaCentavos(c.pago),
                // Mesma regra do resumo: no fim do mês só vendas de mês fechado ou com pagamento/desconto já registrado.
                elegivel: modo === 'liberada' || c.mes_fechado || reaisParaCentavos(c.pago) !== 0
            }))
            .filter((i) => i.centavos !== 0);

        const itens = todos.filter((i) => i.elegivel);

        const liquido = itens.reduce((soma, i) => soma + i.centavos, 0);

        if (liquido <= 0) {
            const aguardando = todos.length > itens.length;

            throw new AppError(
                itens.length
                    ? 'Não há comissão a pagar: os descontos de estornos anteriores cobrem o que foi liberado'
                    : (aguardando
                        ? 'Não há comissão a pagar agora: as vendas do mês corrente só são pagas após o fechamento do mês'
                        : 'Não há comissão liberada a pagar para este vendedor'),
                409
            );
        }

        if (liquido !== reaisParaCentavos(valor_esperado)) {
            throw new AppError(
                `O valor a pagar mudou (agora ${centavosParaReais(liquido)}). Recarregue a tela e confirme de novo`,
                409
            );
        }

        const { rows: [pagamento] } = await client.query(
            `INSERT INTO comissao_pagamentos (empresa_id, vendedor_id, valor, forma, pago_em, observacao, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, vendedor_id, valor, forma, pago_em::text AS pago_em, observacao, criado_por, criado_em`,
            [empresa_id, vendedor_id, centavosParaReais(liquido), forma, pago_em, observacao ?? null, criado_por]
        );

        for (const item of itens) {
            await client.query(
                `INSERT INTO comissao_pagamento_itens (empresa_id, pagamento_id, comissao_id, valor)
                 VALUES ($1, $2, $3, $4)`,
                [empresa_id, pagamento.id, item.comissao_id, centavosParaReais(item.centavos)]
            );
        }

        await client.query('COMMIT');

        return {
            ...pagamento,
            vendedor_nome: vendedores[0].nome,
            quantidade_comissoes: itens.length
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Histórico de pagamentos. vendedor_id preenchido restringe a um vendedor (o próprio, quando quem
// consulta não é gerente/admin). Cada pagamento traz as vendas que cobriu.
async function listarPagamentos({ empresa_id, vendedor_id, limit, offset }) {
    const valores = [empresa_id];
    let filtroVendedor = '';

    if (vendedor_id !== undefined) {
        valores.push(vendedor_id);
        filtroVendedor = `AND p.vendedor_id = $${valores.length}`;
    }

    const { rows } = await db.query(
        `SELECT p.id, p.vendedor_id, vend.nome AS vendedor_nome, vf.chave AS vendedor_foto_chave, p.valor, p.forma, p.pago_em::text AS pago_em,
                p.observacao, p.criado_por, pagador.nome AS criado_por_nome, p.criado_em,
                COALESCE((SELECT json_agg(json_build_object('comissao_id', i.comissao_id, 'venda_id', c.venda_id, 'valor', i.valor) ORDER BY i.comissao_id)
                            FROM comissao_pagamento_itens i
                            JOIN comissoes_venda c ON c.id = i.comissao_id AND c.empresa_id = i.empresa_id
                           WHERE i.pagamento_id = p.id AND i.empresa_id = p.empresa_id), '[]'::json) AS itens
         FROM comissao_pagamentos p
         JOIN usuarios vend ON vend.id = p.vendedor_id AND vend.empresa_id = p.empresa_id
         LEFT JOIN usuarios_fotos vf ON vf.usuario_id = vend.id AND vf.empresa_id = vend.empresa_id
         JOIN usuarios pagador ON pagador.id = p.criado_por AND pagador.empresa_id = p.empresa_id
         WHERE p.empresa_id = $1 ${filtroVendedor}
         ORDER BY p.id DESC
         LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset]
    );

    const { rows: [total] } = await db.query(
        `SELECT COUNT(*)::int AS quantidade, COALESCE(SUM(p.valor), 0) AS total_pago
         FROM comissao_pagamentos p
         WHERE p.empresa_id = $1 ${filtroVendedor}`,
        valores
    );

    return { items: rows, total: total.quantidade, totais: { total_pago: total.total_pago } };
}

module.exports = {
    obterConfiguracao, definirModoPagamento, resumoAPagar, registrarPagamento, listarPagamentos
};

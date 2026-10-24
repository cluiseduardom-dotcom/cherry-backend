const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');
const {
    calcularComissaoCentavos,
    liberadoProporcionalCentavos,
    reaisParaCentavos,
    centavosParaReais
} = require('../utils/comissao');

// Papéis que nunca vendem: ficam fora da lista de percentuais.
const PAPEIS_SEM_VENDA = ['estoquista', 'faturista'];

// Percentual vigente do vendedor: o próprio (inclusive 0, que desliga a comissão dele)
// prevalece sobre o padrão da empresa (usuario_id IS NULL). O PADRÃO NÃO se aplica a quem
// tem cargo admin (a dona/o dono do negócio não ganha comissão sobre a própria venda); um
// percentual PRÓPRIO definido para o admin vale normalmente. Filtra SEMPRE por empresa_id.
async function buscarPercentualVigente(empresa_id, usuario_id, client) {
    const { rows } = await client.query(
        `SELECT cp.percentual
         FROM comissao_percentuais cp
         JOIN usuarios u ON u.id = $2 AND u.empresa_id = cp.empresa_id
         WHERE cp.empresa_id = $1
           AND (cp.usuario_id = $2 OR (cp.usuario_id IS NULL AND u.papel <> 'admin'))
         ORDER BY (cp.usuario_id IS NULL) ASC
         LIMIT 1`,
        [empresa_id, usuario_id]
    );

    return rows[0] ? Number(rows[0].percentual) : null;
}

// Apura a comissão da venda DENTRO da transação da venda (client obrigatório), no mesmo
// padrão de taxasPlataformaRepository.apurar. Sem vendedor, sem percentual configurado ou
// com percentual 0 não grava nada (retorna null). base = subtotal - desconto (sem juros).
// Qualquer falha lança erro e o ROLLBACK de vendasRepository.criar desfaz a venda inteira.
async function apurar({ venda_id, empresa_id, usuario_id, base }, client) {
    if (!client) {
        throw new Error('comissoesRepository.apurar exige o client da transação da venda');
    }

    if (!usuario_id) return null;

    const percentual = await buscarPercentualVigente(empresa_id, usuario_id, client);

    if (percentual === null || percentual === 0) return null;

    const { base_centavos, valor_centavos } = calcularComissaoCentavos(base, percentual);

    const { rows } = await client.query(
        `INSERT INTO comissoes_venda
            (venda_id, empresa_id, usuario_id, percentual, base_calculo, valor)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (venda_id) DO NOTHING
         RETURNING id`,
        [
            venda_id,
            empresa_id,
            usuario_id,
            percentual,
            centavosParaReais(base_centavos),
            centavosParaReais(valor_centavos)
        ]
    );

    if (rows[0]) {
        await registrarEvento(client, {
            empresa_id, comissao_id: rows[0].id, venda_id, tipo: 'apurada', origem: 'venda',
            delta: 0, valor_liberado_apos: 0, executado_por: null
        });
    }

    return rows[0] ?? null;
}

// Histórico insert-only da comissão.
async function registrarEvento(client, { empresa_id, comissao_id, venda_id, tipo, origem, delta, valor_liberado_apos, repasse_id = null, executado_por = null }) {
    await client.query(
        `INSERT INTO comissoes_eventos
            (empresa_id, comissao_id, venda_id, tipo, origem, delta, valor_liberado_apos, repasse_id, executado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [empresa_id, comissao_id, venda_id, tipo, origem, delta, valor_liberado_apos, repasse_id, executado_por]
    );
}

// Dinheiro que o vendedor recebeu na venda: cada pagamento em dinheiro de uma venda COM
// comissão vira um repasse 'a_repassar'. Venda sem comissão (vendedor sem percentual, dona)
// não tem repasse. Dentro da transação da venda.
async function registrarRepasses({ venda_id, empresa_id, vendedor_id, pagamentos }, client) {
    if (!client) {
        throw new Error('comissoesRepository.registrarRepasses exige o client da transação da venda');
    }

    const emDinheiro = (pagamentos ?? []).filter((pagamento) => pagamento.forma_pagamento === 'dinheiro');

    if (!emDinheiro.length) return 0;

    const { rows } = await client.query(
        `SELECT id FROM comissoes_venda WHERE venda_id = $1 AND empresa_id = $2`,
        [venda_id, empresa_id]
    );

    if (!rows.length) return 0;

    for (const pagamento of emDinheiro) {
        await client.query(
            `INSERT INTO comissao_repasses (empresa_id, pagamento_id, venda_id, vendedor_id, valor)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (pagamento_id) DO NOTHING`,
            [empresa_id, pagamento.id, venda_id, vendedor_id, pagamento.valor]
        );
    }

    return emDinheiro.length;
}

// Quanto da venda JÁ foi pago, em reais (string), para efeito de comissão:
//  - venda com pagamentos_venda: por pagamento, o recebido (parcelas recebidas + parcial)
//    limitado ao valor do pagamento menos os estornos; pagamento em dinheiro com repasse
//    ainda não confirmado conta ZERO;
//  - venda legada (sem pagamentos_venda): à vista = total; a prazo = contas a receber já
//    recebidas.
async function valorPagoDaVenda(client, { venda_id, empresa_id, total, forma_pagamento }) {
    const { rows: contagem } = await client.query(
        `SELECT COUNT(*) AS n FROM pagamentos_venda WHERE venda_id = $1 AND empresa_id = $2`,
        [venda_id, empresa_id]
    );

    if (Number(contagem[0].n) === 0) {
        if (forma_pagamento !== 'prazo') return total;

        const { rows } = await client.query(
            `SELECT COALESCE(SUM(valor) FILTER (WHERE status = 'recebido'), 0) AS pago
             FROM contas_receber WHERE venda_id = $1 AND empresa_id = $2`,
            [venda_id, empresa_id]
        );

        return rows[0].pago;
    }

    const { rows } = await client.query(
        `SELECT COALESCE(SUM(GREATEST(0, LEAST(
                    COALESCE(rec.recebido, 0),
                    pv.valor - COALESCE(est.estornado, 0)
                ))), 0) AS pago
         FROM pagamentos_venda pv
         LEFT JOIN LATERAL (
             SELECT SUM(CASE WHEN pp.status = 'recebida' THEN pp.valor
                             WHEN pp.status = 'parcial' THEN pp.valor_pago
                             ELSE 0 END) AS recebido
             FROM parcelas_pagamento pp
             WHERE pp.pagamento_id = pv.id AND pp.empresa_id = pv.empresa_id
         ) rec ON TRUE
         LEFT JOIN LATERAL (
             SELECT SUM(e.valor) AS estornado
             FROM estornos_pagamento e
             WHERE e.pagamento_id = pv.id AND e.empresa_id = pv.empresa_id
         ) est ON TRUE
         LEFT JOIN comissao_repasses r ON r.pagamento_id = pv.id AND r.empresa_id = pv.empresa_id
         WHERE pv.venda_id = $1 AND pv.empresa_id = $2
           AND (r.id IS NULL OR r.status = 'confirmado')`,
        [venda_id, empresa_id]
    );

    return rows[0].pago;
}

// Recalcula, do zero, a parte liberada da comissão a partir do que foi pago. Idempotente:
// pode ser chamada depois de qualquer pagamento, estorno, repasse ou recebimento. Dentro da
// transação de quem chama (client obrigatório). Trava a linha da comissão (FOR UPDATE).
// Sem comissão ou já estornada: no-op (retorna null). Grava evento só se o valor mudou.
async function recalcularLiberacao({ venda_id, empresa_id, origem, executado_por = null, repasse_id = null }, client) {
    if (!client) {
        throw new Error('comissoesRepository.recalcularLiberacao exige o client da transação');
    }

    const { rows } = await client.query(
        `SELECT c.id, c.valor, c.valor_liberado, c.status, v.total, v.forma_pagamento
         FROM comissoes_venda c
         JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         WHERE c.venda_id = $1 AND c.empresa_id = $2
         FOR UPDATE OF c`,
        [venda_id, empresa_id]
    );

    const comissao = rows[0];

    if (!comissao || comissao.status === 'estornada') return null;

    const pago = await valorPagoDaVenda(client, {
        venda_id, empresa_id, total: comissao.total, forma_pagamento: comissao.forma_pagamento
    });

    const valorCentavos = reaisParaCentavos(comissao.valor);
    const alvoCentavos = liberadoProporcionalCentavos(
        valorCentavos,
        Math.min(reaisParaCentavos(pago), reaisParaCentavos(comissao.total)),
        reaisParaCentavos(comissao.total)
    );
    const atualCentavos = reaisParaCentavos(comissao.valor_liberado);

    if (alvoCentavos === atualCentavos) return { id: comissao.id, status: comissao.status, alterado: false };

    const status = alvoCentavos === 0 ? 'pendente' : (alvoCentavos >= valorCentavos ? 'liberada' : 'parcial');

    await client.query(
        `UPDATE comissoes_venda SET valor_liberado = $1, status = $2 WHERE id = $3 AND empresa_id = $4`,
        [centavosParaReais(alvoCentavos), status, comissao.id, empresa_id]
    );

    const aumentou = alvoCentavos > atualCentavos;

    await registrarEvento(client, {
        empresa_id,
        comissao_id: comissao.id,
        venda_id,
        tipo: aumentou ? 'liberacao' : 'reducao',
        origem,
        delta: centavosParaReais(alvoCentavos - atualCentavos),
        valor_liberado_apos: centavosParaReais(alvoCentavos),
        repasse_id,
        executado_por
    });

    return { id: comissao.id, status, alterado: true };
}

// Para chamadores sem transação própria (recebimento de conta legado): abre a sua. Como o
// valor é sempre recalculado do estado atual, uma falha aqui é sanada no próximo recálculo.
async function recalcularLiberacaoAvulso(dados) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const resultado = await recalcularLiberacao(dados, client);
        await client.query('COMMIT');

        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// O gerente/admin confirma que o dinheiro do vendedor chegou. O próprio vendedor nunca
// confirma o seu repasse (regra aqui e CHECK no banco). Confirmar libera a comissão.
async function confirmarRepasse({ id, empresa_id, confirmado_por, observacao }) {
    return executarComLock('comissao_repasses', { coluna: 'id', valor: id }, empresa_id, undefined, async (linha, client) => {
        if (!linha) throw new AppError('Repasse não encontrado', 404);

        if (linha.vendedor_id === confirmado_por) {
            throw new AppError('O repasse deve ser confirmado por outra pessoa, não pelo próprio vendedor', 403);
        }

        if (linha.status !== 'a_repassar') {
            throw new AppError(
                linha.status === 'confirmado' ? 'Repasse já confirmado' : 'Repasse cancelado (venda cancelada)',
                409
            );
        }

        const { rows } = await client.query(
            `UPDATE comissao_repasses
             SET status = 'confirmado', confirmado_em = NOW(), confirmado_por = $1, observacao = $2
             WHERE id = $3 AND empresa_id = $4
             RETURNING id, venda_id, pagamento_id, vendedor_id, valor, status, declarado_em, confirmado_em, confirmado_por, observacao`,
            [confirmado_por, observacao ?? null, id, empresa_id]
        );

        await recalcularLiberacao({
            venda_id: linha.venda_id, empresa_id, origem: 'repasse', executado_por: confirmado_por, repasse_id: id
        }, client);

        return rows[0];
    });
}

// Cancelamento da venda: marca a comissão como estornada (nunca apaga), zera a parte
// liberada e cancela os repasses ainda pendentes. Venda sem comissão (anterior ao módulo,
// sem percentual) ou já estornada é no-op. Repasses antes da comissão: mesma ordem de
// locks de confirmarRepasse.
async function estornarPorVendaId(venda_id, empresa_id, client) {
    await client.query(
        `UPDATE comissao_repasses SET status = 'cancelado'
         WHERE venda_id = $1 AND empresa_id = $2 AND status = 'a_repassar'`,
        [venda_id, empresa_id]
    );

    const { rows } = await client.query(
        `SELECT id, valor_liberado FROM comissoes_venda
         WHERE venda_id = $1 AND empresa_id = $2 AND status <> 'estornada'
         FOR UPDATE`,
        [venda_id, empresa_id]
    );

    if (!rows.length) return 0;

    await client.query(
        `UPDATE comissoes_venda
         SET status = 'estornada', valor_liberado = 0, estornado_em = NOW()
         WHERE id = $1 AND empresa_id = $2`,
        [rows[0].id, empresa_id]
    );

    await registrarEvento(client, {
        empresa_id,
        comissao_id: rows[0].id,
        venda_id,
        tipo: 'estorno',
        origem: 'cancelamento_venda',
        delta: centavosParaReais(-reaisParaCentavos(rows[0].valor_liberado)),
        valor_liberado_apos: 0
    });

    return 1;
}

function filtroPeriodo(valores, { data_inicio, data_fim }) {
    const condicoes = [];

    if (data_inicio !== undefined) {
        valores.push(data_inicio);
        condicoes.push(`v.data::date >= $${valores.length}`);
    }

    if (data_fim !== undefined) {
        valores.push(data_fim);
        condicoes.push(`v.data::date <= $${valores.length}`);
    }

    return condicoes;
}

// Comissões de UM vendedor (o usuário autenticado). empresa_id e usuario_id vêm do JWT.
// valor = comissão total da venda; valor_liberado = parte já liberada pelo pagamento;
// valor_pendente = o que ainda falta liberar (0 se estornada).
async function listarDoUsuario({ limit, offset, empresa_id, usuario_id, data_inicio, data_fim }) {
    const valores = [empresa_id, usuario_id];
    const condicoes = ['c.empresa_id = $1', 'c.usuario_id = $2', ...filtroPeriodo(valores, { data_inicio, data_fim })];
    const where = `WHERE ${condicoes.join(' AND ')}`;
    const valoresListagem = [...valores, limit, offset];

    const { rows } = await db.query(
        `SELECT c.id, c.venda_id, v.data AS data_venda, c.percentual, c.base_calculo,
                c.valor, c.valor_liberado,
                CASE WHEN c.status = 'estornada' THEN 0 ELSE c.valor - c.valor_liberado END AS valor_pendente,
                c.status, c.criado_em, c.estornado_em
         FROM comissoes_venda c
         JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         ${where}
         ORDER BY c.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: totaisRows } = await db.query(
        `SELECT COUNT(*) AS quantidade,
                COALESCE(SUM(c.base_calculo) FILTER (WHERE c.status <> 'estornada'), 0) AS total_base,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status <> 'estornada'), 0) AS total_comissao,
                COALESCE(SUM(c.valor_liberado) FILTER (WHERE c.status <> 'estornada'), 0) AS total_liberado,
                COALESCE(SUM(c.valor - c.valor_liberado) FILTER (WHERE c.status <> 'estornada'), 0) AS total_pendente,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'estornada'), 0) AS total_estornado
         FROM comissoes_venda c
         JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         ${where}`,
        valores
    );

    const { rows: repasseRows } = await db.query(
        `SELECT COALESCE(SUM(valor), 0) AS dinheiro_a_repassar
         FROM comissao_repasses
         WHERE empresa_id = $1 AND vendedor_id = $2 AND status = 'a_repassar'`,
        [empresa_id, usuario_id]
    );

    return {
        items: rows,
        total: Number(totaisRows[0].quantidade),
        totais: {
            total_base: totaisRows[0].total_base,
            total_comissao: totaisRows[0].total_comissao,
            total_liberado: totaisRows[0].total_liberado,
            total_pendente: totaisRows[0].total_pendente,
            total_estornado: totaisRows[0].total_estornado,
            dinheiro_a_repassar: repasseRows[0].dinheiro_a_repassar
        }
    };
}

// Resumo por vendedor de TODA a empresa (gerente/admin). Inclui quem ainda não vendeu no
// período, com o percentual vigente de cada um (admin sem percentual próprio = sem
// comissão). Filtra SEMPRE por empresa_id.
async function resumoEquipe({ empresa_id, data_inicio, data_fim }) {
    const valores = [empresa_id];
    const condicoesPeriodo = filtroPeriodo(valores, { data_inicio, data_fim });
    const filtroVenda = condicoesPeriodo.length ? `AND ${condicoesPeriodo.join(' AND ')}` : '';

    valores.push(PAPEIS_SEM_VENDA);
    const idxPapeis = valores.length;

    const { rows } = await db.query(
        `SELECT u.id AS usuario_id, u.nome, u.papel AS cargo, u.ativo,
                COALESCE(
                    (SELECT cp.percentual FROM comissao_percentuais cp
                      WHERE cp.empresa_id = u.empresa_id AND cp.usuario_id = u.id),
                    CASE WHEN u.papel <> 'admin' THEN
                        (SELECT cp.percentual FROM comissao_percentuais cp
                          WHERE cp.empresa_id = u.empresa_id AND cp.usuario_id IS NULL)
                    END
                ) AS percentual,
                COUNT(c.id) FILTER (WHERE c.status <> 'estornada') AS quantidade_vendas,
                COALESCE(SUM(c.base_calculo) FILTER (WHERE c.status <> 'estornada'), 0) AS total_base,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status <> 'estornada'), 0) AS total_comissao,
                COALESCE(SUM(c.valor_liberado) FILTER (WHERE c.status <> 'estornada'), 0) AS total_liberado,
                COALESCE(SUM(c.valor - c.valor_liberado) FILTER (WHERE c.status <> 'estornada'), 0) AS total_pendente,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'estornada'), 0) AS total_estornado,
                COALESCE((SELECT SUM(r.valor) FROM comissao_repasses r
                           WHERE r.empresa_id = u.empresa_id AND r.vendedor_id = u.id AND r.status = 'a_repassar'), 0) AS dinheiro_a_repassar
         FROM usuarios u
         LEFT JOIN comissoes_venda c
                ON c.usuario_id = u.id AND c.empresa_id = u.empresa_id
               AND EXISTS (
                    SELECT 1 FROM vendas v
                     WHERE v.id = c.venda_id AND v.empresa_id = c.empresa_id ${filtroVenda}
               )
         WHERE u.empresa_id = $1
           AND NOT (u.papel = ANY($${idxPapeis}))
         GROUP BY u.id, u.nome, u.papel, u.ativo, u.empresa_id
         HAVING u.ativo = true OR COUNT(c.id) > 0
         ORDER BY total_comissao DESC, u.nome ASC`,
        valores
    );

    const somar = (campo) => rows.reduce((acc, linha) => acc + Math.round(Number(linha[campo]) * 100), 0);
    const totais = {};

    for (const campo of ['total_base', 'total_comissao', 'total_liberado', 'total_pendente', 'total_estornado', 'dinheiro_a_repassar']) {
        totais[campo] = (somar(campo) / 100).toFixed(2);
    }

    return { items: rows, totais };
}

// Repasses de dinheiro. O vendedor vê só os seus (vendedor_id do JWT); quem tem
// `ver_vendas_de_todos` vê os da empresa (vendedor_id undefined). Filtra SEMPRE por empresa_id.
async function listarRepasses({ empresa_id, vendedor_id, status, limit, offset }) {
    const valores = [empresa_id];
    const condicoes = ['r.empresa_id = $1'];

    if (vendedor_id !== undefined) {
        valores.push(vendedor_id);
        condicoes.push(`r.vendedor_id = $${valores.length}`);
    }

    if (status !== undefined) {
        valores.push(status);
        condicoes.push(`r.status = $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;
    const valoresListagem = [...valores, limit, offset];

    const { rows } = await db.query(
        `SELECT r.id, r.venda_id, r.pagamento_id, r.vendedor_id, vend.nome AS vendedor_nome,
                r.valor, r.status, r.declarado_em, r.confirmado_em,
                r.confirmado_por, conf.nome AS confirmado_por_nome, r.observacao
         FROM comissao_repasses r
         JOIN usuarios vend ON vend.id = r.vendedor_id AND vend.empresa_id = r.empresa_id
         LEFT JOIN usuarios conf ON conf.id = r.confirmado_por AND conf.empresa_id = r.empresa_id
         ${where}
         ORDER BY r.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: totaisRows } = await db.query(
        `SELECT COUNT(*) AS quantidade,
                COALESCE(SUM(r.valor) FILTER (WHERE r.status = 'a_repassar'), 0) AS total_a_repassar
         FROM comissao_repasses r
         ${where}`,
        valores
    );

    return {
        items: rows,
        total: Number(totaisRows[0].quantidade),
        totais: { total_a_repassar: totaisRows[0].total_a_repassar }
    };
}

// Histórico de UMA comissão. usuario_id preenchido restringe ao dono da comissão (vendedor
// comum: a de outro vendedor é 404, não 403, para não confirmar que existe).
async function historicoDaComissao({ empresa_id, comissao_id, usuario_id }) {
    const valores = [comissao_id, empresa_id];
    let filtroDono = '';

    if (usuario_id !== undefined) {
        valores.push(usuario_id);
        filtroDono = 'AND c.usuario_id = $3';
    }

    const { rows: comissaoRows } = await db.query(
        `SELECT c.id, c.venda_id, c.usuario_id, c.percentual, c.base_calculo, c.valor, c.valor_liberado, c.status
         FROM comissoes_venda c
         WHERE c.id = $1 AND c.empresa_id = $2 ${filtroDono}`,
        valores
    );

    if (!comissaoRows.length) throw new AppError('Comissão não encontrada', 404);

    const { rows } = await db.query(
        `SELECT e.id, e.tipo, e.origem, e.delta, e.valor_liberado_apos, e.repasse_id,
                e.executado_por, u.nome AS executado_por_nome, e.criado_em
         FROM comissoes_eventos e
         LEFT JOIN usuarios u ON u.id = e.executado_por AND u.empresa_id = e.empresa_id
         WHERE e.comissao_id = $1 AND e.empresa_id = $2
         ORDER BY e.id ASC`,
        [comissao_id, empresa_id]
    );

    return { comissao: comissaoRows[0], eventos: rows };
}

// Configuração de percentuais (admin): padrão da empresa + um item por usuário que vende.
async function listarPercentuais(empresa_id) {
    const { rows: padraoRows } = await db.query(
        `SELECT percentual FROM comissao_percentuais
         WHERE empresa_id = $1 AND usuario_id IS NULL`,
        [empresa_id]
    );

    const { rows } = await db.query(
        `SELECT u.id AS usuario_id, u.nome, u.papel AS cargo, cp.percentual,
                (cp.percentual IS NULL AND u.papel <> 'admin') AS usa_padrao
         FROM usuarios u
         LEFT JOIN comissao_percentuais cp
                ON cp.empresa_id = u.empresa_id AND cp.usuario_id = u.id
         WHERE u.empresa_id = $1
           AND u.ativo = true
           AND NOT (u.papel = ANY($2))
         ORDER BY u.nome ASC`,
        [empresa_id, PAPEIS_SEM_VENDA]
    );

    return {
        padrao: padraoRows[0] ? padraoRows[0].percentual : null,
        usuarios: rows
    };
}

// Define (ou remove, com percentual null) o percentual do vendedor ou o padrão da empresa
// (usuario_id null). O usuário precisa ser do MESMO tenant do admin autenticado.
async function definirPercentual({ empresa_id, usuario_id, percentual, atualizado_por }) {
    if (usuario_id !== null) {
        const { rows } = await db.query(
            `SELECT id, papel FROM usuarios WHERE id = $1 AND empresa_id = $2`,
            [usuario_id, empresa_id]
        );

        if (!rows.length) throw new AppError('Usuário não encontrado', 404);

        if (PAPEIS_SEM_VENDA.includes(rows[0].papel)) {
            throw new AppError('Este cargo não recebe comissão de venda', 400);
        }
    }

    if (percentual === null) {
        await db.query(
            usuario_id === null
                ? `DELETE FROM comissao_percentuais WHERE empresa_id = $1 AND usuario_id IS NULL`
                : `DELETE FROM comissao_percentuais WHERE empresa_id = $1 AND usuario_id = $2`,
            usuario_id === null ? [empresa_id] : [empresa_id, usuario_id]
        );

        return { usuario_id, percentual: null };
    }

    const { rows } = await db.query(
        usuario_id === null
            ? `INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual, atualizado_por)
               VALUES ($1, NULL, $2, $3)
               ON CONFLICT (empresa_id) WHERE usuario_id IS NULL
               DO UPDATE SET percentual = EXCLUDED.percentual,
                             atualizado_por = EXCLUDED.atualizado_por,
                             atualizado_em = NOW()
               RETURNING percentual`
            : `INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual, atualizado_por)
               VALUES ($1, $4, $2, $3)
               ON CONFLICT (empresa_id, usuario_id) WHERE usuario_id IS NOT NULL
               DO UPDATE SET percentual = EXCLUDED.percentual,
                             atualizado_por = EXCLUDED.atualizado_por,
                             atualizado_em = NOW()
               RETURNING percentual`,
        usuario_id === null
            ? [empresa_id, percentual, atualizado_por]
            : [empresa_id, percentual, atualizado_por, usuario_id]
    );

    return { usuario_id, percentual: rows[0].percentual };
}

module.exports = {
    buscarPercentualVigente,
    apurar,
    registrarRepasses,
    recalcularLiberacao,
    recalcularLiberacaoAvulso,
    confirmarRepasse,
    estornarPorVendaId,
    listarRepasses,
    historicoDaComissao,
    listarDoUsuario,
    resumoEquipe,
    listarPercentuais,
    definirPercentual
};

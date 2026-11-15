const db = require('../config/db');
const AppError = require('../errors/AppError');
const painelRepository = require('./painelRepository');
const { executarComLock } = require('./shared/transacoes');
const { INICIO_SQL, FIM_SQL, RETIDO_MP_DA_VENDA_SQL } = require('./plataformaRepository');

// Cobrança da taxa da plataforma (Painel GiroNex): fechamento do período e lançamentos.
// SPEC: docs/SPEC_Taxas_a_Receber_Painel_GiroNex.md. Tabelas e garantias de banco: migrations 114 e 115.
//
// Concorrência: a linha do período é o ponto único de serialização. Fechamento, lançamentos e o estorno
// do cancelamento garantem que ela existe (INSERT ... ON CONFLICT DO NOTHING) e a travam (executarComLock)
// antes de ler taxas ou saldo; assim um estorno nunca se perde entre "somei as taxas" e "marquei fechado".
// Ordem fixa de travas no cancelamento: período do mês da venda, depois o período corrente (nunca o inverso).
//
// Leitura e escrita ENTRE empresas, só pelo operador do painel (exceção deliberada ao empresa_id do JWT,
// como plano e condição: a empresa-alvo vem da rota ou do período). A única escrita vinda de fluxo de
// tenant é o estorno da taxa no cancelamento da venda (estornarAposFechamento), na transação da venda.
//
// Saldo de um período = total_calculado − total_retido_mp + Σ lancamentos.valor (valor com sinal).
// Enquanto aberto, calculado e retido são vivos (taxas_venda do mês); no fechamento, congelados.
// Toda mudança grava plataforma_eventos na MESMA transação.

const MES_CORRENTE_SQL = `to_char((NOW() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM')`;

// Competência 'YYYY-MM' (API) <-> 'YYYY-MM-01' (coluna DATE, sempre como texto).
const paraData = (competencia) => `${competencia}-01`;

const num = (valor) => Number(valor ?? 0);

const COLUNAS_PERIODO = `p.id, p.empresa_id, to_char(p.competencia, 'YYYY-MM') AS competencia, p.status,
       p.total_calculado, p.total_retido_mp, to_char(p.vencimento, 'YYYY-MM-DD') AS vencimento,
       p.fechado_em, p.fechado_por`;

async function competenciaCorrente(client = db) {
    const { rows } = await client.query(`SELECT ${MES_CORRENTE_SQL} AS mes`);
    return rows[0].mes;
}

// Cria o período 'aberto' da competência se ainda não existir (idempotente; sem trava).
async function criarPeriodoSeAusente(client, empresa_id, competencia) {
    await client.query(
        `INSERT INTO periodos_taxa (empresa_id, competencia) VALUES ($1, $2::date)
         ON CONFLICT (empresa_id, competencia) DO NOTHING`,
        [empresa_id, paraData(competencia)]
    );
}

// Garante o período e executa `fn(periodo, client)` com a linha travada. Com `clienteExterno`, participa
// da transação de quem chama; sem ele, abre a própria. `periodo` é a linha crua (id, status, totais).
async function comPeriodoTravado(empresa_id, competencia, clienteExterno, fn) {
    await criarPeriodoSeAusente(clienteExterno || db, empresa_id, competencia);

    return executarComLock('periodos_taxa', { coluna: 'competencia', valor: paraData(competencia) }, empresa_id, clienteExterno, fn);
}

// Taxa apurada (canceladas fora) e retido no Mercado Pago da empresa na competência: mesma conta da tela do mês.
async function totaisVivos(client, empresa_id, competencia) {
    const { rows } = await client.query(
        `SELECT COALESCE(SUM(tv.valor), 0) AS total_calculado,
                COALESCE(SUM(${RETIDO_MP_DA_VENDA_SQL}), 0) AS total_retido_mp,
                COUNT(*)::int AS qtd_vendas
         FROM taxas_venda tv
         JOIN vendas v ON v.id = tv.venda_id AND v.empresa_id = tv.empresa_id
         WHERE tv.empresa_id = $2 AND tv.status = 'apurada'
           AND v.data >= ${INICIO_SQL} AND v.data < ${FIM_SQL}`,
        [paraData(competencia), empresa_id]
    );

    return rows[0];
}

async function saldoDoPeriodo(client, periodo_id) {
    const { rows } = await client.query(
        `SELECT p.total_calculado - p.total_retido_mp + COALESCE((SELECT SUM(l.valor) FROM lancamentos_taxa l WHERE l.periodo_id = p.id), 0) AS saldo
         FROM periodos_taxa p WHERE p.id = $1`,
        [periodo_id]
    );

    return rows[0].saldo;
}

// Pago quando o saldo zera (ou já nasce zerado/negativo: tudo retido no MP). Enquanto restar saldo: 'fechado'
// logo após o fechamento, 'parcialmente_pago' depois de um pagamento ou perdão.
async function atualizarStatusPeloSaldo(client, periodo, statusComSaldo) {
    const saldo = await saldoDoPeriodo(client, periodo.id);
    const novo = num(saldo) <= 0 ? 'pago' : statusComSaldo;

    if (novo !== periodo.status) {
        await client.query('UPDATE periodos_taxa SET status = $2 WHERE id = $1', [periodo.id, novo]);
    }

    return { status: novo, saldo };
}

async function exigirEmpresa(client, empresa_id) {
    const { rows } = await client.query('SELECT id FROM empresas WHERE id = $1', [empresa_id]);
    if (!rows.length) throw new AppError('Empresa não encontrada', 404);
}

// ---------------------------------------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------------------------------------

function fecharPeriodo({ empresa_id, competencia, responsavel, operador_id, ip }) {
    return comPeriodoTravado(empresa_id, competencia, undefined, async (periodo, client) => {
        if (periodo.status !== 'aberto') {
            return { empresa_id, periodo_id: periodo.id, status: periodo.status, ja_fechado: true };
        }

        const totais = await totaisVivos(client, empresa_id, competencia);

        // Vencimento: dia 05 do mês seguinte à competência (D-T1).
        await client.query(
            `UPDATE periodos_taxa
                SET status = 'fechado', total_calculado = $2, total_retido_mp = $3,
                    vencimento = (competencia + INTERVAL '1 month' + INTERVAL '4 days')::date,
                    fechado_em = NOW(), fechado_por = $4, fechado_por_operador_id = $5
              WHERE id = $1`,
            [periodo.id, totais.total_calculado, totais.total_retido_mp, responsavel, operador_id ?? null]
        );

        const { status, saldo } = await atualizarStatusPeloSaldo(client, { id: periodo.id, status: 'fechado' }, 'fechado');

        await painelRepository.registrarEvento({
            operador_id: operador_id ?? null,
            acao: 'taxa_periodo_fechado',
            alvo_empresa_id: empresa_id,
            detalhe: {
                periodo_id: periodo.id, competencia,
                total_calculado: totais.total_calculado, total_retido_mp: totais.total_retido_mp,
                qtd_vendas: totais.qtd_vendas, saldo, status, responsavel
            },
            ip
        }, client);

        return { empresa_id, periodo_id: periodo.id, status, saldo: num(saldo), ja_fechado: false };
    });
}

// Fecha a competência de uma empresa, ou de todas as que têm taxa no mês ou período aberto nela.
// Cada empresa na própria transação; repetir é seguro (o que já está fechado só é informado).
async function fecharCompetencia({ competencia, empresa_id, responsavel, operador_id, ip }) {
    const corrente = await competenciaCorrente();

    if (competencia >= corrente) {
        throw new AppError('Só é possível fechar um mês que já terminou (horário de Brasília).', 409);
    }

    let empresas;

    if (empresa_id) {
        await exigirEmpresa(db, empresa_id);
        empresas = [empresa_id];
    } else {
        const { rows } = await db.query(
            `SELECT tv.empresa_id
               FROM taxas_venda tv
               JOIN vendas v ON v.id = tv.venda_id AND v.empresa_id = tv.empresa_id
              WHERE v.data >= ${INICIO_SQL} AND v.data < ${FIM_SQL}
             UNION
             SELECT empresa_id FROM periodos_taxa WHERE competencia = $1::date AND status = 'aberto'
             ORDER BY 1`,
            [paraData(competencia)]
        );
        empresas = rows.map((r) => r.empresa_id);
    }

    const resultados = [];

    for (const id of empresas) {
        resultados.push(await fecharPeriodo({ empresa_id: id, competencia, responsavel, operador_id, ip }));
    }

    return {
        competencia,
        fechados: resultados.filter((r) => !r.ja_fechado).length,
        ja_fechados: resultados.filter((r) => r.ja_fechado).length,
        items: resultados
    };
}

// ---------------------------------------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------------------------------------

async function inserirLancamento(client, l) {
    const { rows } = await client.query(
        `INSERT INTO lancamentos_taxa
            (empresa_id, periodo_id, tipo, valor, venda_id, data_pagamento, forma_pagamento,
             justificativa, responsavel, operador_id, chave_idempotencia)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11)
         RETURNING id`,
        [l.empresa_id, l.periodo_id, l.tipo, l.valor, l.venda_id ?? null, l.data_pagamento ?? null,
            l.forma_pagamento ?? null, l.justificativa ?? null, l.responsavel, l.operador_id ?? null,
            l.chave_idempotencia ?? null]
    );

    return rows[0].id;
}

// Repetição com a mesma chave (duplo clique, reenvio): devolve o lançamento já gravado se for o mesmo
// pedido; chave reaproveitada para outro lançamento é conflito.
async function lancamentoPelaChave(client, empresa_id, chave) {
    if (!chave) return null;

    const { rows } = await client.query(
        `SELECT id, periodo_id, tipo, valor FROM lancamentos_taxa WHERE empresa_id = $1 AND chave_idempotencia = $2`,
        [empresa_id, chave]
    );

    return rows[0] ?? null;
}

function mesmoPedido(existente, { periodo_id, tipo, valor }) {
    return existente.periodo_id === periodo_id && existente.tipo === tipo && num(existente.valor) === num(valor);
}

const formatarReais = (valor) => num(valor).toFixed(2).replace('.', ',');

// Pagamento (T4) ou perdão (T5): só em período fechado, nunca acima do saldo.
async function lancarEmPeriodoFechado({ periodo_id, tipo, valor, data_pagamento, forma_pagamento, justificativa,
    chave_idempotencia, responsavel, operador_id, ip }) {
    const { rows } = await db.query('SELECT empresa_id FROM periodos_taxa WHERE id = $1', [periodo_id]);
    if (!rows.length) throw new AppError('Período não encontrado', 404);

    return executarComLock('periodos_taxa', { coluna: 'id', valor: periodo_id }, rows[0].empresa_id, undefined, async (periodo, client) => {
        if (!periodo) throw new AppError('Período não encontrado', 404);

        const valorLancado = -valor;
        const existente = await lancamentoPelaChave(client, periodo.empresa_id, chave_idempotencia);

        if (existente) {
            if (!mesmoPedido(existente, { periodo_id, tipo, valor: valorLancado })) {
                throw new AppError('Esta chave de idempotência já foi usada em outro lançamento.', 409);
            }

            return { lancamento_id: existente.id, repetido: true, ...(await detalhePeriodo(periodo_id, client)) };
        }

        if (periodo.status === 'aberto') {
            throw new AppError('O período ainda está aberto: feche o período antes de registrar pagamento ou perdão.', 409);
        }

        const saldo = num(await saldoDoPeriodo(client, periodo.id));

        if (saldo <= 0) throw new AppError('Este período não tem saldo a receber.', 409);
        if (valor > saldo) {
            throw new AppError(`Valor maior que o saldo do período (R$ ${formatarReais(saldo)}).`, 409);
        }

        const lancamento_id = await inserirLancamento(client, {
            empresa_id: periodo.empresa_id, periodo_id, tipo, valor: valorLancado, data_pagamento, forma_pagamento,
            justificativa, responsavel, operador_id, chave_idempotencia
        });

        const novo = await atualizarStatusPeloSaldo(client, periodo, 'parcialmente_pago');

        await painelRepository.registrarEvento({
            operador_id,
            acao: tipo === 'pagamento' ? 'taxa_pagamento_registrado' : 'taxa_perdao_registrado',
            alvo_empresa_id: periodo.empresa_id,
            detalhe: {
                periodo_id, lancamento_id, valor,
                ...(tipo === 'pagamento' ? { data_pagamento, forma_pagamento } : { justificativa }),
                saldo_anterior: saldo, saldo: num(novo.saldo), status: novo.status, responsavel
            },
            ip
        }, client);

        return { lancamento_id, repetido: false, ...(await detalhePeriodo(periodo_id, client)) };
    });
}

// Ajuste (correção, ± ) sempre no período aberto da competência corrente da empresa (T2: fechado não muda).
async function lancarAjuste({ empresa_id, valor, justificativa, venda_id, chave_idempotencia, responsavel, operador_id, ip }) {
    await exigirEmpresa(db, empresa_id);
    const competencia = await competenciaCorrente();

    return comPeriodoTravado(empresa_id, competencia, undefined, async (periodo, client) => {
        // Virada do mês entre a leitura da competência e a trava: o período pode ter sido fechado.
        if (periodo.status !== 'aberto') throw new AppError('O mês virou durante o lançamento. Tente novamente.', 409);

        const existente = await lancamentoPelaChave(client, empresa_id, chave_idempotencia);

        if (existente) {
            if (!mesmoPedido(existente, { periodo_id: periodo.id, tipo: 'ajuste', valor })) {
                throw new AppError('Esta chave de idempotência já foi usada em outro lançamento.', 409);
            }

            return { lancamento_id: existente.id, repetido: true, ...(await detalhePeriodo(periodo.id, client)) };
        }

        if (venda_id) {
            const { rows } = await client.query('SELECT 1 FROM vendas WHERE id = $1 AND empresa_id = $2', [venda_id, empresa_id]);
            if (!rows.length) throw new AppError('Venda não encontrada nesta empresa', 404);
        }

        const lancamento_id = await inserirLancamento(client, {
            empresa_id, periodo_id: periodo.id, tipo: 'ajuste', valor, venda_id, justificativa,
            responsavel, operador_id, chave_idempotencia
        });

        await painelRepository.registrarEvento({
            operador_id,
            acao: 'taxa_ajuste_registrado',
            alvo_empresa_id: empresa_id,
            detalhe: { periodo_id: periodo.id, competencia, lancamento_id, valor, venda_id: venda_id ?? null, justificativa, responsavel },
            ip
        }, client);

        return { lancamento_id, repetido: false, ...(await detalhePeriodo(periodo.id, client)) };
    });
}

// Cancelamento de venda (fluxo do tenant, MESMA transação da venda, depois de marcar taxas_venda como
// estornada). Se o mês da venda ainda está aberto, nada a fazer: o fechamento já não soma a taxa estornada.
// Se já foi fechado (T2/T3), o estorno vira lançamento negativo no período aberto corrente.
//
// Só a parte da taxa que NÃO foi retida no Mercado Pago é estornada: o retido nunca entrou no saldo
// (foi abatido no fechamento). Se o Mercado Pago devolver ou não a comissão na devolução do Pix, isso é
// tratado pela conciliação (divergência sinalizada, decisão do PO), nunca por crédito automático aqui.
// O retido considera a cobrança paga ou já devolvida, para a devolução do Pix não inflar o estorno.
async function estornarAposFechamento(client, { venda_id, empresa_id, responsavel }) {
    const { rows } = await client.query(
        `SELECT tv.valor,
                COALESCE((SELECT SUM(cp.taxa_plataforma) FROM cobrancas_pagamento cp
                           WHERE cp.venda_id = tv.venda_id AND cp.empresa_id = tv.empresa_id
                             AND cp.metodo = 'pix' AND cp.status IN ('pago', 'estornado')), 0) AS retido,
                to_char((v.data AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS competencia
         FROM taxas_venda tv
         JOIN vendas v ON v.id = tv.venda_id AND v.empresa_id = tv.empresa_id
         WHERE tv.venda_id = $1 AND tv.empresa_id = $2`,
        [venda_id, empresa_id]
    );

    const taxa = rows[0];
    if (!taxa) return null;

    // Mês corrente nunca está fechado (só se fecha mês que terminou): nada a travar nem lançar.
    const competenciaAtual = await competenciaCorrente(client);
    if (taxa.competencia >= competenciaAtual) return null;

    // Trava (criando se preciso) o período do mês da venda: espera um fechamento em andamento terminar.
    const doMesDaVenda = await comPeriodoTravado(empresa_id, taxa.competencia, client, async (p) => p);
    if (doMesDaVenda.status === 'aberto') return null;

    const aEstornar = Math.round((num(taxa.valor) - num(taxa.retido)) * 100) / 100;
    if (aEstornar <= 0) return null;

    const periodo = await comPeriodoTravado(empresa_id, competenciaAtual, client, async (p) => p);

    const lancamento_id = await inserirLancamento(client, {
        empresa_id, periodo_id: periodo.id, tipo: 'estorno_venda', valor: -aEstornar, venda_id, responsavel
    });

    await painelRepository.registrarEvento({
        acao: 'taxa_estorno_venda',
        alvo_empresa_id: empresa_id,
        detalhe: {
            periodo_id: periodo.id, competencia: competenciaAtual, competencia_venda: taxa.competencia,
            lancamento_id, venda_id, valor: -aEstornar, responsavel
        }
    }, client);

    return { lancamento_id, periodo_id: periodo.id, valor: -aEstornar };
}

// ---------------------------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------------------------

function montarLinha(r) {
    const saldo = num(r.saldo);

    return {
        empresa_id: r.empresa_id,
        empresa_nome: r.empresa_nome,
        periodo_id: r.periodo_id,
        competencia: r.competencia,
        status: r.status,
        vencimento: r.vencimento,
        fechado_em: r.fechado_em,
        qtd_vendas: num(r.qtd_vendas),
        devido: num(r.devido),
        retido_mp: num(r.retido_mp),
        pagamentos: -num(r.pagamentos),
        perdoes: -num(r.perdoes),
        ajustes: num(r.ajustes),
        estornos: -num(r.estornos),
        saldo,
        a_receber: Math.max(0, saldo),
        // Retido no MP maior que o calculado: só sinaliza (decisão do PO), nunca vira crédito automático.
        retido_maior_que_devido: num(r.retido_mp) > num(r.devido)
    };
}

const SOMA_LANCAMENTOS_SQL = `
    SELECT l.periodo_id,
           SUM(l.valor) AS total,
           COALESCE(SUM(l.valor) FILTER (WHERE l.tipo = 'pagamento'), 0) AS pagamentos,
           COALESCE(SUM(l.valor) FILTER (WHERE l.tipo = 'perdao'), 0) AS perdoes,
           COALESCE(SUM(l.valor) FILTER (WHERE l.tipo = 'ajuste'), 0) AS ajustes,
           COALESCE(SUM(l.valor) FILTER (WHERE l.tipo = 'estorno_venda'), 0) AS estornos
    FROM lancamentos_taxa l GROUP BY l.periodo_id`;

// Uma competência, por empresa: período (se existir) e valores. Aberto/sem período = valores vivos.
async function resumoCompetencia({ competencia, empresa_id, status }) {
    const valores = [paraData(competencia)];
    const filtros = [];

    if (empresa_id) {
        valores.push(empresa_id);
        filtros.push(`r.empresa_id = $${valores.length}`);
    }

    if (status) {
        valores.push(status);
        filtros.push(`r.status = $${valores.length}`);
    }

    const { rows } = await db.query(
        `WITH vivos AS (
             SELECT tv.empresa_id, SUM(tv.valor) AS calculado, SUM(${RETIDO_MP_DA_VENDA_SQL}) AS retido, COUNT(*) AS qtd
             FROM taxas_venda tv
             JOIN vendas v ON v.id = tv.venda_id AND v.empresa_id = tv.empresa_id
             WHERE tv.status = 'apurada' AND v.data >= ${INICIO_SQL} AND v.data < ${FIM_SQL}
             GROUP BY tv.empresa_id
         ), lanc AS (${SOMA_LANCAMENTOS_SQL}),
         r AS (
             SELECT e.id AS empresa_id, e.nome AS empresa_nome,
                    p.id AS periodo_id, to_char($1::date, 'YYYY-MM') AS competencia,
                    COALESCE(p.status, 'aberto') AS status,
                    to_char(p.vencimento, 'YYYY-MM-DD') AS vencimento, p.fechado_em,
                    COALESCE(vv.qtd, 0) AS qtd_vendas,
                    CASE WHEN COALESCE(p.status, 'aberto') = 'aberto' THEN COALESCE(vv.calculado, 0) ELSE p.total_calculado END AS devido,
                    CASE WHEN COALESCE(p.status, 'aberto') = 'aberto' THEN COALESCE(vv.retido, 0) ELSE p.total_retido_mp END AS retido_mp,
                    COALESCE(l.pagamentos, 0) AS pagamentos, COALESCE(l.perdoes, 0) AS perdoes,
                    COALESCE(l.ajustes, 0) AS ajustes, COALESCE(l.estornos, 0) AS estornos,
                    COALESCE(l.total, 0) AS lancado
             FROM empresas e
             LEFT JOIN periodos_taxa p ON p.empresa_id = e.id AND p.competencia = $1::date
             LEFT JOIN vivos vv ON vv.empresa_id = e.id
             LEFT JOIN lanc l ON l.periodo_id = p.id
             WHERE e.status = 'ativa' OR p.id IS NOT NULL
         )
         SELECT r.*, r.devido - r.retido_mp + r.lancado AS saldo
         FROM r
         ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
         ORDER BY saldo DESC, r.empresa_nome ASC`,
        valores
    );

    const items = rows.map(montarLinha);
    const soma = (campo) => Math.round(items.reduce((acc, i) => acc + i[campo] * 100, 0)) / 100;

    return {
        competencia,
        competencia_corrente: await competenciaCorrente(),
        items,
        totais: {
            devido: soma('devido'),
            retido_mp: soma('retido_mp'),
            pagamentos: soma('pagamentos'),
            perdoes: soma('perdoes'),
            ajustes: soma('ajustes'),
            estornos: soma('estornos'),
            a_receber: soma('a_receber')
        }
    };
}

// Um período com os lançamentos (trilha de cada um: responsável e data).
async function detalhePeriodo(periodo_id, client = db) {
    const { rows } = await client.query(
        `SELECT ${COLUNAS_PERIODO}, e.nome AS empresa_nome FROM periodos_taxa p
         JOIN empresas e ON e.id = p.empresa_id WHERE p.id = $1`,
        [periodo_id]
    );
    const periodo = rows[0];

    if (!periodo) throw new AppError('Período não encontrado', 404);

    const { rows: lancamentos } = await client.query(
        `SELECT id, tipo, valor, venda_id, to_char(data_pagamento, 'YYYY-MM-DD') AS data_pagamento, forma_pagamento,
                justificativa, responsavel, criado_em
         FROM lancamentos_taxa WHERE periodo_id = $1 ORDER BY id`,
        [periodo_id]
    );

    let devido = periodo.total_calculado;
    let retido = periodo.total_retido_mp;
    let qtd_vendas = null;

    if (periodo.status === 'aberto') {
        const vivos = await totaisVivos(client, periodo.empresa_id, periodo.competencia);
        devido = vivos.total_calculado;
        retido = vivos.total_retido_mp;
        qtd_vendas = vivos.qtd_vendas;
    }

    const lancado = lancamentos.reduce((acc, l) => acc + Math.round(num(l.valor) * 100), 0) / 100;
    const saldo = Math.round((num(devido) - num(retido) + lancado) * 100) / 100;

    return {
        periodo: {
            id: periodo.id,
            empresa_id: periodo.empresa_id,
            empresa_nome: periodo.empresa_nome,
            competencia: periodo.competencia,
            status: periodo.status,
            vencimento: periodo.vencimento,
            fechado_em: periodo.fechado_em,
            fechado_por: periodo.fechado_por,
            qtd_vendas,
            devido: num(devido),
            retido_mp: num(retido),
            saldo,
            a_receber: Math.max(0, saldo),
            retido_maior_que_devido: num(retido) > num(devido)
        },
        lancamentos: lancamentos.map((l) => ({ ...l, valor: num(l.valor) }))
    };
}

module.exports = {
    competenciaCorrente,
    fecharCompetencia,
    lancarEmPeriodoFechado,
    lancarAjuste,
    estornarAposFechamento,
    resumoCompetencia,
    detalhePeriodo
};

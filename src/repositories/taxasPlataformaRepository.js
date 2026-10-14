const db = require('../config/db');
const AppError = require('../errors/AppError');
const { reaisParaCentavos, calcularTaxaPlataformaCentavos, centavosParaReais } = require('../utils/taxaPlataforma');

// "Hoje" é calculado NO BANCO, no fuso do negócio: nada de Date do Node (a
// serialização do pg usa o fuso local do processo) e uma venda às 22h em
// Brasília não cai no "dia seguinte" do UTC.
const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

const VIGENTE_SQL = `ativo = true
           AND vigencia_inicio <= ${HOJE_SQL}
           AND (vigencia_fim IS NULL OR vigencia_fim >= ${HOJE_SQL})`;

const PLANO_PADRAO = 'sem_mensalidade';

// Política global (sem empresa_id) vigente de UM plano.
async function buscarPoliticaVigente(plano_id, client) {
    const { rows } = await client.query(
        `SELECT id, tipo, percentual
         FROM politicas_taxa_plataforma
         WHERE plano_id = $1
           AND ${VIGENTE_SQL}
         ORDER BY vigencia_inicio DESC, id DESC
         LIMIT 1`,
        [plano_id]
    );

    return rows[0] ?? null;
}

// Condição individual negociada (exceção) vigente da empresa. Condição expirada
// ou futura não casa: volta ao padrão do plano.
async function buscarCondicaoVigente(empresa_id, client) {
    const { rows } = await client.query(
        `SELECT id, tipo, percentual
         FROM condicoes_comerciais_empresa
         WHERE empresa_id = $1
           AND ${VIGENTE_SQL}
         ORDER BY vigencia_inicio DESC, id DESC
         LIMIT 1`,
        [empresa_id]
    );

    return rows[0] ?? null;
}

// Plano vigente da empresa. Sem registro vigente (empresa nunca cadastrada,
// plano encerrado/expirado): padrão sem mensalidade, com origem explícita
// 'padrao_sem_plano' (empresa_plano_id nulo). Plano inativo é configuração
// inválida e NÃO cai no padrão em silêncio.
async function buscarPlanoDaEmpresa(empresa_id, client) {
    const { rows } = await client.query(
        `SELECT ep.id AS empresa_plano_id, p.id AS plano_id, p.codigo, p.ativo
         FROM empresa_planos ep
         JOIN planos_comerciais p ON p.id = ep.plano_id
         WHERE ep.empresa_id = $1
           AND ep.ativo = true
           AND ep.vigencia_inicio <= ${HOJE_SQL}
           AND (ep.vigencia_fim IS NULL OR ep.vigencia_fim >= ${HOJE_SQL})
         ORDER BY ep.vigencia_inicio DESC, ep.id DESC
         LIMIT 1`,
        [empresa_id]
    );

    if (rows.length) {
        if (!rows[0].ativo) {
            throw new AppError(
                `Plano comercial inativo (empresa ${empresa_id}, plano ${rows[0].codigo})`,
                500
            );
        }

        return { ...rows[0], origem: 'plano_padrao' };
    }

    const { rows: padraoRows } = await client.query(
        `SELECT id AS plano_id, codigo, ativo FROM planos_comerciais WHERE codigo = $1`,
        [PLANO_PADRAO]
    );

    if (!padraoRows.length || !padraoRows[0].ativo) {
        throw new AppError(`Plano comercial padrão ausente ou inativo (empresa ${empresa_id})`, 500);
    }

    return { ...padraoRows[0], empresa_plano_id: null, origem: 'padrao_sem_plano' };
}

// Decide a regra da venda, sempre pela empresa autenticada (nunca por dado do
// cliente). Prioridade: condição individual > política do plano > padrão sem
// mensalidade. A política do plano é sempre exigida (é a "política aplicada"
// congelada na taxa); sem ela, erro 500 e rollback da venda.
async function resolverRegra(empresa_id, client) {
    const plano = await buscarPlanoDaEmpresa(empresa_id, client);
    const politica = await buscarPoliticaVigente(plano.plano_id, client);

    if (!politica) {
        throw new AppError(
            `Nenhuma política de taxa da plataforma vigente para o plano ${plano.codigo} (empresa ${empresa_id})`,
            500
        );
    }

    const condicao = await buscarCondicaoVigente(empresa_id, client);

    if (condicao) {
        return {
            origem: 'excecao_empresa',
            plano_id: plano.plano_id,
            empresa_plano_id: plano.empresa_plano_id,
            politica_id: politica.id,
            condicao_id: condicao.id,
            tipo: condicao.tipo,
            percentual: condicao.percentual
        };
    }

    return {
        origem: plano.origem,
        plano_id: plano.plano_id,
        empresa_plano_id: plano.empresa_plano_id,
        politica_id: politica.id,
        condicao_id: null,
        tipo: politica.tipo,
        percentual: politica.percentual
    };
}

// Gera a taxa da venda DENTRO da transação da venda (client obrigatório).
// Qualquer falha — inclusive ausência de política vigente — lança erro: o
// ROLLBACK de vendasRepository.criar desfaz venda, itens, estoque e pagamentos.
// O erro é 500 (a resposta ao cliente é genérica; o detalhe vai só para o log).
async function apurar({ venda_id, empresa_id, total }, client) {
    if (!client) {
        throw new Error('taxasPlataformaRepository.apurar exige o client da transação da venda');
    }

    const regra = await resolverRegra(empresa_id, client);

    const baseCentavos = reaisParaCentavos(total);
    const valorCentavos = calcularTaxaPlataformaCentavos(baseCentavos, regra.percentual);

    const { rows } = await client.query(
        `INSERT INTO taxas_venda
            (venda_id, empresa_id, politica_id, tipo, percentual, base_calculo, valor,
             plano_id, empresa_plano_id, condicao_id, origem)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
            venda_id,
            empresa_id,
            regra.politica_id,
            regra.tipo,
            regra.percentual,
            centavosParaReais(baseCentavos),
            centavosParaReais(valorCentavos),
            regra.plano_id,
            regra.empresa_plano_id,
            regra.condicao_id,
            regra.origem
        ]
    );

    return rows[0];
}

// Cancelamento da venda: marca a taxa como estornada (nunca apaga). Venda
// histórica sem linha, ou já estornada, é no-op e não bloqueia o cancelamento.
async function estornarPorVendaId(venda_id, empresa_id, client) {
    const { rowCount } = await client.query(
        `UPDATE taxas_venda
         SET status = 'estornada', estornado_em = NOW()
         WHERE venda_id = $1 AND empresa_id = $2 AND status = 'apurada'`,
        [venda_id, empresa_id]
    );

    return rowCount;
}

// Leitura administrativa (admin do tenant): filtra SEMPRE por empresa_id.
async function listarPaginado({ limit, offset, empresa_id, data_inicio, data_fim }) {
    const condicoes = ['t.empresa_id = $1'];
    const valores = [empresa_id];

    if (data_inicio !== undefined) {
        valores.push(data_inicio);
        condicoes.push(`v.data::date >= $${valores.length}`);
    }

    if (data_fim !== undefined) {
        valores.push(data_fim);
        condicoes.push(`v.data::date <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;
    const valoresListagem = [...valores, limit, offset];

    const { rows } = await db.query(
        `SELECT t.id, t.venda_id, v.data AS data_venda, t.percentual, t.base_calculo,
                t.valor, t.status, t.criado_em, t.estornado_em
         FROM taxas_venda t
         JOIN vendas v ON v.id = t.venda_id AND v.empresa_id = t.empresa_id
         ${where}
         ORDER BY t.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    // Totais só das taxas apuradas (estornadas pelo cancelamento não contam).
    const { rows: totaisRows } = await db.query(
        `SELECT COUNT(*) AS quantidade,
                COALESCE(SUM(t.base_calculo) FILTER (WHERE t.status = 'apurada'), 0) AS total_base,
                COALESCE(SUM(t.valor) FILTER (WHERE t.status = 'apurada'), 0) AS total_taxa
         FROM taxas_venda t
         JOIN vendas v ON v.id = t.venda_id AND v.empresa_id = t.empresa_id
         ${where}`,
        valores
    );

    return {
        items: rows,
        total: Number(totaisRows[0].quantidade),
        totais: {
            total_base: totaisRows[0].total_base,
            total_taxa: totaisRows[0].total_taxa
        }
    };
}

module.exports = {
    buscarPoliticaVigente,
    buscarCondicaoVigente,
    buscarPlanoDaEmpresa,
    resolverRegra,
    apurar,
    estornarPorVendaId,
    listarPaginado
};

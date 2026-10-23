const db = require('../config/db');
const AppError = require('../errors/AppError');
const { calcularComissaoCentavos, centavosParaReais } = require('../utils/comissao');

// Papéis que nunca vendem: ficam fora da lista de percentuais.
const PAPEIS_SEM_VENDA = ['estoquista', 'faturista'];

// Percentual vigente do vendedor: o próprio (inclusive 0, que desliga a comissão dele)
// prevalece sobre o padrão da empresa (usuario_id IS NULL). Filtra SEMPRE por empresa_id.
async function buscarPercentualVigente(empresa_id, usuario_id, client) {
    const { rows } = await client.query(
        `SELECT percentual
         FROM comissao_percentuais
         WHERE empresa_id = $1
           AND (usuario_id = $2 OR usuario_id IS NULL)
         ORDER BY (usuario_id IS NULL) ASC
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

    return rows[0] ?? null;
}

// Cancelamento da venda: marca a comissão como estornada (nunca apaga). Venda sem
// comissão (anterior ao módulo, sem percentual) ou já estornada é no-op.
async function estornarPorVendaId(venda_id, empresa_id, client) {
    const { rowCount } = await client.query(
        `UPDATE comissoes_venda
         SET status = 'estornada', estornado_em = NOW()
         WHERE venda_id = $1 AND empresa_id = $2 AND status = 'apurada'`,
        [venda_id, empresa_id]
    );

    return rowCount;
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
async function listarDoUsuario({ limit, offset, empresa_id, usuario_id, data_inicio, data_fim }) {
    const valores = [empresa_id, usuario_id];
    const condicoes = ['c.empresa_id = $1', 'c.usuario_id = $2', ...filtroPeriodo(valores, { data_inicio, data_fim })];
    const where = `WHERE ${condicoes.join(' AND ')}`;
    const valoresListagem = [...valores, limit, offset];

    const { rows } = await db.query(
        `SELECT c.id, c.venda_id, v.data AS data_venda, c.percentual, c.base_calculo,
                c.valor, c.status, c.criado_em, c.estornado_em
         FROM comissoes_venda c
         JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         ${where}
         ORDER BY c.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: totaisRows } = await db.query(
        `SELECT COUNT(*) AS quantidade,
                COALESCE(SUM(c.base_calculo) FILTER (WHERE c.status = 'apurada'), 0) AS total_base,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'apurada'), 0) AS total_comissao,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'estornada'), 0) AS total_estornado
         FROM comissoes_venda c
         JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id
         ${where}`,
        valores
    );

    return {
        items: rows,
        total: Number(totaisRows[0].quantidade),
        totais: {
            total_base: totaisRows[0].total_base,
            total_comissao: totaisRows[0].total_comissao,
            total_estornado: totaisRows[0].total_estornado
        }
    };
}

// Resumo por vendedor de TODA a empresa (gerente/admin). Inclui quem ainda não vendeu no
// período, com o percentual vigente de cada um. Filtra SEMPRE por empresa_id.
async function resumoEquipe({ empresa_id, data_inicio, data_fim }) {
    const valores = [empresa_id];
    const condicoesPeriodo = filtroPeriodo(valores, { data_inicio, data_fim });
    const filtroVenda = condicoesPeriodo.length ? `AND ${condicoesPeriodo.join(' AND ')}` : '';

    valores.push(PAPEIS_SEM_VENDA);
    const idxPapeis = valores.length;

    const { rows } = await db.query(
        `SELECT u.id AS usuario_id, u.nome, u.papel AS cargo,
                COALESCE(
                    (SELECT cp.percentual FROM comissao_percentuais cp
                      WHERE cp.empresa_id = u.empresa_id AND cp.usuario_id = u.id),
                    (SELECT cp.percentual FROM comissao_percentuais cp
                      WHERE cp.empresa_id = u.empresa_id AND cp.usuario_id IS NULL)
                ) AS percentual,
                COUNT(c.id) FILTER (WHERE c.status = 'apurada') AS quantidade_vendas,
                COALESCE(SUM(c.base_calculo) FILTER (WHERE c.status = 'apurada'), 0) AS total_base,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'apurada'), 0) AS total_comissao,
                COALESCE(SUM(c.valor) FILTER (WHERE c.status = 'estornada'), 0) AS total_estornado
         FROM usuarios u
         LEFT JOIN comissoes_venda c
                ON c.usuario_id = u.id AND c.empresa_id = u.empresa_id
               AND EXISTS (
                    SELECT 1 FROM vendas v
                     WHERE v.id = c.venda_id AND v.empresa_id = c.empresa_id ${filtroVenda}
               )
         WHERE u.empresa_id = $1
           AND NOT (u.papel = ANY($${idxPapeis}))
         GROUP BY u.id, u.nome, u.papel, u.empresa_id
         ORDER BY total_comissao DESC, u.nome ASC`,
        valores
    );

    const totais = rows.reduce((acc, linha) => ({
        total_base: acc.total_base + Number(linha.total_base),
        total_comissao: acc.total_comissao + Number(linha.total_comissao),
        total_estornado: acc.total_estornado + Number(linha.total_estornado)
    }), { total_base: 0, total_comissao: 0, total_estornado: 0 });

    return {
        items: rows,
        totais: {
            total_base: totais.total_base.toFixed(2),
            total_comissao: totais.total_comissao.toFixed(2),
            total_estornado: totais.total_estornado.toFixed(2)
        }
    };
}

// Configuração de percentuais (admin): padrão da empresa + um item por usuário que vende.
async function listarPercentuais(empresa_id) {
    const { rows: padraoRows } = await db.query(
        `SELECT percentual FROM comissao_percentuais
         WHERE empresa_id = $1 AND usuario_id IS NULL`,
        [empresa_id]
    );

    const { rows } = await db.query(
        `SELECT u.id AS usuario_id, u.nome, u.papel AS cargo, cp.percentual
         FROM usuarios u
         LEFT JOIN comissao_percentuais cp
                ON cp.empresa_id = u.empresa_id AND cp.usuario_id = u.id
         WHERE u.empresa_id = $1
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
    estornarPorVendaId,
    listarDoUsuario,
    resumoEquipe,
    listarPercentuais,
    definirPercentual
};

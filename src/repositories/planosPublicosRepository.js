const db = require('../config/db');

const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

// Dados comerciais PÚBLICOS (sem login, sem empresa): só planos marcados `exibir_no_site`, o que cada um inclui
// (limite de usuários, percentual vigente sobre o Pix e funcionalidades) e o catálogo de funcionalidades.
// Preço de mensalidade NÃO está aqui: o backend só publica o que ele mesmo aplica; o valor de lançamento é
// do site. Nada por empresa, nenhum id interno.
async function listar() {
    const { rows: planos } = await db.query(
        `SELECT p.codigo, p.nome, p.nome_joias, p.limite_usuarios, p.tem_mensalidade,
                (SELECT t.percentual::text FROM politicas_taxa_plataforma t
                 WHERE t.plano_id = p.id AND t.ativo = true
                   AND t.vigencia_inicio <= ${HOJE_SQL}
                   AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= ${HOJE_SQL})
                 ORDER BY t.vigencia_inicio DESC, t.id DESC LIMIT 1) AS percentual_pix,
                ARRAY(SELECT pf.funcionalidade FROM plano_funcionalidades pf
                      WHERE pf.plano_id = p.id ORDER BY pf.funcionalidade) AS funcionalidades
         FROM planos_comerciais p
         WHERE p.ativo = true AND p.exibir_no_site = true
         ORDER BY p.id`
    );

    const { rows: funcionalidades } = await db.query(
        `SELECT codigo, nome, tipo, vendavel FROM funcionalidades ORDER BY tipo DESC, codigo`
    );

    return { planos, funcionalidades };
}

module.exports = { listar };

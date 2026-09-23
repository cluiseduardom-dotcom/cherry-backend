const db = require('../config/db');

async function buscarAtiva(empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT * FROM configuracoes_sku
         WHERE empresa_id = $1 AND ativo = true
         LIMIT 1`,
        [empresa_id]
    );

    if (!rows.length) return null;

    const config = rows[0];
    const { rows: segmentos } = await client.query(
        `SELECT *
         FROM configuracoes_sku_segmentos
         WHERE configuracao_id = $1
         ORDER BY ordem ASC`,
        [config.id]
    );

    return { ...config, segmentos };
}

async function criar(dados, client = db) {
    const { rows } = await client.query(
        `INSERT INTO configuracoes_sku
         (empresa_id, nome, tipo_sku, separador, prefixo, sufixo,
          tamanho_sequencia, inicio_sequencia, ativo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
         RETURNING *`,
        [
            dados.empresa_id,
            dados.nome,
            dados.tipo_sku,
            dados.separador,
            dados.prefixo,
            dados.sufixo,
            dados.tamanho_sequencia,
            dados.inicio_sequencia
        ]
    );

    return rows[0];
}

async function atualizar(id, empresa_id, dados, client = db) {
    const { rows } = await client.query(
        `UPDATE configuracoes_sku
         SET nome = $1,
             tipo_sku = $2,
             separador = $3,
             prefixo = $4,
             sufixo = $5,
             tamanho_sequencia = $6,
             inicio_sequencia = $7,
             atualizado_em = NOW()
         WHERE id = $8 AND empresa_id = $9 AND ativo = true
         RETURNING *`,
        [
            dados.nome,
            dados.tipo_sku,
            dados.separador,
            dados.prefixo,
            dados.sufixo,
            dados.tamanho_sequencia,
            dados.inicio_sequencia,
            id,
            empresa_id
        ]
    );

    return rows.length ? rows[0] : null;
}

async function substituirSegmentos(configuracao_id, segmentos, client = db) {
    await client.query(
        `DELETE FROM configuracoes_sku_segmentos WHERE configuracao_id = $1`,
        [configuracao_id]
    );

    for (const segmento of segmentos) {
        await client.query(
            `INSERT INTO configuracoes_sku_segmentos
             (configuracao_id, nivel, ordem, nome, obrigatorio, participa_sku)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
                configuracao_id,
                segmento.nivel,
                segmento.ordem,
                segmento.nome,
                segmento.obrigatorio,
                segmento.participa_sku
            ]
        );
    }
}

module.exports = {
    buscarAtiva,
    criar,
    atualizar,
    substituirSegmentos
};

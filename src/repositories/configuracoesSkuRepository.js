const db = require('../config/db');
const AppError = require('../errors/AppError');

async function listar(empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT * FROM configuracoes_sku
         WHERE empresa_id = $1 AND ativo = true
         ORDER BY padrao DESC, id ASC`,
        [empresa_id]
    );

    const resultado = [];
    for (const config of rows) {
        const { rows: segmentos } = await client.query(
            `SELECT * FROM configuracoes_sku_segmentos
             WHERE configuracao_id = $1
             ORDER BY ordem ASC`,
            [config.id]
        );
        resultado.push({ ...config, segmentos });
    }
    return resultado;
}

async function buscarAtiva(empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT * FROM configuracoes_sku
         WHERE empresa_id = $1 AND ativo = true AND padrao = true
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

async function buscarParaCategorias(categoriaIds, empresa_id, client = db) {
    if (!categoriaIds.length) return buscarAtiva(empresa_id, client);

    const { rows } = await client.query(
        `SELECT DISTINCT configuracao_sku_id
         FROM categorias_produto
         WHERE id = ANY($1::int[])
           AND empresa_id = $2
           AND deletado_em IS NULL
           AND configuracao_sku_id IS NOT NULL`,
        [categoriaIds, empresa_id]
    );

    if (rows.length > 1) {
        throw new AppError('As categorias selecionadas pertencem a padrões de SKU diferentes', 409);
    }

    if (!rows.length) return buscarAtiva(empresa_id, client);

    const { rows: configs } = await client.query(
        `SELECT * FROM configuracoes_sku
         WHERE id = $1 AND empresa_id = $2 AND ativo = true
         LIMIT 1`,
        [rows[0].configuracao_sku_id, empresa_id]
    );

    if (!configs.length) return buscarAtiva(empresa_id, client);

    const config = configs[0];
    const { rows: segmentos } = await client.query(
        `SELECT * FROM configuracoes_sku_segmentos
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
          tamanho_sequencia, inicio_sequencia, ativo, padrao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)
         RETURNING *`,
        [
            dados.empresa_id,
            dados.nome,
            dados.tipo_sku,
            dados.separador,
            dados.prefixo,
            dados.sufixo,
            dados.tamanho_sequencia,
            dados.inicio_sequencia,
            dados.padrao !== false
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
             padrao = $8,
             atualizado_em = NOW()
         WHERE id = $9 AND empresa_id = $10 AND ativo = true
         RETURNING *`,
        [
            dados.nome,
            dados.tipo_sku,
            dados.separador,
            dados.prefixo,
            dados.sufixo,
            dados.tamanho_sequencia,
            dados.inicio_sequencia,
            dados.padrao !== false,
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
    listar,
    buscarAtiva,
    buscarParaCategorias,
    criar,
    atualizar,
    substituirSegmentos
};

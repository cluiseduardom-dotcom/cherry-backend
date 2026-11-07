async function incrementarContador(chaveCombinacao, empresa_id, configuracao_id, inicioSequencia, client) {
    const { rows } = await client.query(
        `INSERT INTO sequencias_sku
         (empresa_id, configuracao_id, chave_combinacao, contador)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (empresa_id, configuracao_id, chave_combinacao)
         DO UPDATE SET contador = sequencias_sku.contador + 1
         RETURNING contador`,
        [empresa_id, configuracao_id, chaveCombinacao, inicioSequencia]
    );

    return rows[0].contador;
}

// SKU já ocupado na empresa: em um produto (mesmo inativo) ou no histórico,
// seja como SKU atual ou como SKU anterior (pode estar em etiqueta impressa).
async function skuEmUso(sku, empresa_id, client) {
    const { rows } = await client.query(
        `SELECT 1 FROM produtos WHERE empresa_id = $1 AND sku = $2
         UNION ALL
         SELECT 1 FROM historico_sku
          WHERE empresa_id = $1 AND (sku = $2 OR sku_anterior = $2)
         LIMIT 1`,
        [empresa_id, sku]
    );

    return rows.length > 0;
}

module.exports = { incrementarContador, skuEmUso };

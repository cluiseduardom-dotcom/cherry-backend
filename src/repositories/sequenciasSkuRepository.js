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

module.exports = { incrementarContador };

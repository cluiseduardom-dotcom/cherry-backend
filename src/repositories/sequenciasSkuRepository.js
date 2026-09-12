async function incrementarContador(chaveCombinacao, empresa_id, client) {
    const { rows } = await client.query(
        `INSERT INTO sequencias_sku (empresa_id, chave_combinacao, contador)
         VALUES ($1, $2, 1)
         ON CONFLICT (empresa_id, chave_combinacao)
         DO UPDATE SET contador = sequencias_sku.contador + 1
         RETURNING contador`,
        [empresa_id, chaveCombinacao]
    );

    return rows[0].contador;
}

module.exports = { incrementarContador };

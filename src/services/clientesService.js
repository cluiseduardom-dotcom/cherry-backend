exports.getRankingClientes = () => {
  return `
    SELECT 
      c.id,
      c.nome,

      COUNT(v.id) AS total_compras,

      COALESCE(SUM(v.total), 0) AS total_gasto,

      ROUND(AVG(v.total), 2) AS ticket_medio

    FROM clientes c
    LEFT JOIN vendas v ON v.cliente_id = c.id

    GROUP BY c.id, c.nome
    ORDER BY total_gasto DESC
  `;
};
exports.getResumo = () => {
  return `
    SELECT 
      COUNT(*) AS total_vendas,
      COALESCE(SUM(total), 0) AS faturamento,
      COALESCE(AVG(total), 0) AS ticket_medio
    FROM vendas
  `;
};

exports.getPorDia = () => {
  return `
    SELECT 
      DATE(data) AS dia,
      COALESCE(SUM(total), 0) AS faturamento,
      COUNT(*) AS total_vendas
    FROM vendas
    GROUP BY DATE(data)
    ORDER BY dia DESC
  `;
};

exports.getPorMes = () => {
  return `
    SELECT
      TO_CHAR(data, 'YYYY-MM') AS mes,
      COALESCE(SUM(total), 0) AS faturamento,
      COUNT(*) AS total_vendas
    FROM vendas
    GROUP BY mes
    ORDER BY mes DESC
  `;
};

exports.getMaisVendidosPeriodo = () => {
  return `
    SELECT 
      p.id,
      p.nome,
      COALESCE(SUM(iv.quantidade), 0) AS total_vendido
    FROM itens_venda iv
    JOIN produtos p ON p.id = iv.produto_id
    GROUP BY p.id, p.nome
    ORDER BY total_vendido DESC
    LIMIT 10
  `;
};
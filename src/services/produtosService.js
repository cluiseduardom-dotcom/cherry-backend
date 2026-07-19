exports.getInteligenciaSQL = () => {
  return `
    SELECT 
      p.id,
      p.nome,

      COALESCE(SUM(iv.quantidade), 0) AS total_vendido,

      (p.preco_venda - p.custo) AS lucro_unitario,

      CASE 
        WHEN COALESCE(SUM(iv.quantidade),0) >= 20 
             AND (p.preco_venda - p.custo) > 0 
          THEN 'MANTER'

        WHEN COALESCE(SUM(iv.quantidade),0) >= 10 
          THEN 'AJUSTAR PREÇO'

        ELSE 'LIQUIDAR'
      END AS decisao

    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id

    GROUP BY p.id, p.nome, p.custo, p.preco_venda
  `;
};

exports.getMaisVendidos = () => {
  return `
    SELECT 
      p.id,
      p.nome,
      SUM(iv.quantidade) AS total_vendido,
      SUM(iv.quantidade * iv.preco_unitario) AS faturamento
    FROM itens_venda iv
    JOIN produtos p ON p.id = iv.produto_id
    GROUP BY p.id, p.nome
    ORDER BY total_vendido DESC
    LIMIT 10
  `;
};

exports.getCurvaABC = () => {
  return `
    SELECT
      p.id,
      p.nome,
      SUM(iv.quantidade * iv.preco_unitario) AS faturamento,
      CASE
        WHEN SUM(iv.quantidade * iv.preco_unitario) >= 1000 THEN 'A'
        WHEN SUM(iv.quantidade * iv.preco_unitario) >= 300 THEN 'B'
        ELSE 'C'
      END AS curva
    FROM itens_venda iv
    JOIN produtos p ON p.id = iv.produto_id
    GROUP BY p.id, p.nome
  `;
};

exports.getReposicao = () => {
  return `
    SELECT 
      p.id,
      p.nome,
      COALESCE(SUM(iv.quantidade),0) AS vendido,
      CASE 
        WHEN COALESCE(SUM(iv.quantidade),0) < 5 THEN 'REPOR URGENTE'
        WHEN COALESCE(SUM(iv.quantidade),0) < 10 THEN 'ATENÇÃO'
        ELSE 'OK'
      END AS status
    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id
    GROUP BY p.id, p.nome
  `;
};

exports.getSugestaoPreco = () => {
  return `
    SELECT 
      p.id,
      p.nome,
      p.custo,
      p.preco_venda,

      CASE
        WHEN COALESCE(SUM(iv.quantidade),0) >= 20 THEN p.custo * 4
        WHEN COALESCE(SUM(iv.quantidade),0) >= 10 THEN p.custo * 3.5
        ELSE p.custo * 3.2
      END AS preco_sugerido

    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id

    GROUP BY p.id, p.nome, p.custo, p.preco_venda
  `;
};

exports.getInteligencia = () => {
  return `
    SELECT 
      p.id,
      p.nome,

      COALESCE(SUM(iv.quantidade), 0) AS total_vendido,

      (p.preco_venda - p.custo) AS lucro_unitario,

      CASE 
        WHEN COALESCE(SUM(iv.quantidade),0) >= 20 
             AND (p.preco_venda - p.custo) > 0 
          THEN 'MANTER'

        WHEN COALESCE(SUM(iv.quantidade),0) >= 10 
          THEN 'AJUSTAR PREÇO'

        ELSE 'LIQUIDAR'
      END AS decisao

    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id

    GROUP BY p.id, p.nome, p.custo, p.preco_venda
  `;
};

exports.getAcoes = () => {
  return `
    SELECT 
      p.id,
      p.nome,

      COALESCE(SUM(iv.quantidade), 0) AS total_vendido,

      CASE 
        WHEN COALESCE(SUM(iv.quantidade),0) >= 20 
          THEN 'Aumentar preço em 10%'

        WHEN COALESCE(SUM(iv.quantidade),0) >= 10 
          THEN 'Revisar margem'

        ELSE 'Criar promoção'
      END AS acao

    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id

    GROUP BY p.id, p.nome
  `;
};
const db = require('../config/db');
const service = require('../services/produtosService');


// =========================
// BÁSICO
// =========================

exports.listar = (req, res) => {
  db.query('SELECT * FROM produtos', (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};

exports.criar = (req, res) => {
  const { nome, preco_venda, custo } = req.body;

  if (!nome || !preco_venda || !custo) {
    return res.status(400).json({ error: 'Dados obrigatórios faltando' });
  }

  const sql = `
    INSERT INTO produtos (nome, preco_venda, custo)
    VALUES ($1, $2, $3)
  `;

  db.query(sql, [nome, preco_venda, custo], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: 'Produto criado' });
  });
};


// =========================
// GIRO E ANÁLISE
// =========================

exports.giro = (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.nome,
      COALESCE(SUM(iv.quantidade), 0) AS total_vendido,
      COUNT(DISTINCT DATE(v.data)) AS dias_com_venda
    FROM itens_venda iv
    JOIN produtos p ON p.id = iv.produto_id
    JOIN vendas v ON v.id = iv.venda_id
    GROUP BY p.id, p.nome
    ORDER BY total_vendido DESC
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};

exports.parados = (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.nome,
      MAX(v.data) AS ultima_venda
    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id
    LEFT JOIN vendas v ON v.id = iv.venda_id
    GROUP BY p.id, p.nome
    HAVING MAX(v.data) IS NULL
       OR MAX(v.data) < NOW() - INTERVAL '30 days'
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// PRICING (PADRÃO EMPRESA)
// =========================

exports.pricingProfissional = (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.nome,
      p.custo,
      p.preco_venda,

      COALESCE(SUM(iv.quantidade), 0) AS total_vendido,

      CASE 
        WHEN COALESCE(SUM(iv.quantidade), 0) >= 20 
          THEN ROUND(p.custo * 3.0, 2)

        WHEN COALESCE(SUM(iv.quantidade), 0) >= 10 
          THEN ROUND(p.custo * 2.5, 2)

        ELSE 
          ROUND(p.custo * 2.2, 2)
      END AS preco_sugerido

    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id

    GROUP BY p.id, p.nome, p.custo, p.preco_venda

    ORDER BY total_vendido DESC
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// LUCRO
// =========================

exports.lucroPorProduto = (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.nome,

      COALESCE(SUM(iv.quantidade), 0) AS total_vendido,

      COALESCE(SUM(iv.quantidade * p.preco_venda), 0) AS faturamento,

      COALESCE(SUM(iv.quantidade * p.custo), 0) AS custo_total,

      COALESCE(SUM(iv.quantidade * (p.preco_venda - p.custo)), 0) AS lucro,

      ROUND(
        COALESCE(
          (SUM(iv.quantidade * (p.preco_venda - p.custo)) /
          NULLIF(SUM(iv.quantidade * p.preco_venda), 0)) * 100,
        0), 2
      ) AS margem_percentual

    FROM produtos p
    LEFT JOIN itens_venda iv ON iv.produto_id = p.id

    GROUP BY p.id, p.nome
    ORDER BY lucro DESC
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// ALERTA
// =========================

exports.alertaPrejuizo = (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.nome,
      p.custo,
      p.preco_venda,
      (p.preco_venda - p.custo) AS lucro_unitario
    FROM produtos p
    WHERE (p.preco_venda - p.custo) <= 0
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// INTELIGÊNCIA (SERVICE)
// =========================

exports.maisVendidos = (req, res) => {
  db.query(service.getMaisVendidos(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};

exports.curvaABC = (req, res) => {
  db.query(service.getCurvaABC(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};

exports.reposicao = (req, res) => {
  db.query(service.getReposicao(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};

exports.sugestaoPreco = (req, res) => {
  db.query(service.getSugestaoPreco(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};

exports.inteligencia = (req, res) => {
  db.query(service.getInteligencia(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};

exports.acoes = (req, res) => {
  db.query(service.getAcoes(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// AÇÃO (ALTERAR PREÇO)
// =========================

exports.ajustarPreco = (req, res) => {
  const { id, percentual } = req.body;

  if (!id || percentual == null) {
    return res.status(400).json({ error: 'Dados inválidos' });
  }

  if (percentual < -0.5 || percentual > 1) {
    return res.status(400).json({ error: 'Percentual fora do limite' });
  }

  const sql = `
    UPDATE produtos
    SET preco_venda = preco_venda * (1 + $1)
    WHERE id = $2
  `;

  db.query(sql, [percentual, id], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: 'Preço atualizado com sucesso' });
  });
};


// =========================
// DASHBOARD
// =========================

exports.dashboard = (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) AS total_vendas,
      COALESCE(SUM(total), 0) AS faturamento,
      COALESCE(AVG(total), 0) AS ticket_medio
    FROM vendas
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows[0]);
  });
};
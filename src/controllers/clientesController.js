const db = require('../config/db');


// =========================
// LISTAR
// =========================

exports.listar = (req, res) => {
  db.query('SELECT * FROM clientes', (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// CRIAR
// =========================

exports.criar = (req, res) => {
  const { nome, telefone, email } = req.body;

  if (!nome) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }

  const sql = `
    INSERT INTO clientes (nome, telefone, email)
    VALUES ($1, $2, $3)
  `;

  db.query(sql, [nome, telefone, email], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: 'Cliente criado' });
  });
};


// =========================
// HISTÓRICO
// =========================

exports.historico = (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT 
      v.id AS venda_id,
      v.data,
      p.nome AS produto,
      iv.quantidade,
      iv.preco_unitario,
      (iv.quantidade * iv.preco_unitario) AS total_item
    FROM vendas v
    JOIN itens_venda iv ON iv.venda_id = v.id
    JOIN produtos p ON p.id = iv.produto_id
    WHERE v.cliente_id = $1
    ORDER BY v.data DESC
  `;

  db.query(sql, [id], (err, result) => {
    if (err) return res.status(500).json(err);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nenhum histórico encontrado' });
    }

    res.json(result.rows);
  });
};


// =========================
// RANKING (CORRIGIDO)
// =========================

exports.ranking = (req, res) => {
  const sql = `
    SELECT 
      c.id,
      c.nome,

      COUNT(DISTINCT v.id) AS total_compras,

      COALESCE(SUM(v.total), 0) AS total_gasto,

      ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio

    FROM clientes c
    LEFT JOIN vendas v ON v.cliente_id = c.id

    GROUP BY c.id, c.nome

    ORDER BY total_gasto DESC
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// TOTAL POR CLIENTE
// =========================

exports.totalGasto = (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT 
      c.id,
      c.nome,

      COUNT(DISTINCT v.id) AS total_compras,

      COALESCE(SUM(v.total), 0) AS total_gasto,

      ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio

    FROM clientes c
    LEFT JOIN vendas v ON v.cliente_id = c.id

    WHERE c.id = $1

    GROUP BY c.id, c.nome
  `;

  db.query(sql, [id], (err, result) => {
    if (err) return res.status(500).json(err);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    res.json(result.rows[0]);
  });
};
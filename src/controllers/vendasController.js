const db = require('../config/db');
const service = require('../services/vendasService');


// =========================
// RESUMO
// =========================

exports.resumo = (req, res) => {
  db.query(service.getResumo(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows[0]);
  });
};


// =========================
// POR DIA
// =========================

exports.porDia = (req, res) => {
  db.query(service.getPorDia(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// POR MÊS
// =========================

exports.porMes = (req, res) => {
  db.query(service.getPorMes(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// PRODUTOS MAIS VENDIDOS
// =========================

exports.maisVendidos = (req, res) => {
  db.query(service.getMaisVendidosPeriodo(), (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result.rows);
  });
};


// =========================
// CRIAR VENDA (IMPORTANTE)
// =========================

exports.criar = (req, res) => {
  const { cliente_id, itens } = req.body;

  if (!cliente_id || !itens || itens.length === 0) {
    return res.status(400).json({ error: 'Dados inválidos' });
  }

  // calcular total
  let total = 0;
  itens.forEach(item => {
    total += item.quantidade * item.preco_unitario;
  });

  // inserir venda
  const vendaSql = `
    INSERT INTO vendas (cliente_id, total, data)
    VALUES ($1, $2, NOW())
    RETURNING id
  `;

  db.query(vendaSql, [cliente_id, total], (err, vendaResult) => {
    if (err) return res.status(500).json(err);

    const venda_id = vendaResult.rows[0].id;

    const valores = itens.map(item => [
      venda_id,
      item.produto_id,
      item.quantidade,
      item.preco_unitario
    ]);

    const placeholders = valores
      .map((_, i) => {
        const base = i * 4;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      })
      .join(', ');

    const itensSql = `
      INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario)
      VALUES ${placeholders}
    `;

    db.query(itensSql, valores.flat(), (err) => {
      if (err) return res.status(500).json(err);

      res.json({ message: 'Venda criada com sucesso' });
    });
  });
};